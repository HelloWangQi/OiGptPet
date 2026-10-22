import {
  ANIMATION_ROWS,
  ATLAS_COLUMNS,
  CELL_HEIGHT,
  CELL_WIDTH,
  MAX_ENCODED_BYTES,
  atlasDimensions,
  type AtlasInspection,
  type AtlasIssue,
  type AtlasPixels,
  type AtlasProfile,
} from '../target-chatgpt/contract';

const PROFILE_ROW_COUNT: Readonly<Record<AtlasProfile, number>> = {
  v1: 9,
  v2: 11,
};

const LOOK_FRAMES_PER_ROW = ATLAS_COLUMNS;

const WARNINGS: readonly string[] = [
  '结构检查不判断动作语义、角色一致性或视线正确性。',
  '结构检查不能替代目标平台的官方预检、安装或实际播放验证。',
];

function isKnownProfile(profile: unknown): profile is AtlasProfile {
  return profile === 'v1' || profile === 'v2';
}

function requiredFrameCount(profile: AtlasProfile): number {
  const animationFrames = ANIMATION_ROWS.reduce((total, row) => total + row.frames, 0);
  const lookFrames = profile === 'v2' ? 2 * LOOK_FRAMES_PER_ROW : 0;
  return animationFrames + lookFrames;
}

function framesInRow(profile: AtlasProfile, row: number): number {
  if (row < ANIMATION_ROWS.length) {
    return ANIMATION_ROWS[row].frames;
  }
  if (profile === 'v2' && row < PROFILE_ROW_COUNT.v2) {
    return LOOK_FRAMES_PER_ROW;
  }
  return 0;
}

function cellHasVisiblePixel(
  data: ArrayLike<number>,
  imageWidth: number,
  row: number,
  frame: number,
): boolean {
  const startX = frame * CELL_WIDTH;
  const startY = row * CELL_HEIGHT;
  for (let y = startY; y < startY + CELL_HEIGHT; y += 1) {
    let index = (y * imageWidth + startX) * 4 + 3;
    for (let x = 0; x < CELL_WIDTH; x += 1, index += 4) {
      if (data[index] > 0) {
        return true;
      }
    }
  }
  return false;
}

function isFullyOpaque(data: ArrayLike<number>): boolean {
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] !== 255) {
      return false;
    }
  }
  return true;
}

export function inspectAtlas(
  image: AtlasPixels,
  profile: AtlasProfile,
  encodedBytes?: number,
): AtlasInspection {
  if (!isKnownProfile(profile)) {
    throw new Error(
      `Unknown atlas profile: ${String(profile)}. Expected "v1" or "v2".`,
    );
  }

  const expected = atlasDimensions(profile);
  const requiredFrames = requiredFrameCount(profile);
  const errors: AtlasIssue[] = [];
  const warnings = [...WARNINGS];

  if (
    encodedBytes !== undefined
    && (!Number.isSafeInteger(encodedBytes) || encodedBytes <= 0 || encodedBytes > MAX_ENCODED_BYTES)
  ) {
    errors.push({
      code: 'file-size',
      message: `编码文件大小必须是正的 safe integer 且不超过 ${MAX_ENCODED_BYTES} 字节（20 MiB），收到 ${String(encodedBytes)}。`,
    });
  }

  const width = image == null ? undefined : image.width;
  const height = image == null ? undefined : image.height;
  const data = image == null ? undefined : image.data;

  const dimensionsMatch = Number.isSafeInteger(width)
    && Number.isSafeInteger(height)
    && width === expected.width
    && height === expected.height;

  if (!dimensionsMatch) {
    errors.push({
      code: 'dimensions',
      message: `图集尺寸必须是 ${expected.width}×${expected.height}（${profile}），收到 ${String(width)}×${String(height)}。`,
    });
    return { valid: false, profile, requiredFrames, errors, warnings };
  }

  const expectedByteLength = width * height * 4;
  const actualByteLength = data == null ? undefined : data.length;
  if (actualByteLength !== expectedByteLength) {
    errors.push({
      code: 'pixel-data',
      message: `RGBA 像素数据长度必须是 ${expectedByteLength}，收到 ${actualByteLength === undefined ? '缺失' : String(actualByteLength)}。`,
    });
    return { valid: false, profile, requiredFrames, errors, warnings };
  }

  const rowCount = PROFILE_ROW_COUNT[profile];
  for (let row = 0; row < rowCount; row += 1) {
    const usableFrames = framesInRow(profile, row);
    for (let frame = 0; frame < ATLAS_COLUMNS; frame += 1) {
      const hasContent = cellHasVisiblePixel(data as ArrayLike<number>, width, row, frame);
      if (frame < usableFrames) {
        if (!hasContent) {
          errors.push({
            code: 'empty-frame',
            message: `必需帧为空（没有任何 alpha 大于零的像素）：row ${row}，frame ${frame}。`,
            row,
            frame,
          });
        }
      } else if (hasContent) {
        errors.push({
          code: 'unused-cell',
          message: `未使用格必须完全透明：row ${row}，frame ${frame}。`,
          row,
          frame,
        });
      }
    }
  }

  if (isFullyOpaque(data as ArrayLike<number>)) {
    errors.push({
      code: 'opaque-background',
      message: '整张图完全不透明，图集需要透明背景。',
    });
  }

  return {
    valid: errors.length === 0,
    profile,
    requiredFrames,
    errors,
    warnings,
  };
}
