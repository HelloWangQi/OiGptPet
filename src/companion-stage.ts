import { VrmStage } from '../packages/renderer-vrm';
import { SpriteStage, SPRITE_MAX_CANVAS_DIMENSION } from '../packages/renderer-sprite';
import type { ModelInfo } from '../packages/character-core/vrm-file';
import type { AnimationState, AtlasProfile } from '../packages/target-chatgpt/contract';

export type CompanionInput =
  | { kind: 'vrm'; blob: Blob }
  | { kind: 'sprite'; blob: Blob; profile: AtlasProfile };

export interface PreparedCompanion {
  readonly input: CompanionInput;
  readonly info: ModelInfo | null;
  commit(): void;
  dispose(): void;
}

/** Keeps the visible renderer alive until a replacement has loaded and saved. */
export class CompanionStage {
  private current?: VrmStage | SpriteStage;
  private kind: CompanionInput['kind'] = 'vrm';
  private revision = 0;
  private pending?: () => void;
  private disposed = false;
  private size = { width: 320, height: 420, ratio: 1 };

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
    const candidate = input.kind === 'vrm' ? new VrmStage(canvas) : new SpriteStage(canvas);
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
      let info: ModelInfo | null = null;
      if (candidate instanceof VrmStage) {
        const bytes = await input.blob.arrayBuffer();
        check();
        info = await candidate.load(bytes);
      }
      else await candidate.load(input.blob, input.kind === 'sprite' ? input.profile : 'v2', controller.signal);
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

  render(state: AnimationState, seconds: number, delta: number, look?: { yaw: number; pitch: number; angle: number }) {
    if (this.current instanceof SpriteStage) this.current.render(state, seconds, look?.angle);
    else this.current?.render(state, seconds / 2, delta, look);
  }

  hitTest(x: number, y: number) { return this.current?.hitTest(x, y) ?? false; }
  get sourceKind() { return this.kind; }

  dispose() {
    this.disposed = true;
    ++this.revision;
    this.pending?.();
    this.current?.dispose();
    this.current = undefined;
  }
}
