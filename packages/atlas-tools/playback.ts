import {
  ANIMATION_ROWS,
  CELL_HEIGHT,
  CELL_WIDTH,
  type AnimationState,
  type FrameRect,
} from '../target-chatgpt/contract';

const DEFAULT_FPS = 8;
const LOOK_DIRECTIONS = 16;
const LOOK_STEP_DEGREES = 360 / LOOK_DIRECTIONS;
const LOOK_ROWS_START = 9;

function frameRect(row: number, frame: number): FrameRect {
  return {
    x: frame * CELL_WIDTH,
    y: row * CELL_HEIGHT,
    width: CELL_WIDTH,
    height: CELL_HEIGHT,
  };
}

function animationRowIndex(state: AnimationState): number {
  const index = ANIMATION_ROWS.findIndex((row) => row.state === state);
  if (index === -1) {
    throw new Error(
      `Unknown animation state: ${String(state)}. Expected one of: ${ANIMATION_ROWS.map((row) => row.state).join(', ')}.`,
    );
  }
  return index;
}

function effectiveFps(fps: number | undefined): number {
  return fps !== undefined && Number.isFinite(fps) && fps > 0 ? fps : DEFAULT_FPS;
}

export function getAnimationFrameRect(
  state: AnimationState,
  timeSeconds: number,
  fps: number = DEFAULT_FPS,
): FrameRect {
  const row = animationRowIndex(state);
  const frameCount = ANIMATION_ROWS[row].frames;
  const safeTime = Number.isFinite(timeSeconds) && timeSeconds > 0 ? timeSeconds : 0;
  const scaled = safeTime * effectiveFps(fps);
  const frame = Number.isFinite(scaled) ? Math.floor(scaled) % frameCount : 0;
  return frameRect(row, frame);
}

export function getLookFrameRect(angleDegrees: number): FrameRect {
  const normalized = Number.isFinite(angleDegrees)
    ? ((angleDegrees % 360) + 360) % 360
    : 0;
  const direction = Math.round(normalized / LOOK_STEP_DEGREES) % LOOK_DIRECTIONS;
  const row = LOOK_ROWS_START + Math.floor(direction / 8);
  const frame = direction % 8;
  return frameRect(row, frame);
}
