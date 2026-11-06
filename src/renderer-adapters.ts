import { VrmStage } from '../packages/renderer-vrm';
import type { VrmMotionClipInfo } from '../packages/renderer-vrm';
import { SpriteStage } from '../packages/renderer-sprite';
import type { ModelInfo } from '../packages/character-core/vrm-file';
import type { AnimationState, AtlasProfile } from '../packages/target-chatgpt/contract';

export type CompanionInput =
  | { kind: 'vrm'; blob: Blob }
  | { kind: 'sprite'; blob: Blob; profile: AtlasProfile };

export interface CompanionRenderer {
  readonly kind: CompanionInput['kind'];
  readonly loaded: boolean;
  load(input: CompanionInput, signal?: AbortSignal): Promise<ModelInfo | null>;
  resize(width: number, height: number, ratio: number): void;
  render(
    state: AnimationState,
    seconds: number,
    delta: number,
    look?: { yaw: number; pitch: number; angle: number },
    stateRevision?: number,
  ): void;
  hitTest(x: number, y: number): boolean;
  setSpeechMouthOpen(amount: number): void;
  loadMotion?(buffer: ArrayBuffer): Promise<VrmMotionClipInfo[]>;
  playMotion?(index: number): void;
  toggleMotion?(): boolean;
  setMotionPlaybackRate?(rate: number): void;
  seekMotion?(index: number, seconds: number): void;
  motionTime?(index: number): number | undefined;
  clearMotion?(): void;
  dispose(): void;
}

class VrmRenderer implements CompanionRenderer {
  readonly kind = 'vrm' as const;
  private readonly stage: VrmStage;

  constructor(canvas: HTMLCanvasElement) { this.stage = new VrmStage(canvas); }
  get loaded() { return this.stage.loaded; }

  async load(input: CompanionInput, signal?: AbortSignal): Promise<ModelInfo | null> {
    if (input.kind !== 'vrm') throw new TypeError('VRM 渲染器只能加载 VRM 角色。');
    const bytes = await input.blob.arrayBuffer();
    if (signal?.aborted) throw new DOMException('角色切换已取消。', 'AbortError');
    return this.stage.load(bytes);
  }

  resize(width: number, height: number, ratio: number) { this.stage.resize(width, height, ratio); }
  render(state: AnimationState, seconds: number, delta: number, look?: { yaw: number; pitch: number; angle: number }, stateRevision?: number) {
    if (stateRevision !== undefined) this.stage.render(state, seconds / 2, delta, look, stateRevision);
    else this.stage.render(state, seconds / 2, delta, look);
  }
  hitTest(x: number, y: number) { return this.stage.hitTest(x, y); }
  setSpeechMouthOpen(amount: number) { this.stage.setSpeechMouthOpen(amount); }
  loadMotion(buffer: ArrayBuffer) { return this.stage.loadMotion(buffer); }
  playMotion(index: number) { this.stage.playMotion(index); }
  toggleMotion() { return this.stage.toggleMotion(); }
  setMotionPlaybackRate(rate: number) { this.stage.setMotionPlaybackRate(rate); }
  seekMotion(index: number, seconds: number) { this.stage.seekMotion(index, seconds); }
  motionTime(index: number) { return this.stage.motionTime(index); }
  clearMotion() { this.stage.clearMotion(); }
  dispose() { this.stage.dispose(); }
}

class SpriteRenderer implements CompanionRenderer {
  readonly kind = 'sprite' as const;
  private readonly stage: SpriteStage;

  constructor(canvas: HTMLCanvasElement) { this.stage = new SpriteStage(canvas); }
  get loaded() { return this.stage.loaded; }

  async load(input: CompanionInput, signal?: AbortSignal): Promise<null> {
    if (input.kind !== 'sprite') throw new TypeError('精灵图渲染器只能加载精灵图角色。');
    await this.stage.load(input.blob, input.profile, signal);
    return null;
  }

  resize(width: number, height: number, ratio: number) { this.stage.resize(width, height, ratio); }
  render(state: AnimationState, seconds: number, delta: number, look?: { yaw: number; pitch: number; angle: number }, stateRevision?: number) {
    if (stateRevision !== undefined) this.stage.render(state, seconds, look?.angle, delta, stateRevision);
    else this.stage.render(state, seconds, look?.angle);
  }
  hitTest(x: number, y: number) { return this.stage.hitTest(x, y); }
  setSpeechMouthOpen(_amount: number) { /* Static sprite frames do not expose a live mouth parameter. */ }
  dispose() { this.stage.dispose(); }
}

export function createCompanionRenderer(input: CompanionInput, canvas: HTMLCanvasElement): CompanionRenderer {
  return input.kind === 'vrm' ? new VrmRenderer(canvas) : new SpriteRenderer(canvas);
}
