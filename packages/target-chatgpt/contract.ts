/** Shared integration contract. Keep changes coordinated with the desktop renderer. */
export type AtlasProfile = 'v1' | 'v2';
export type AnimationState =
  | 'idle' | 'running-right' | 'running-left' | 'waving' | 'jumping'
  | 'failed' | 'waiting' | 'running' | 'review';

export const CELL_WIDTH = 192;
export const CELL_HEIGHT = 208;
export const ATLAS_COLUMNS = 8;
export const MAX_ENCODED_BYTES = 20 * 1024 * 1024;
export const ANIMATION_ROWS: ReadonlyArray<{
  state: AnimationState; frames: number; label: string;
}> = [
  { state: 'idle', frames: 6, label: '待机' },
  { state: 'running-right', frames: 8, label: '向右移动' },
  { state: 'running-left', frames: 8, label: '向左移动' },
  { state: 'waving', frames: 4, label: '挥手' },
  { state: 'jumping', frames: 5, label: '跳跃' },
  { state: 'failed', frames: 8, label: '失落' },
  { state: 'waiting', frames: 6, label: '等待输入' },
  { state: 'running', frames: 6, label: '认真工作' },
  { state: 'review', frames: 6, label: '检查结果' },
];

export interface FrameRect { x: number; y: number; width: number; height: number }
export interface AtlasPixels { width: number; height: number; data: Uint8ClampedArray }
export interface AtlasIssue {
  code: 'dimensions' | 'pixel-data' | 'file-size' | 'empty-frame' | 'unused-cell' | 'opaque-background';
  message: string;
  row?: number;
  frame?: number;
}
export interface AtlasInspection {
  /** Structural inspection only; never implies official acceptance or semantic quality. */
  valid: boolean;
  profile: AtlasProfile;
  requiredFrames: number;
  errors: AtlasIssue[];
  warnings: string[];
}

export function atlasDimensions(profile: AtlasProfile) {
  return { width: CELL_WIDTH * ATLAS_COLUMNS, height: CELL_HEIGHT * (profile === 'v2' ? 11 : 9) };
}
