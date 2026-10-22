import {
  ANIMATION_ROWS,
  ATLAS_COLUMNS,
  CELL_HEIGHT,
  CELL_WIDTH,
  atlasDimensions,
  type AtlasInspection,
  type AtlasProfile,
} from '../../../packages/target-chatgpt/contract';
import { inspectAtlas } from '../../../packages/atlas-tools';

interface AnalyzeInput {
  base64: string;
  mime: string;
  profile: AtlasProfile;
  encodedBytes: number;
}

interface CellBounds {
  row: number;
  frame: number;
  state: string | null;
  empty: boolean;
  minX: number | null;
  maxX: number | null;
  minY: number | null;
  maxY: number | null;
  bottom: number | null;
  centerX: number | null;
  width: number | null;
  height: number | null;
}

interface StateSummary {
  state: string;
  label: string;
  row: number;
  frames: number;
  bottoms: Array<number | null>;
  centerXRange: [number, number] | null;
  widthRange: [number, number] | null;
  heightRange: [number, number] | null;
  frameDiffAdjacent: number[];
  frameDiffVsFirst: number[];
}

interface PixelBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface GazeAnalysis {
  rows: [number, number];
  headDiffVsUp: number[];
  headDiffAdjacent: number[];
  headDiffBoundsVsUp: Array<PixelBounds | null>;
  eyeDiffVsUp: number[];
  eyeDiffAdjacent: number[];
  eyeDiffBoundsVsUp: Array<PixelBounds | null>;
  fullCellDiffVsUp: number[];
  /** Differences below y=96 exclude head/eyes; zero means no whole-body turn. */
  lowerBodyDiffVsUp: number[];
  identicalHeadToUp: boolean[];
  idleHeadVsGazeUp: number;
}

interface StateComparison {
  first: string;
  second: string;
  diffPixels: number;
  cellPixels: number;
}

interface AnalyzeResult {
  width: number;
  height: number;
  profile: AtlasProfile;
  encodedBytes: number;
  inspection: AtlasInspection;
  frameBounds: CellBounds[];
  states: StateSummary[];
  stateComparisons: StateComparison[];
  jumpBottoms: Array<number | null>;
  gaze: GazeAnalysis | null;
  sheets: Record<string, string>;
}

declare global {
  interface Window {
    __atlasVisualQa: {
      analyze: (input: AnalyzeInput) => Promise<AnalyzeResult>;
    };
  }
}

const LOOK_START_ROW = 9;
const HEAD_CROP = { x: 56, y: 0, width: 80, height: 96 };
const EYE_CROP = { x: 78, y: 50, width: 36, height: 20 };
const LOWER_BODY_CROP = { x: 0, y: 96, width: CELL_WIDTH, height: CELL_HEIGHT - 96 };
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

interface CropRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

function decodeBase64(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function makeCanvas(width: number, height: number): {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
} {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new Error('Canvas 2D is unavailable.');
  }
  return { canvas, context };
}

function drawCheckerboard(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  tile = 12,
): void {
  context.save();
  context.beginPath();
  context.rect(x, y, width, height);
  context.clip();
  context.fillStyle = '#eef1f5';
  context.fillRect(x, y, width, height);
  context.fillStyle = '#dce2ea';
  for (let row = 0; row * tile < height; row += 1) {
    for (let column = 0; column * tile < width; column += 1) {
      if ((row + column) % 2 === 0) {
        context.fillRect(
          x + column * tile,
          y + row * tile,
          tile,
          tile,
        );
      }
    }
  }
  context.restore();
}

function drawBadge(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
): void {
  context.save();
  context.font = `600 18px ${FONT}`;
  const width = context.measureText(text).width + 14;
  context.fillStyle = 'rgba(17, 24, 39, 0.78)';
  context.fillRect(x, y, width, 26);
  context.fillStyle = '#ffffff';
  context.textBaseline = 'middle';
  context.fillText(text, x + 7, y + 13);
  context.restore();
}

function drawHeader(
  context: CanvasRenderingContext2D,
  width: number,
  title: string,
  detail: string,
): void {
  context.save();
  context.fillStyle = '#f8fafc';
  context.fillRect(0, 0, width, 52);
  context.fillStyle = '#111827';
  context.font = `600 22px ${FONT}`;
  context.textBaseline = 'middle';
  context.fillText(title, 16, 26);
  context.fillStyle = '#4b5563';
  context.font = `14px ${FONT}`;
  const titleWidth = context.measureText(title).width;
  context.fillText(detail, 32 + titleWidth, 27);
  context.restore();
}

function boundsForCell(
  data: Uint8ClampedArray,
  imageWidth: number,
  row: number,
  frame: number,
  state: string | null,
): CellBounds {
  const startX = frame * CELL_WIDTH;
  const startY = row * CELL_HEIGHT;
  let minX = CELL_WIDTH;
  let minY = CELL_HEIGHT;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < CELL_HEIGHT; y += 1) {
    let alphaIndex = ((startY + y) * imageWidth + startX) * 4 + 3;
    for (let x = 0; x < CELL_WIDTH; x += 1, alphaIndex += 4) {
      if (data[alphaIndex] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0) {
    return {
      row,
      frame,
      state,
      empty: true,
      minX: null,
      maxX: null,
      minY: null,
      maxY: null,
      bottom: null,
      centerX: null,
      width: null,
      height: null,
    };
  }

  return {
    row,
    frame,
    state,
    empty: false,
    minX,
    maxX,
    minY,
    maxY,
    bottom: maxY,
    centerX: Math.round((minX + maxX) / 2),
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

function summarizeState(
  rowIndex: number,
  row: (typeof ANIMATION_ROWS)[number],
  bounds: CellBounds[],
  cells: Uint8ClampedArray[],
): StateSummary {
  const bottoms = bounds.map((item) => item.bottom);
  const centers = bounds
    .map((item) => item.centerX)
    .filter((value): value is number => value !== null);
  const widths = bounds
    .map((item) => item.width)
    .filter((value): value is number => value !== null);
  const heights = bounds
    .map((item) => item.height)
    .filter((value): value is number => value !== null);
  const frameDiffAdjacent = cells.map((pixels, index) => (
    diffPixels(cells[(index + cells.length - 1) % cells.length], pixels)
  ));
  const frameDiffVsFirst = cells.map((pixels) => diffPixels(cells[0], pixels));

  return {
    state: row.state,
    label: row.label,
    row: rowIndex,
    frames: row.frames,
    bottoms,
    centerXRange: centers.length ? [Math.min(...centers), Math.max(...centers)] : null,
    widthRange: widths.length ? [Math.min(...widths), Math.max(...widths)] : null,
    heightRange: heights.length ? [Math.min(...heights), Math.max(...heights)] : null,
    frameDiffAdjacent,
    frameDiffVsFirst,
  };
}

function cropPixels(
  data: Uint8ClampedArray,
  imageWidth: number,
  row: number,
  frame: number,
  crop: CropRegion,
): Uint8ClampedArray {
  const startX = frame * CELL_WIDTH + crop.x;
  const startY = row * CELL_HEIGHT + crop.y;
  const pixels = new Uint8ClampedArray(crop.width * crop.height * 4);
  for (let y = 0; y < crop.height; y += 1) {
    const sourceStart = ((startY + y) * imageWidth + startX) * 4;
    pixels.set(
      data.subarray(sourceStart, sourceStart + crop.width * 4),
      y * crop.width * 4,
    );
  }
  return pixels;
}

function pixelsDiffer(first: Uint8ClampedArray, second: Uint8ClampedArray, index: number): boolean {
  return (
    Math.abs(first[index] - second[index]) > 8
    || Math.abs(first[index + 1] - second[index + 1]) > 8
    || Math.abs(first[index + 2] - second[index + 2]) > 8
    || Math.abs(first[index + 3] - second[index + 3]) > 8
  );
}

function diffPixels(first: Uint8ClampedArray, second: Uint8ClampedArray): number {
  let changed = 0;
  for (let index = 0; index < first.length; index += 4) {
    if (pixelsDiffer(first, second, index)) {
      changed += 1;
    }
  }
  return changed;
}

function diffBounds(
  first: Uint8ClampedArray,
  second: Uint8ClampedArray,
  width: number,
): PixelBounds | null {
  let minX = width;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = -1;
  let maxY = -1;
  for (let index = 0; index < first.length; index += 4) {
    if (!pixelsDiffer(first, second, index)) continue;
    const pixel = index / 4;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return maxX < 0 ? null : { minX, minY, maxX, maxY };
}

function directionAngle(index: number): number {
  return index * (360 / 16);
}

function directionLabel(index: number): string {
  const angle = directionAngle(index);
  const cardinal = index === 0
    ? '上'
    : index === 4
      ? '右'
      : index === 8
        ? '下'
        : index === 12
          ? '左'
          : '';
  const angleText = Number.isInteger(angle) ? String(angle) : angle.toFixed(1);
  return `${angleText}°${cardinal ? ` ${cardinal}` : ''}`;
}

function drawStateSheet(
  bitmap: ImageBitmap,
  rowIndex: number,
  row: (typeof ANIMATION_ROWS)[number],
  bounds: CellBounds[],
  summary: StateSummary,
): string {
  const scale = 2;
  const gap = 12;
  const padding = 16;
  const header = 52;
  const cellWidth = CELL_WIDTH * scale;
  const cellHeight = CELL_HEIGHT * scale;
  const width = padding * 2 + row.frames * cellWidth + (row.frames - 1) * gap;
  const height = padding * 2 + header + cellHeight;
  const { canvas, context } = makeCanvas(width, height);

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  drawHeader(
    context,
    width,
    `${row.label} · ${row.state}`,
    `第 ${rowIndex} 行 · ${row.frames} 帧 · 完整 ${CELL_WIDTH}×${CELL_HEIGHT} 格 · ${scale}× 无裁切`,
  );

  for (let frame = 0; frame < row.frames; frame += 1) {
    const x = padding + frame * (cellWidth + gap);
    const y = padding + header;
    drawCheckerboard(context, x, y, cellWidth, cellHeight);
    context.imageSmoothingEnabled = false;
    context.drawImage(
      bitmap,
      frame * CELL_WIDTH,
      rowIndex * CELL_HEIGHT,
      CELL_WIDTH,
      CELL_HEIGHT,
      x,
      y,
      cellWidth,
      cellHeight,
    );
    context.strokeStyle = '#64748b';
    context.lineWidth = 2;
    context.strokeRect(x, y, cellWidth, cellHeight);
    const bottom = bounds[frame]?.bottom;
    const difference = summary.frameDiffAdjacent[frame];
    drawBadge(
      context,
      x + 8,
      y + 8,
      `#${frame}${bottom === null ? ' 空' : ` 底 ${bottom}`} · Δ前 ${difference}px`,
    );
  }

  return canvas.toDataURL('image/png');
}

function drawHeadStrip(
  bitmap: ImageBitmap,
  rowIndex: number,
  row: (typeof ANIMATION_ROWS)[number],
  bounds: CellBounds[],
): string {
  const scale = 6;
  const gap = 12;
  const padding = 16;
  const header = 52;
  const labelHeight = 34;
  const cellWidth = HEAD_CROP.width * scale;
  const cellHeight = HEAD_CROP.height * scale;
  const width = padding * 2 + row.frames * cellWidth + (row.frames - 1) * gap;
  const height = padding * 2 + header + cellHeight + labelHeight;
  const { canvas, context } = makeCanvas(width, height);

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  drawHeader(
    context,
    width,
    `${row.label} · 头部`,
    `第 ${rowIndex} 行 · ${HEAD_CROP.width}×${HEAD_CROP.height} 区域 · ${scale}× 无平滑`,
  );

  for (let frame = 0; frame < row.frames; frame += 1) {
    const x = padding + frame * (cellWidth + gap);
    const y = padding + header;
    drawCheckerboard(context, x, y, cellWidth, cellHeight, 18);
    context.imageSmoothingEnabled = false;
    context.drawImage(
      bitmap,
      frame * CELL_WIDTH + HEAD_CROP.x,
      rowIndex * CELL_HEIGHT + HEAD_CROP.y,
      HEAD_CROP.width,
      HEAD_CROP.height,
      x,
      y,
      cellWidth,
      cellHeight,
    );
    context.strokeStyle = '#64748b';
    context.lineWidth = 2;
    context.strokeRect(x, y, cellWidth, cellHeight);
    const bottom = bounds[frame]?.bottom;
    context.fillStyle = '#111827';
    context.font = `600 18px ${FONT}`;
    context.textBaseline = 'middle';
    context.fillText(
      `#${frame}${bottom === null ? '' : ` · 底 ${bottom}`}`,
      x,
      y + cellHeight + labelHeight / 2,
    );
  }

  return canvas.toDataURL('image/png');
}

function drawJumpBaseline(
  bitmap: ImageBitmap,
  rowIndex: number,
  row: (typeof ANIMATION_ROWS)[number],
  bounds: CellBounds[],
): string {
  const scale = 3;
  const gap = 14;
  const padding = 16;
  const header = 58;
  const cellWidth = CELL_WIDTH * scale;
  const cellHeight = CELL_HEIGHT * scale;
  const width = padding * 2 + row.frames * cellWidth + (row.frames - 1) * gap;
  const height = padding * 2 + header + cellHeight;
  const { canvas, context } = makeCanvas(width, height);
  const bottoms = bounds
    .map((item) => item.bottom)
    .filter((value): value is number => value !== null);
  const baseline = bottoms.length ? Math.max(...bottoms) : null;

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  drawHeader(
    context,
    width,
    '跳跃 · 原始基线',
    `${row.frames} 帧 · 完整 ${CELL_WIDTH}×${CELL_HEIGHT} 格 · ${scale}× · 红色虚线 = 五帧最低底 ${baseline ?? '—'}px`,
  );

  for (let frame = 0; frame < row.frames; frame += 1) {
    const x = padding + frame * (cellWidth + gap);
    const y = padding + header;
    drawCheckerboard(context, x, y, cellWidth, cellHeight, 18);
    context.imageSmoothingEnabled = false;
    context.drawImage(
      bitmap,
      frame * CELL_WIDTH,
      rowIndex * CELL_HEIGHT,
      CELL_WIDTH,
      CELL_HEIGHT,
      x,
      y,
      cellWidth,
      cellHeight,
    );
    context.strokeStyle = '#64748b';
    context.lineWidth = 2;
    context.strokeRect(x, y, cellWidth, cellHeight);
    if (baseline !== null) {
      const lineY = y + baseline * scale;
      context.save();
      context.strokeStyle = '#dc2626';
      context.lineWidth = 2;
      context.setLineDash([10, 6]);
      context.beginPath();
      context.moveTo(x, lineY);
      context.lineTo(x + cellWidth, lineY);
      context.stroke();
      context.restore();
    }
    const bottom = bounds[frame]?.bottom;
    drawBadge(context, x + 8, y + 8, `#${frame}${bottom === null ? ' 空' : ` 底 ${bottom}`}`);
  }

  return canvas.toDataURL('image/png');
}

function drawGazeGrid(
  bitmap: ImageBitmap,
  profile: AtlasProfile,
  analysis: GazeAnalysis,
): string {
  const scale = 2;
  const columns = 4;
  const rows = 4;
  const gap = 12;
  const padding = 16;
  const header = 64;
  const labelHeight = 38;
  const cellWidth = CELL_WIDTH * scale;
  const cellHeight = CELL_HEIGHT * scale;
  const width = padding * 2 + columns * cellWidth + (columns - 1) * gap;
  const height = padding * 2 + header
    + rows * (cellHeight + labelHeight) + (rows - 1) * gap;
  const { canvas, context } = makeCanvas(width, height);

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  drawHeader(
    context,
    width,
    `视线方向 · ${profile}`,
    '0° 上 / 90° 右 / 180° 下 / 270° 左 · 完整格 2× · 标签为相对“上”的头部差异像素数',
  );

  for (let direction = 0; direction < 16; direction += 1) {
    const column = direction % columns;
    const row = Math.floor(direction / columns);
    const x = padding + column * (cellWidth + gap);
    const y = padding + header + row * (cellHeight + labelHeight + gap);
    const frame = direction % ATLAS_COLUMNS;
    const atlasRow = LOOK_START_ROW + Math.floor(direction / ATLAS_COLUMNS);
    drawCheckerboard(context, x, y, cellWidth, cellHeight);
    context.imageSmoothingEnabled = false;
    context.drawImage(
      bitmap,
      frame * CELL_WIDTH,
      atlasRow * CELL_HEIGHT,
      CELL_WIDTH,
      CELL_HEIGHT,
      x,
      y,
      cellWidth,
      cellHeight,
    );
    context.strokeStyle = '#64748b';
    context.lineWidth = 2;
    context.strokeRect(x, y, cellWidth, cellHeight);
    drawBadge(context, x + 8, y + 8, directionLabel(direction));
    context.fillStyle = '#111827';
    context.font = `600 17px ${FONT}`;
    context.textBaseline = 'middle';
    context.fillText(
      `${directionLabel(direction)} · 头部差异 ${analysis.headDiffVsUp[direction]}px`,
      x,
      y + cellHeight + labelHeight / 2,
    );
  }

  return canvas.toDataURL('image/png');
}

function drawGazeHeads(
  bitmap: ImageBitmap,
  profile: AtlasProfile,
  analysis: GazeAnalysis,
): string {
  const scale = 6;
  const columns = 4;
  const rows = 4;
  const gap = 12;
  const padding = 16;
  const header = 60;
  const labelHeight = 34;
  const cellWidth = HEAD_CROP.width * scale;
  const cellHeight = HEAD_CROP.height * scale;
  const width = padding * 2 + columns * cellWidth + (columns - 1) * gap;
  const height = padding * 2 + header
    + rows * (cellHeight + labelHeight) + (rows - 1) * gap;
  const { canvas, context } = makeCanvas(width, height);

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  drawHeader(
    context,
    width,
    `视线头部对照 · ${profile}`,
    `第 9/10 行 · 头部 ${HEAD_CROP.width}×${HEAD_CROP.height} 区域 · ${scale}× 无平滑`,
  );

  for (let direction = 0; direction < 16; direction += 1) {
    const column = direction % columns;
    const row = Math.floor(direction / columns);
    const x = padding + column * (cellWidth + gap);
    const y = padding + header + row * (cellHeight + labelHeight + gap);
    const frame = direction % ATLAS_COLUMNS;
    const atlasRow = LOOK_START_ROW + Math.floor(direction / ATLAS_COLUMNS);
    drawCheckerboard(context, x, y, cellWidth, cellHeight, 18);
    context.imageSmoothingEnabled = false;
    context.drawImage(
      bitmap,
      frame * CELL_WIDTH + HEAD_CROP.x,
      atlasRow * CELL_HEIGHT + HEAD_CROP.y,
      HEAD_CROP.width,
      HEAD_CROP.height,
      x,
      y,
      cellWidth,
      cellHeight,
    );
    context.strokeStyle = '#64748b';
    context.lineWidth = 2;
    context.strokeRect(x, y, cellWidth, cellHeight);
    context.fillStyle = '#111827';
    context.font = `600 17px ${FONT}`;
    context.textBaseline = 'middle';
    context.fillText(
      `${directionLabel(direction)} · 与上向差 ${analysis.headDiffVsUp[direction]}px · 与相邻差 ${analysis.headDiffAdjacent[direction]}px`,
      x,
      y + cellHeight + labelHeight / 2,
    );
  }

  return canvas.toDataURL('image/png');
}

function drawGazeEyes(
  bitmap: ImageBitmap,
  profile: AtlasProfile,
  analysis: GazeAnalysis,
): string {
  const scale = 20;
  const columns = 4;
  const rows = 4;
  const gap = 12;
  const padding = 16;
  const header = 60;
  const labelHeight = 34;
  const cellWidth = EYE_CROP.width * scale;
  const cellHeight = EYE_CROP.height * scale;
  const width = padding * 2 + columns * cellWidth + (columns - 1) * gap;
  const height = padding * 2 + header
    + rows * (cellHeight + labelHeight) + (rows - 1) * gap;
  const { canvas, context } = makeCanvas(width, height);

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  drawHeader(
    context,
    width,
    `视线眼部特写 · ${profile}`,
    `第 9/10 行 · 眼部 ${EYE_CROP.width}×${EYE_CROP.height} 区域 · ${scale}× 无平滑 · 标签为相对“上”的眼区差异像素数`,
  );

  for (let direction = 0; direction < 16; direction += 1) {
    const column = direction % columns;
    const row = Math.floor(direction / columns);
    const x = padding + column * (cellWidth + gap);
    const y = padding + header + row * (cellHeight + labelHeight + gap);
    const frame = direction % ATLAS_COLUMNS;
    const atlasRow = LOOK_START_ROW + Math.floor(direction / ATLAS_COLUMNS);
    drawCheckerboard(context, x, y, cellWidth, cellHeight, 24);
    context.imageSmoothingEnabled = false;
    context.drawImage(
      bitmap,
      frame * CELL_WIDTH + EYE_CROP.x,
      atlasRow * CELL_HEIGHT + EYE_CROP.y,
      EYE_CROP.width,
      EYE_CROP.height,
      x,
      y,
      cellWidth,
      cellHeight,
    );
    context.strokeStyle = '#64748b';
    context.lineWidth = 2;
    context.strokeRect(x, y, cellWidth, cellHeight);
    drawBadge(context, x + 8, y + 8, directionLabel(direction));
    const bounds = analysis.eyeDiffBoundsVsUp[direction];
    const boundsText = bounds
      ? ` · 差异框 ${bounds.minX},${bounds.minY}-${bounds.maxX},${bounds.maxY}`
      : '';
    context.fillStyle = '#111827';
    context.font = `600 16px ${FONT}`;
    context.textBaseline = 'middle';
    context.fillText(
      `${directionLabel(direction)} · 眼区差异 ${analysis.eyeDiffVsUp[direction]}px${boundsText}`,
      x,
      y + cellHeight + labelHeight / 2,
    );
  }

  return canvas.toDataURL('image/png');
}

function drawIdleReference(bitmap: ImageBitmap): string {
  const bodyScale = 3;
  const headScale = 6;
  const padding = 16;
  const header = 56;
  const gap = 20;
  const bodyWidth = CELL_WIDTH * bodyScale;
  const bodyHeight = CELL_HEIGHT * bodyScale;
  const headWidth = HEAD_CROP.width * headScale;
  const headHeight = HEAD_CROP.height * headScale;
  const width = padding * 2 + bodyWidth + gap + headWidth;
  const height = padding * 2 + header + Math.max(bodyHeight, headHeight + 34);
  const { canvas, context } = makeCanvas(width, height);

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  drawHeader(
    context,
    width,
    '中性待机参考 · idle',
    `第 0 行第 0 帧 · 完整格 ${bodyScale}× · 头部 ${headScale}× · 不作视线正确性证据`,
  );

  const bodyX = padding;
  const bodyY = padding + header;
  drawCheckerboard(context, bodyX, bodyY, bodyWidth, bodyHeight, 18);
  context.imageSmoothingEnabled = false;
  context.drawImage(
    bitmap,
    0,
    0,
    CELL_WIDTH,
    CELL_HEIGHT,
    bodyX,
    bodyY,
    bodyWidth,
    bodyHeight,
  );
  context.strokeStyle = '#64748b';
  context.lineWidth = 2;
  context.strokeRect(bodyX, bodyY, bodyWidth, bodyHeight);

  const headX = bodyX + bodyWidth + gap;
  const headY = bodyY;
  drawCheckerboard(context, headX, headY, headWidth, headHeight, 18);
  context.imageSmoothingEnabled = false;
  context.drawImage(
    bitmap,
    HEAD_CROP.x,
    HEAD_CROP.y,
    HEAD_CROP.width,
    HEAD_CROP.height,
    headX,
    headY,
    headWidth,
    headHeight,
  );
  context.strokeStyle = '#64748b';
  context.lineWidth = 2;
  context.strokeRect(headX, headY, headWidth, headHeight);
  context.fillStyle = '#111827';
  context.font = `600 18px ${FONT}`;
  context.textBaseline = 'middle';
  context.fillText('头部 6×', headX, headY + headHeight + 20);

  return canvas.toDataURL('image/png');
}

function analyzeGaze(
  data: Uint8ClampedArray,
  imageWidth: number,
): GazeAnalysis {
  const head = Array.from({ length: 16 }, (_, direction) => {
    const frame = direction % ATLAS_COLUMNS;
    const row = LOOK_START_ROW + Math.floor(direction / ATLAS_COLUMNS);
    return cropPixels(data, imageWidth, row, frame, HEAD_CROP);
  });
  const eyes = Array.from({ length: 16 }, (_, direction) => {
    const frame = direction % ATLAS_COLUMNS;
    const row = LOOK_START_ROW + Math.floor(direction / ATLAS_COLUMNS);
    return cropPixels(data, imageWidth, row, frame, EYE_CROP);
  });
  const full = Array.from({ length: 16 }, (_, direction) => {
    const frame = direction % ATLAS_COLUMNS;
    const row = LOOK_START_ROW + Math.floor(direction / ATLAS_COLUMNS);
    const startX = frame * CELL_WIDTH;
    const startY = row * CELL_HEIGHT;
    const pixels = new Uint8ClampedArray(CELL_WIDTH * CELL_HEIGHT * 4);
    for (let y = 0; y < CELL_HEIGHT; y += 1) {
      const sourceStart = ((startY + y) * imageWidth + startX) * 4;
      pixels.set(
        data.subarray(sourceStart, sourceStart + CELL_WIDTH * 4),
        y * CELL_WIDTH * 4,
      );
    }
    return pixels;
  });
  const lowerBody = Array.from({ length: 16 }, (_, direction) => {
    const frame = direction % ATLAS_COLUMNS;
    const row = LOOK_START_ROW + Math.floor(direction / ATLAS_COLUMNS);
    return cropPixels(data, imageWidth, row, frame, LOWER_BODY_CROP);
  });
  const neutral = cropPixels(data, imageWidth, 0, 0, HEAD_CROP);
  const headDiffVsUp = head.map((pixels) => diffPixels(head[0], pixels));
  const eyeDiffVsUp = eyes.map((pixels) => diffPixels(eyes[0], pixels));
  const fullCellDiffVsUp = full.map((pixels) => diffPixels(full[0], pixels));
  const lowerBodyDiffVsUp = lowerBody.map((pixels) => diffPixels(lowerBody[0], pixels));
  const headDiffAdjacent = head.map((pixels, index) => (
    diffPixels(head[(index + 15) % 16], pixels)
  ));
  const eyeDiffAdjacent = eyes.map((pixels, index) => (
    diffPixels(eyes[(index + 15) % 16], pixels)
  ));

  return {
    rows: [LOOK_START_ROW, LOOK_START_ROW + 1],
    headDiffVsUp,
    headDiffAdjacent,
    headDiffBoundsVsUp: head.map((pixels) => (
      diffBounds(head[0], pixels, HEAD_CROP.width)
    )),
    eyeDiffVsUp,
    eyeDiffAdjacent,
    eyeDiffBoundsVsUp: eyes.map((pixels) => (
      diffBounds(eyes[0], pixels, EYE_CROP.width)
    )),
    fullCellDiffVsUp,
    lowerBodyDiffVsUp,
    identicalHeadToUp: headDiffVsUp.map((difference) => difference === 0),
    idleHeadVsGazeUp: diffPixels(neutral, head[0]),
  };
}

async function analyze(input: AnalyzeInput): Promise<AnalyzeResult> {
  if (input.profile !== 'v1' && input.profile !== 'v2') {
    throw new Error(`Unsupported profile: ${String(input.profile)}`);
  }
  if (!Number.isSafeInteger(input.encodedBytes) || input.encodedBytes <= 0) {
    throw new Error('encodedBytes must be a positive safe integer.');
  }

  const bytes = decodeBase64(input.base64);
  if (bytes.byteLength !== input.encodedBytes) {
    throw new Error(`Decoded byte count ${bytes.byteLength} does not match ${input.encodedBytes}.`);
  }
  const expected = atlasDimensions(input.profile);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([bytes], { type: input.mime }), {
      colorSpaceConversion: 'none',
      premultiplyAlpha: 'none',
    });
  } catch (error) {
    throw new Error(`Cannot decode atlas image: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    if (bitmap.width !== expected.width || bitmap.height !== expected.height) {
      throw new Error(
        `Atlas is ${bitmap.width}×${bitmap.height}; ${input.profile} requires ${expected.width}×${expected.height}.`,
      );
    }

    const { canvas, context } = makeCanvas(bitmap.width, bitmap.height);
    context.drawImage(bitmap, 0, 0);
    const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
    const inspection = inspectAtlas(
      { width: bitmap.width, height: bitmap.height, data },
      input.profile,
      input.encodedBytes,
    );

    const frameBounds: CellBounds[] = [];
    const states: StateSummary[] = [];
    const representatives: Array<{ state: string; pixels: Uint8ClampedArray }> = [];
    for (let rowIndex = 0; rowIndex < ANIMATION_ROWS.length; rowIndex += 1) {
      const row = ANIMATION_ROWS[rowIndex];
      const bounds = Array.from({ length: row.frames }, (_, frame) => (
        boundsForCell(data, bitmap.width, rowIndex, frame, row.state)
      ));
      const cells = Array.from({ length: row.frames }, (_, frame) => (
        cropPixels(data, bitmap.width, rowIndex, frame, {
          x: 0,
          y: 0,
          width: CELL_WIDTH,
          height: CELL_HEIGHT,
        })
      ));
      frameBounds.push(...bounds);
      states.push(summarizeState(rowIndex, row, bounds, cells));
      representatives.push({
        state: row.state,
        pixels: cells[Math.floor(row.frames / 2)],
      });
    }
    const stateComparisons: StateComparison[] = [];
    for (let first = 0; first < representatives.length; first += 1) {
      for (let second = first + 1; second < representatives.length; second += 1) {
        stateComparisons.push({
          first: representatives[first].state,
          second: representatives[second].state,
          diffPixels: diffPixels(representatives[first].pixels, representatives[second].pixels),
          cellPixels: CELL_WIDTH * CELL_HEIGHT,
        });
      }
    }

    const rowCount = bitmap.height / CELL_HEIGHT;
    if (input.profile === 'v2' && rowCount >= LOOK_START_ROW + 2) {
      for (let row = LOOK_START_ROW; row < LOOK_START_ROW + 2; row += 1) {
        for (let frame = 0; frame < ATLAS_COLUMNS; frame += 1) {
          frameBounds.push(boundsForCell(data, bitmap.width, row, frame, null));
        }
      }
    }

    const sheets: Record<string, string> = {};
    for (let rowIndex = 0; rowIndex < ANIMATION_ROWS.length; rowIndex += 1) {
      const row = ANIMATION_ROWS[rowIndex];
      const bounds = frameBounds.filter((item) => item.state === row.state);
      const summary = states[rowIndex];
      sheets[`state-${row.state}`] = drawStateSheet(bitmap, rowIndex, row, bounds, summary);
      if (row.state === 'idle') {
        sheets['idle-heads'] = drawHeadStrip(bitmap, rowIndex, row, bounds);
      }
      if (row.state === 'jumping') {
        sheets['jump-baseline'] = drawJumpBaseline(bitmap, rowIndex, row, bounds);
      }
    }
    sheets['idle-reference'] = drawIdleReference(bitmap);

    let gaze: GazeAnalysis | null = null;
    if (input.profile === 'v2' && rowCount >= LOOK_START_ROW + 2) {
      gaze = analyzeGaze(data, bitmap.width);
      sheets['gaze-directions'] = drawGazeGrid(bitmap, input.profile, gaze);
      sheets['gaze-heads'] = drawGazeHeads(bitmap, input.profile, gaze);
      sheets['gaze-eyes'] = drawGazeEyes(bitmap, input.profile, gaze);
    }

    const jump = states.find((item) => item.state === 'jumping');
    return {
      width: bitmap.width,
      height: bitmap.height,
      profile: input.profile,
      encodedBytes: input.encodedBytes,
      inspection,
      frameBounds,
      states,
      stateComparisons,
      jumpBottoms: jump?.bottoms ?? [],
      gaze,
      sheets,
    };
  } finally {
    bitmap.close();
  }
}

window.__atlasVisualQa = { analyze };

const ready = document.querySelector<HTMLElement>('#ready');
if (ready) {
  ready.dataset.ready = 'true';
}
