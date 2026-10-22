import { describe, expect, it } from 'vitest';
import {
  getAnimationFrameRect,
  getLookFrameRect,
  inspectAtlas,
  type AnimationState,
  type AtlasPixels,
  type AtlasProfile,
} from '../packages/atlas-tools';
import {
  ANIMATION_ROWS,
  ATLAS_COLUMNS,
  CELL_HEIGHT,
  CELL_WIDTH,
  MAX_ENCODED_BYTES,
  atlasDimensions,
} from '../packages/target-chatgpt/contract';

function blankAtlas(profile: AtlasProfile): AtlasPixels {
  const { width, height } = atlasDimensions(profile);
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

function setPixel(
  image: AtlasPixels,
  row: number,
  frame: number,
  localX: number,
  localY: number,
  alpha: number,
): void {
  const x = frame * CELL_WIDTH + localX;
  const y = row * CELL_HEIGHT + localY;
  const index = (y * image.width + x) * 4;
  image.data[index] = 24;
  image.data[index + 1] = 160;
  image.data[index + 2] = 220;
  image.data[index + 3] = alpha;
}

function fillCell(
  image: AtlasPixels,
  row: number,
  frame: number,
  alpha: number,
  rgb: readonly [number, number, number],
): void {
  for (let y = row * CELL_HEIGHT; y < (row + 1) * CELL_HEIGHT; y += 1) {
    for (let x = frame * CELL_WIDTH; x < (frame + 1) * CELL_WIDTH; x += 1) {
      const index = (y * image.width + x) * 4;
      image.data[index] = rgb[0];
      image.data[index + 1] = rgb[1];
      image.data[index + 2] = rgb[2];
      image.data[index + 3] = alpha;
    }
  }
}

function clearCell(image: AtlasPixels, row: number, frame: number): void {
  for (let y = row * CELL_HEIGHT; y < (row + 1) * CELL_HEIGHT; y += 1) {
    for (let x = frame * CELL_WIDTH; x < (frame + 1) * CELL_WIDTH; x += 1) {
      image.data[(y * image.width + x) * 4 + 3] = 0;
    }
  }
}

function fillAllAlpha(image: AtlasPixels, alpha: number): void {
  for (let index = 3; index < image.data.length; index += 4) {
    image.data[index] = alpha;
  }
}

function paintRequiredCells(profile: AtlasProfile, alpha = 255): AtlasPixels {
  const image = blankAtlas(profile);
  ANIMATION_ROWS.forEach((row, rowIndex) => {
    for (let frame = 0; frame < row.frames; frame += 1) {
      setPixel(image, rowIndex, frame, 0, 0, alpha);
    }
  });
  if (profile === 'v2') {
    for (let row = 9; row <= 10; row += 1) {
      for (let frame = 0; frame < ATLAS_COLUMNS; frame += 1) {
        setPixel(image, row, frame, 0, 0, alpha);
      }
    }
  }
  return image;
}

function cellRect(row: number, frame: number) {
  return {
    x: frame * CELL_WIDTH,
    y: row * CELL_HEIGHT,
    width: CELL_WIDTH,
    height: CELL_HEIGHT,
  };
}

describe('inspectAtlas', () => {
  it('accepts structurally complete v1 and v2 sheets and reports required frame totals', () => {
    const v1 = inspectAtlas(paintRequiredCells('v1'), 'v1');
    expect(v1.valid).toBe(true);
    expect(v1.errors).toEqual([]);
    expect(v1.requiredFrames).toBe(57);
    expect(v1.profile).toBe('v1');

    const v2 = inspectAtlas(paintRequiredCells('v2'), 'v2');
    expect(v2.valid).toBe(true);
    expect(v2.errors).toEqual([]);
    expect(v2.requiredFrames).toBe(73);
  });

  it('always states the limits of structural inspection in warnings', () => {
    const valid = inspectAtlas(paintRequiredCells('v1'), 'v1');
    expect(valid.warnings.join('\n')).toContain('动作语义');
    expect(valid.warnings.join('\n')).toContain('角色一致性');
    expect(valid.warnings.join('\n')).toContain('视线正确性');
    expect(valid.warnings.join('\n')).toContain('官方预检');

    const invalid = inspectAtlas({ width: 0, height: 0, data: new Uint8ClampedArray(0) }, 'v1');
    expect(invalid.warnings.join('\n')).toContain('官方预检');
  });

  it('does not reject a fully painted cell with non-black RGB that touches every edge', () => {
    const image = paintRequiredCells('v2');
    fillCell(image, 0, 0, 255, [250, 12, 12]);
    const result = inspectAtlas(image, 'v2');
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('treats alpha 1 as visible content in required cells', () => {
    const result = inspectAtlas(paintRequiredCells('v2', 1), 'v2');
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('reports an empty required frame with zero-based row and frame', () => {
    const image = paintRequiredCells('v2');
    clearCell(image, 4, 2);
    const result = inspectAtlas(image, 'v2');
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ code: 'empty-frame', row: 4, frame: 2 });
  });

  it('rejects any visible pixel in unused trailing cells of v1', () => {
    const image = paintRequiredCells('v1');
    setPixel(image, 0, 6, 50, 50, 1);
    const result = inspectAtlas(image, 'v1');
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ code: 'unused-cell', row: 0, frame: 6 });
  });

  it('rejects pollution in unused cells after the last real frame of each row', () => {
    const image = paintRequiredCells('v2');
    setPixel(image, 8, 6, 10, 10, 1);
    setPixel(image, 8, 7, 10, 10, 255);
    const result = inspectAtlas(image, 'v2');
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(2);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'unused-cell', row: 8, frame: 6 }),
      expect.objectContaining({ code: 'unused-cell', row: 8, frame: 7 }),
    ]));
  });

  it('returns a dimensions error without scanning when width or height is wrong', () => {
    const image = paintRequiredCells('v2');
    const wrongWidth = { ...image, width: image.width - 1 };
    const widthResult = inspectAtlas(wrongWidth, 'v2');
    expect(widthResult.valid).toBe(false);
    expect(widthResult.errors).toHaveLength(1);
    expect(widthResult.errors[0].code).toBe('dimensions');

    const wrongHeight = { ...image, height: image.height - 1 };
    expect(inspectAtlas(wrongHeight, 'v2').errors[0].code).toBe('dimensions');

    const v1AsV2 = inspectAtlas(paintRequiredCells('v1'), 'v2');
    expect(v1AsV2.errors[0]).toMatchObject({ code: 'dimensions' });

    const nonFinite = { ...image, width: Number.NaN };
    expect(inspectAtlas(nonFinite, 'v2').errors[0].code).toBe('dimensions');

    const fractional = { ...image, width: image.width + 0.5 };
    expect(inspectAtlas(fractional, 'v2').errors[0].code).toBe('dimensions');
  });

  it('returns a pixel-data error when the RGBA buffer length is not exact', () => {
    const image = paintRequiredCells('v1');

    const shortData = { ...image, data: image.data.slice(0, image.data.length - 4) };
    const shortResult = inspectAtlas(shortData, 'v1');
    expect(shortResult.valid).toBe(false);
    expect(shortResult.errors).toHaveLength(1);
    expect(shortResult.errors[0].code).toBe('pixel-data');

    const extraData = new Uint8ClampedArray(image.data.length + 4);
    extraData.set(image.data);
    const extraResult = inspectAtlas({ ...image, data: extraData }, 'v1');
    expect(extraResult.errors[0]).toMatchObject({ code: 'pixel-data' });

    const missingData = {
      ...image,
      data: undefined as unknown as Uint8ClampedArray,
    };
    expect(() => inspectAtlas(missingData, 'v1')).not.toThrow();
    expect(inspectAtlas(missingData, 'v1').errors[0].code).toBe('pixel-data');
  });

  it('validates encodedBytes as a positive safe integer up to 20 MiB', () => {
    const image = paintRequiredCells('v1');

    expect(inspectAtlas(image, 'v1').valid).toBe(true);
    expect(inspectAtlas(image, 'v1', 1).valid).toBe(true);
    expect(inspectAtlas(image, 'v1', MAX_ENCODED_BYTES).valid).toBe(true);

    const invalidSizes = [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, MAX_ENCODED_BYTES + 1, 2 ** 53];
    for (const encodedBytes of invalidSizes) {
      const result = inspectAtlas(image, 'v1', encodedBytes);
      expect(result.valid, `encodedBytes=${encodedBytes}`).toBe(false);
      expect(result.errors[0], `encodedBytes=${encodedBytes}`).toMatchObject({ code: 'file-size' });
    }
  });

  it('reports a fully opaque sheet but not a transparent one', () => {
    const opaque = blankAtlas('v1');
    fillAllAlpha(opaque, 255);
    const opaqueResult = inspectAtlas(opaque, 'v1');
    expect(opaqueResult.valid).toBe(false);
    expect(opaqueResult.errors.some((issue) => issue.code === 'opaque-background')).toBe(true);

    const transparent = paintRequiredCells('v1');
    const transparentResult = inspectAtlas(transparent, 'v1');
    expect(transparentResult.errors.some((issue) => issue.code === 'opaque-background')).toBe(false);
  });

  it('rejects unknown profiles with a clear exception', () => {
    const image = paintRequiredCells('v1');
    expect(() => inspectAtlas(image, 'v3' as AtlasProfile)).toThrow(/Unknown atlas profile/);
    expect(() => inspectAtlas(image, undefined as unknown as AtlasProfile)).toThrow(/Unknown atlas profile/);
  });
});

describe('getAnimationFrameRect', () => {
  it('walks every real frame of every state and wraps to frame zero without blank columns', () => {
    ANIMATION_ROWS.forEach((row, rowIndex) => {
      for (let cycle = 0; cycle < 3; cycle += 1) {
        for (let frame = 0; frame < row.frames; frame += 1) {
          const time = (cycle * row.frames + frame) / 8;
          expect(
            getAnimationFrameRect(row.state, time),
            `${row.state} cycle ${cycle} frame ${frame}`,
          ).toEqual(cellRect(rowIndex, frame));
        }
        const justBeforeWrap = getAnimationFrameRect(
          row.state,
          (cycle * row.frames + row.frames - 0.001) / 8,
        );
        expect(justBeforeWrap.x, `${row.state} last frame before wrap`).toBe(
          (row.frames - 1) * CELL_WIDTH,
        );
      }

      const wrapped = getAnimationFrameRect(row.state, row.frames / 8);
      expect(wrapped, `${row.state} next cycle`).toEqual(cellRect(rowIndex, 0));
    });
  });

  it('treats negative, NaN and infinite time as zero', () => {
    for (const time of [-5, -0.25, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(getAnimationFrameRect('waving', time), `time=${time}`).toEqual(cellRect(3, 0));
    }
  });

  it('uses fps 8 by default and replaces invalid fps values', () => {
    expect(getAnimationFrameRect('idle', 0.125)).toEqual(cellRect(0, 1));
    expect(getAnimationFrameRect('idle', 0.125, 8)).toEqual(cellRect(0, 1));
    expect(getAnimationFrameRect('idle', 0.1, 10)).toEqual(cellRect(0, 1));

    for (const fps of [0, -4, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(getAnimationFrameRect('idle', 0.125, fps), `fps=${fps}`).toEqual(cellRect(0, 1));
    }
  });

  it('rejects unknown animation states with a clear exception', () => {
    expect(() => getAnimationFrameRect('dancing' as AnimationState, 0)).toThrow(
      /Unknown animation state/,
    );
    expect(() => getAnimationFrameRect(undefined as unknown as AnimationState, 0)).toThrow(
      /Unknown animation state/,
    );
  });
});

describe('getLookFrameRect', () => {
  it('maps the four cardinal directions clockwise from up', () => {
    expect(getLookFrameRect(0)).toEqual(cellRect(9, 0));
    expect(getLookFrameRect(90)).toEqual(cellRect(9, 4));
    expect(getLookFrameRect(180)).toEqual(cellRect(10, 0));
    expect(getLookFrameRect(270)).toEqual(cellRect(10, 4));
  });

  it('uses the nearest 22.5 degree slot across both gaze rows', () => {
    expect(getLookFrameRect(22.5)).toEqual(cellRect(9, 1));
    expect(getLookFrameRect(157.5)).toEqual(cellRect(9, 7));
    expect(getLookFrameRect(168.75)).toEqual(cellRect(10, 0));
    expect(getLookFrameRect(180)).toEqual(cellRect(10, 0));
    expect(getLookFrameRect(337.5)).toEqual(cellRect(10, 7));
    expect(getLookFrameRect(11.24)).toEqual(cellRect(9, 0));
    expect(getLookFrameRect(11.26)).toEqual(cellRect(9, 1));
  });

  it('normalizes negative angles and angles beyond one turn', () => {
    expect(getLookFrameRect(-22.5)).toEqual(cellRect(10, 7));
    expect(getLookFrameRect(-90)).toEqual(cellRect(10, 4));
    expect(getLookFrameRect(-450)).toEqual(getLookFrameRect(270));
    expect(getLookFrameRect(360)).toEqual(cellRect(9, 0));
    expect(getLookFrameRect(450)).toEqual(cellRect(9, 4));
    expect(getLookFrameRect(810)).toEqual(cellRect(9, 4));
  });

  it('wraps 359 degrees back to the up direction', () => {
    expect(getLookFrameRect(359)).toEqual(cellRect(9, 0));
    expect(getLookFrameRect(359.9)).toEqual(cellRect(9, 0));
    expect(getLookFrameRect(348.75)).toEqual(cellRect(9, 0));
  });

  it('treats non-finite angles as zero degrees', () => {
    for (const angle of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(getLookFrameRect(angle), `angle=${angle}`).toEqual(cellRect(9, 0));
    }
  });
});
