import { CELL_HEIGHT, CELL_WIDTH, MAX_ENCODED_BYTES } from '../target-chatgpt/contract';

export const SPRITE_DANCE_STRIP_MAX_FRAMES = Math.floor(4096 / CELL_WIDTH);

export interface SpriteDanceStripInfo {
  frameCount: number;
  frameWidth: number;
  frameHeight: number;
}

export function inspectSpriteDanceStrip(width: number, height: number, encodedBytes: number): SpriteDanceStripInfo {
  if (!Number.isSafeInteger(encodedBytes) || encodedBytes <= 0 || encodedBytes > MAX_ENCODED_BYTES) {
    throw new RangeError(`舞蹈帧 PNG 必须小于等于 ${MAX_ENCODED_BYTES} 字节。`);
  }
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || height !== CELL_HEIGHT
    || width % CELL_WIDTH !== 0) {
    throw new RangeError(`舞蹈帧条带必须由横向排列的 ${CELL_WIDTH}×${CELL_HEIGHT} 像素帧组成。`);
  }
  const frameCount = width / CELL_WIDTH;
  if (frameCount < 2 || frameCount > SPRITE_DANCE_STRIP_MAX_FRAMES) {
    throw new RangeError(`舞蹈帧数量需为 2 到 ${SPRITE_DANCE_STRIP_MAX_FRAMES} 帧。`);
  }
  return { frameCount, frameWidth: CELL_WIDTH, frameHeight: CELL_HEIGHT };
}
