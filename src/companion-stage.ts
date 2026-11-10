import { SPRITE_MAX_CANVAS_DIMENSION } from '../packages/renderer-sprite';
import type { ModelInfo } from '../packages/character-core/vrm-file';
import type { AnimationState } from '../packages/target-chatgpt/contract';
import { createCompanionRenderer, type CompanionInput, type CompanionRenderer } from './renderer-adapters';
import type { VrmMotionClipInfo, VrmMotionLoopMode } from '../packages/renderer-vrm';
import type { MusicDanceSignal } from '../packages/character-core/music-dance';

export type { CompanionInput } from './renderer-adapters';

export interface PreparedCompanion {
  readonly input: CompanionInput;
  readonly info: ModelInfo | null;
  commit(): void;
  dispose(): void;
}

/** Keeps the visible renderer alive until a replacement has loaded and saved. */
export class CompanionStage {
  private current?: CompanionRenderer;
  private kind: CompanionInput['kind'] = 'vrm';
  private revision = 0;
  private pending?: () => void;
  private disposed = false;
  private size = { width: 320, height: 420, ratio: 1 };
  private speechMouthOpen = 0;
  private musicDanceSignal?: MusicDanceSignal;

  constructor(private canvas: HTMLCanvasElement) {}

  get loaded() { return Boolean(this.current?.loaded); }

  async prepare(input: CompanionInput, signal?: AbortSignal): Promise<PreparedCompanion> {
    if (this.disposed) throw new Error('角色画布已关闭。');
    const revision = ++this.revision;
    this.pending?.();
    const canvas = this.canvas.cloneNode(false) as HTMLCanvasElement;
    // SpriteStage writes pixel CSS sizes. A new VRM canvas must follow its host again.
    canvas.style.width = '';
    canvas.style.height = '';
    const candidate = createCompanionRenderer(input, canvas);
    const controller = new AbortController();
    let released = false;
    let committed = false;
    const release = () => {
      if (released || committed) return;
      released = true;
      controller.abort();
      candidate.dispose();
      signal?.removeEventListener('abort', release);
      if (this.pending === release) this.pending = undefined;
    };
    const check = () => {
      if (released || signal?.aborted || this.disposed || revision !== this.revision) {
        throw new DOMException('角色切换已取消。', 'AbortError');
      }
    };
    this.pending = release;
    signal?.addEventListener('abort', release, { once: true });
    try {
      check();
      const info: ModelInfo | null = await candidate.load(input, controller.signal);
      check();
      candidate.resize(this.size.width, this.size.height, this.size.ratio);
      return {
        input, info,
        commit: () => {
          if (committed) throw new Error('角色已完成切换。');
          check();
          candidate.resize(this.size.width, this.size.height, this.size.ratio);
          const previous = this.current;
          this.canvas.replaceWith(canvas);
          this.canvas = canvas;
          this.current = candidate;
          this.kind = input.kind;
          candidate.setSpeechMouthOpen(this.speechMouthOpen);
          candidate.setMusicDanceSignal?.(this.musicDanceSignal);
          committed = true;
          signal?.removeEventListener('abort', release);
          if (this.pending === release) this.pending = undefined;
          previous?.dispose();
        },
        dispose: release,
      };
    } catch (error) { release(); throw error; }
  }

  resize(width: number, height: number, ratio: number) {
    // A large browser viewport should reduce pixel density rather than throw in ResizeObserver.
    const boundedRatio = Math.min(ratio, SPRITE_MAX_CANVAS_DIMENSION / Math.max(width, height));
    this.size = { width, height, ratio: boundedRatio };
    this.current?.resize(width, height, boundedRatio);
  }

  render(state: AnimationState, seconds: number, delta: number, look?: { yaw: number; pitch: number; angle: number }, stateRevision?: number) {
    this.current?.render(state, seconds, delta, look, stateRevision);
  }

  hitTest(x: number, y: number) { return this.current?.hitTest(x, y) ?? false; }
  get sourceKind() { return this.kind; }

  setSpeechMouthOpen(amount: number) {
    this.speechMouthOpen = Math.min(1, Math.max(0, Number.isFinite(amount) ? amount : 0));
    this.current?.setSpeechMouthOpen(this.speechMouthOpen);
  }

  setMusicDanceSignal(signal: MusicDanceSignal | undefined) {
    this.musicDanceSignal = signal;
    this.current?.setMusicDanceSignal?.(signal);
  }

  async loadMotion(buffer: ArrayBuffer): Promise<VrmMotionClipInfo[]> {
    const renderer = this.current;
    if (!renderer?.loadMotion) throw new Error('VRM 动作预览仅适用于当前加载的 VRM 角色。');
    const clips = await renderer.loadMotion(buffer);
    if (renderer !== this.current) throw new DOMException('角色已切换，动作没有加载。', 'AbortError');
    return clips;
  }

  playMotion(index: number) {
    if (!this.current?.playMotion) throw new Error('当前角色不支持 VRM 动作预览。');
    this.current.playMotion(index);
  }

  toggleMotion() { return this.current?.toggleMotion?.() ?? false; }

  motionIsPlaying() { return this.current?.motionIsPlaying?.() ?? false; }

  setMotionPlaybackRate(rate: number) {
    if (!this.current?.setMotionPlaybackRate) throw new Error('当前角色不支持 VRM 动作速度控制。');
    this.current.setMotionPlaybackRate(rate);
  }

  setMotionLoopMode(mode: VrmMotionLoopMode) {
    if (!this.current?.setMotionLoopMode) throw new Error('当前角色不支持 VRM 动作循环模式。');
    this.current.setMotionLoopMode(mode);
  }

  seekMotion(index: number, seconds: number) {
    if (!this.current?.seekMotion) throw new Error('当前角色不支持 VRM 动作预览。');
    this.current.seekMotion(index, seconds);
  }

  motionTime(index: number) { return this.current?.motionTime?.(index); }

  clearMotion() { this.current?.clearMotion?.(); }

  dispose() {
    this.disposed = true;
    ++this.revision;
    this.pending?.();
    this.current?.dispose();
    this.current = undefined;
  }
}
