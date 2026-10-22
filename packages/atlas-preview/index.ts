import {
  ANIMATION_ROWS,
  CELL_HEIGHT,
  CELL_WIDTH,
  type AnimationState,
  type AtlasInspection,
  type AtlasProfile,
} from '../target-chatgpt/contract';
import { getAnimationFrameRect, getLookFrameRect, inspectAtlas } from '../atlas-tools';
import { validateAtlasMetadata, validateAtlasPreflight } from './input';
import { sha256Hex } from './sha256';

export interface AtlasPreviewResult {
  blob: Blob;
  profile: AtlasProfile;
  inspection: AtlasInspection;
  sha256: string;
  encodedBytes: number;
}

export interface AtlasPreviewController {
  load(blob: Blob, profile: AtlasProfile, signal?: AbortSignal): Promise<AtlasPreviewResult>;
  dispose(): void;
}

const PLAYBACK_INTERVAL_MS = 125;
const LOOK_DIRECTION_COUNT = 16;
const LOOK_STEP_DEGREES = 360 / LOOK_DIRECTION_COUNT;
const FPS = 8;

const WIDGET_CSS = `
.atlas-preview-widget {
  --atlas-preview-border: #d7dbe2;
  --atlas-preview-text: #1f2937;
  --atlas-preview-muted: #5b6472;
  --atlas-preview-accent: #0f766e;
  --atlas-preview-danger: #b42318;
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  max-width: 360px;
  color: var(--atlas-preview-text);
  font: 13px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
}
.atlas-preview-widget *,
.atlas-preview-widget *::before,
.atlas-preview-widget *::after {
  box-sizing: border-box;
}
.atlas-preview-widget [hidden] {
  display: none !important;
}
.atlas-preview-widget__header {
  display: flex;
  align-items: center;
  gap: 8px;
}
.atlas-preview-widget__title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}
.atlas-preview-widget__badge {
  border: 1px solid var(--atlas-preview-border);
  border-radius: 999px;
  padding: 0 7px;
  color: var(--atlas-preview-muted);
  font-size: 11px;
  line-height: 18px;
}
.atlas-preview-widget__status {
  margin: 0;
  font-weight: 600;
  color: var(--atlas-preview-muted);
}
.atlas-preview-widget[data-atlas-valid="true"] .atlas-preview-widget__status {
  color: var(--atlas-preview-accent);
}
.atlas-preview-widget[data-atlas-valid="false"] .atlas-preview-widget__status,
.atlas-preview-widget[data-atlas-valid="error"] .atlas-preview-widget__status {
  color: var(--atlas-preview-danger);
}
.atlas-preview-widget__message,
.atlas-preview-widget__meta,
.atlas-preview-widget__frame,
.atlas-preview-widget__note {
  margin: 0;
  color: var(--atlas-preview-muted);
  font-size: 12px;
}
.atlas-preview-widget__meta {
  overflow-wrap: anywhere;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 11px;
}
.atlas-preview-widget__errors {
  margin: 0;
  padding: 8px 8px 8px 24px;
  max-height: 160px;
  overflow: auto;
  border: 1px solid #f1c0bb;
  border-radius: 6px;
  background: #fff6f5;
  color: var(--atlas-preview-danger);
  font-size: 12px;
}
.atlas-preview-widget__warnings {
  color: var(--atlas-preview-muted);
  font-size: 12px;
}
.atlas-preview-widget__warnings summary {
  cursor: pointer;
}
.atlas-preview-widget__warnings ul {
  margin: 6px 0 0;
  padding-left: 20px;
}
.atlas-preview-widget__stage {
  align-self: flex-start;
  width: 288px;
  max-width: 100%;
  border: 1px solid var(--atlas-preview-border);
  border-radius: 6px;
  background-color: #f8fafc;
  background-image:
    linear-gradient(45deg, #e8edf3 25%, transparent 25%),
    linear-gradient(-45deg, #e8edf3 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #e8edf3 75%),
    linear-gradient(-45deg, transparent 75%, #e8edf3 75%);
  background-position: 0 0, 0 8px, 8px -8px, -8px 0;
  background-size: 16px 16px;
  overflow: hidden;
}
.atlas-preview-widget__canvas {
  display: block;
  width: 100%;
  height: auto;
  aspect-ratio: 192 / 208;
  image-rendering: pixelated;
}
.atlas-preview-widget__controls {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.atlas-preview-widget__field {
  display: flex;
  align-items: center;
  gap: 8px;
}
.atlas-preview-widget__field label {
  flex: 0 0 36px;
  color: var(--atlas-preview-muted);
  font-size: 12px;
}
.atlas-preview-widget__select {
  flex: 1 1 auto;
  min-width: 0;
  border: 1px solid var(--atlas-preview-border);
  border-radius: 5px;
  background: #ffffff;
  color: inherit;
  padding: 4px 6px;
  font: inherit;
}
.atlas-preview-widget__buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.atlas-preview-widget__button {
  border: 1px solid var(--atlas-preview-border);
  border-radius: 5px;
  background: #ffffff;
  color: inherit;
  padding: 4px 10px;
  font: inherit;
  cursor: pointer;
}
.atlas-preview-widget__button:disabled,
.atlas-preview-widget__select:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.atlas-preview-widget__button:focus-visible,
.atlas-preview-widget__select:focus-visible {
  outline: 2px solid var(--atlas-preview-accent);
  outline-offset: 1px;
}
`;

let instanceSequence = 0;

interface PreviewUi {
  root: HTMLDivElement;
  status: HTMLParagraphElement;
  message: HTMLParagraphElement;
  meta: HTMLParagraphElement;
  errors: HTMLUListElement;
  warnings: HTMLDetailsElement;
  warningList: HTMLUListElement;
  stage: HTMLDivElement;
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  controls: HTMLDivElement;
  actionField: HTMLDivElement;
  action: HTMLSelectElement;
  lookField: HTMLDivElement;
  look: HTMLSelectElement;
  play: HTMLButtonElement;
  previous: HTMLButtonElement;
  next: HTMLButtonElement;
  frame: HTMLSpanElement;
}

type PreviewMode = 'none' | 'animation' | 'look';

function abortError(message = '图集预览加载已取消。'): DOMException {
  return new DOMException(message, 'AbortError');
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kibibytes = bytes / 1024;
  if (kibibytes < 1024) {
    return `${kibibytes.toFixed(1)} KiB`;
  }
  return `${(kibibytes / 1024).toFixed(2)} MiB`;
}

function wrapIndex(value: number, length: number): number {
  return ((value % length) + length) % length;
}

function gazeLabel(index: number): string {
  const angle = index * LOOK_STEP_DEGREES;
  const angleText = Number.isInteger(angle) ? String(angle) : angle.toFixed(1);
  const cardinal = index === 0
    ? ' 上'
    : index === 4
      ? ' 右'
      : index === 8
        ? ' 下'
        : index === 12
          ? ' 左'
          : '';
  return `${angleText}°${cardinal}`;
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  return node;
}

function buildActionField(id: string): { field: HTMLDivElement; select: HTMLSelectElement } {
  const field = createElement('div', 'atlas-preview-widget__field');
  const label = createElement('label');
  label.textContent = '动作';
  const select = createElement('select', 'atlas-preview-widget__select');
  select.id = `${id}-action`;
  select.dataset.atlasAction = '';
  label.htmlFor = select.id;
  for (const row of ANIMATION_ROWS) {
    const option = createElement('option');
    option.value = row.state;
    option.textContent = `${row.label}（${row.frames} 帧）`;
    select.append(option);
  }
  select.value = 'idle';
  select.disabled = true;
  field.append(label, select);
  return { field, select };
}

function buildLookField(id: string): { field: HTMLDivElement; select: HTMLSelectElement } {
  const field = createElement('div', 'atlas-preview-widget__field');
  field.dataset.atlasGazeField = '';
  const label = createElement('label');
  label.textContent = '视线';
  const select = createElement('select', 'atlas-preview-widget__select');
  select.id = `${id}-gaze`;
  select.dataset.atlasGaze = '';
  label.htmlFor = select.id;
  for (let index = 0; index < LOOK_DIRECTION_COUNT; index += 1) {
    const option = createElement('option');
    option.value = String(index);
    option.textContent = gazeLabel(index);
    select.append(option);
  }
  select.value = '0';
  select.disabled = true;
  field.append(label, select);
  return { field, select };
}

function buildButton(text: string, attribute: string): HTMLButtonElement {
  const button = createElement('button', 'atlas-preview-widget__button');
  button.type = 'button';
  button.textContent = text;
  button.setAttribute(attribute, '');
  button.disabled = true;
  return button;
}

function buildUi(host: HTMLElement): PreviewUi {
  const instanceId = `atlas-preview-${++instanceSequence}`;
  const root = createElement('div', 'atlas-preview-widget');
  root.dataset.atlasValid = 'pending';
  root.dataset.atlasMode = 'none';
  root.dataset.atlasPlaying = 'false';

  const style = createElement('style');
  style.textContent = WIDGET_CSS;

  const header = createElement('div', 'atlas-preview-widget__header');
  const title = createElement('h3', 'atlas-preview-widget__title');
  title.textContent = '图集预览';
  const badge = createElement('span', 'atlas-preview-widget__badge');
  badge.textContent = '本地检查';
  header.append(title, badge);

  const status = createElement('p', 'atlas-preview-widget__status');
  status.dataset.atlasStatus = '';
  status.setAttribute('aria-live', 'polite');
  status.textContent = '本地结构检查：未载入';

  const message = createElement('p', 'atlas-preview-widget__message');
  message.dataset.atlasMessage = '';
  message.hidden = true;

  const meta = createElement('p', 'atlas-preview-widget__meta');
  meta.dataset.atlasMeta = '';
  meta.hidden = true;

  const errors = createElement('ul', 'atlas-preview-widget__errors');
  errors.dataset.atlasErrors = '';
  errors.hidden = true;

  const warnings = createElement('details', 'atlas-preview-widget__warnings');
  warnings.dataset.atlasWarnings = '';
  warnings.hidden = true;
  const summary = createElement('summary');
  summary.textContent = '检查范围说明';
  const warningList = createElement('ul');
  warnings.append(summary, warningList);

  const stage = createElement('div', 'atlas-preview-widget__stage');
  const canvas = createElement('canvas', 'atlas-preview-widget__canvas');
  canvas.width = CELL_WIDTH;
  canvas.height = CELL_HEIGHT;
  canvas.dataset.atlasCanvas = '';
  stage.append(canvas);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new Error('无法创建图集预览所需的 Canvas 2D 上下文。');
  }

  const controls = createElement('div', 'atlas-preview-widget__controls');
  const { field: actionField, select: action } = buildActionField(instanceId);
  const { field: lookField, select: look } = buildLookField(instanceId);

  const buttons = createElement('div', 'atlas-preview-widget__buttons');
  const play = buildButton('播放', 'data-atlas-play');
  const previous = buildButton('上一帧', 'data-atlas-prev');
  const next = buildButton('下一帧', 'data-atlas-next');
  buttons.append(play, previous, next);

  const frame = createElement('span', 'atlas-preview-widget__frame');
  frame.dataset.atlasFrame = '';
  frame.textContent = '未载入';

  const note = createElement('p', 'atlas-preview-widget__note');
  note.dataset.atlasScopeNote = '';
  note.textContent = '本地结构检查不等同于目标平台预检或安装；后两者均未执行。';

  controls.append(actionField, buttons, frame);
  root.append(
    style,
    header,
    status,
    message,
    meta,
    errors,
    warnings,
    stage,
    controls,
    note,
  );
  host.append(root);

  return {
    root,
    status,
    message,
    meta,
    errors,
    warnings,
    warningList,
    stage,
    canvas,
    context,
    controls,
    actionField,
    action,
    lookField,
    look,
    play,
    previous,
    next,
    frame,
  };
}

function assertBlob(value: Blob): void {
  if (
    value === null
    || typeof value !== 'object'
    || typeof value.arrayBuffer !== 'function'
    || typeof value.size !== 'number'
    || typeof value.type !== 'string'
  ) {
    throw new TypeError('图集预览只接受 Blob 输入。');
  }
}

class AtlasPreview implements AtlasPreviewController {
  private readonly ui: PreviewUi;
  private readonly events = new AbortController();
  private generation = 0;
  private activeLoad: AbortController | null = null;
  private disposed = false;
  private bitmap: ImageBitmap | null = null;
  private result: AtlasPreviewResult | null = null;
  private mode: PreviewMode = 'none';
  private action: AnimationState = 'idle';
  private frameIndex = 0;
  private gazeDirection = 0;
  private playing = false;
  private timer: number | null = null;

  constructor(host: HTMLElement) {
    this.ui = buildUi(host);
    const options = { signal: this.events.signal };
    this.ui.action.addEventListener('change', () => this.handleActionChange(), options);
    this.ui.look.addEventListener('change', () => this.handleGazeChange(), options);
    this.ui.play.addEventListener('click', () => this.togglePlayback(), options);
    this.ui.previous.addEventListener('click', () => this.stepFrame(-1), options);
    this.ui.next.addEventListener('click', () => this.stepFrame(1), options);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.stopPlayback();
      }
    }, options);
  }

  async load(blob: Blob, profile: AtlasProfile, signal?: AbortSignal): Promise<AtlasPreviewResult> {
    if (this.disposed) {
      throw abortError('图集预览组件已销毁。');
    }
    if (signal?.aborted) {
      throw abortError();
    }

    const generation = ++this.generation;
    this.activeLoad?.abort();
    const controller = new AbortController();
    this.activeLoad = controller;
    const relayAbort = () => controller.abort();
    signal?.addEventListener('abort', relayAbort, { once: true });

    this.beginLoading();
    try {
      return await this.performLoad(blob, profile, controller.signal, generation);
    } catch (error) {
      if (this.disposed || generation !== this.generation) {
        throw abortError();
      }
      if (controller.signal.aborted) {
        this.showCancelled();
        throw abortError();
      }
      this.showFailure(error);
      throw error instanceof Error ? error : new Error(String(error));
    } finally {
      signal?.removeEventListener('abort', relayAbort);
      if (this.activeLoad === controller) {
        this.activeLoad = null;
      }
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.generation += 1;
    this.activeLoad?.abort();
    this.activeLoad = null;
    this.stopPlayback();
    this.closeBitmap();
    this.result = null;
    this.events.abort();
    this.ui.lookField.remove();
    this.ui.root.remove();
  }

  private async performLoad(
    blob: Blob,
    profile: AtlasProfile,
    signal: AbortSignal,
    generation: number,
  ): Promise<AtlasPreviewResult> {
    assertBlob(blob);
    validateAtlasPreflight(profile, blob.size, blob.type);
    this.throwIfStale(generation, signal);

    const buffer = await blob.arrayBuffer();
    this.throwIfStale(generation, signal);
    const header = validateAtlasMetadata(
      { bytes: new Uint8Array(buffer), size: blob.size, mime: blob.type },
      profile,
    );

    const sha256 = await sha256Hex(buffer, { signal });
    this.throwIfStale(generation, signal);

    let bitmap: ImageBitmap | null = null;
    try {
      try {
        bitmap = await createImageBitmap(blob, {
          colorSpaceConversion: 'none',
          premultiplyAlpha: 'none',
        });
      } catch (error) {
        throw new Error(`无法解码图集图片：${errorMessage(error)}`);
      }
      this.throwIfStale(generation, signal);

      if (bitmap.width !== header.width || bitmap.height !== header.height) {
        throw new Error(
          `解码后的图集尺寸为 ${bitmap.width}×${bitmap.height}，与文件头声明的 ${header.width}×${header.height} 不一致。`,
        );
      }

      const data = this.readPixels(bitmap);
      const inspection = inspectAtlas(
        { width: bitmap.width, height: bitmap.height, data },
        profile,
        blob.size,
      );
      const result: AtlasPreviewResult = {
        blob,
        profile,
        inspection,
        sha256,
        encodedBytes: blob.size,
      };

      this.throwIfStale(generation, signal);
      if (!inspection.valid) {
        bitmap.close();
        bitmap = null;
        this.commitInvalid(result);
        return result;
      }

      this.commitValid(result, bitmap);
      bitmap = null;
      return result;
    } finally {
      bitmap?.close();
    }
  }

  private readPixels(bitmap: ImageBitmap): Uint8ClampedArray {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      throw new Error('无法创建用于像素检查的 Canvas 2D 上下文。');
    }
    context.drawImage(bitmap, 0, 0);
    return context.getImageData(0, 0, bitmap.width, bitmap.height).data;
  }

  private throwIfStale(generation: number, signal: AbortSignal): void {
    if (this.disposed || generation !== this.generation || signal.aborted) {
      throw abortError();
    }
  }

  private beginLoading(): void {
    this.stopPlayback();
    this.closeBitmap();
    this.result = null;
    this.mode = 'none';
    this.ui.root.dataset.atlasValid = 'pending';
    this.ui.root.dataset.atlasMode = 'none';
    this.ui.status.textContent = '本地结构检查：正在解码并检查…';
    this.ui.message.hidden = true;
    this.ui.message.textContent = '';
    this.clearMeta();
    this.ui.errors.replaceChildren();
    this.ui.errors.hidden = true;
    this.ui.warningList.replaceChildren();
    this.ui.warnings.hidden = true;
    this.ui.lookField.remove();
    this.clearCanvas();
    this.ui.frame.textContent = '正在检查…';
    this.ui.action.value = 'idle';
    this.setControlsEnabled(false);
  }

  private commitValid(result: AtlasPreviewResult, bitmap: ImageBitmap): void {
    this.stopPlayback();
    this.result = result;
    this.bitmap = bitmap;
    this.mode = 'animation';
    this.action = 'idle';
    this.frameIndex = 0;
    this.gazeDirection = 0;

    this.ui.root.dataset.atlasValid = 'true';
    this.ui.status.textContent = '本地结构检查：通过（结构完整）';
    this.ui.message.hidden = true;
    this.ui.message.textContent = '';
    this.ui.errors.replaceChildren();
    this.ui.errors.hidden = true;
    this.ui.warningList.replaceChildren(...result.inspection.warnings.map((warning) => {
      const item = createElement('li');
      item.textContent = warning;
      return item;
    }));
    this.ui.warnings.hidden = false;
    this.ui.warnings.open = false;
    this.showMeta(result);

    if (result.profile === 'v2') {
      if (!this.ui.lookField.isConnected) {
        this.ui.controls.insertBefore(this.ui.lookField, this.ui.actionField.nextSibling);
      }
    } else {
      this.ui.lookField.remove();
    }

    this.ui.action.value = 'idle';
    this.ui.look.value = '0';
    this.setControlsEnabled(true);
    this.render();
  }

  private commitInvalid(result: AtlasPreviewResult): void {
    this.stopPlayback();
    this.closeBitmap();
    this.result = result;
    this.mode = 'none';
    this.ui.root.dataset.atlasValid = 'false';
    this.ui.root.dataset.atlasMode = 'none';
    this.ui.status.textContent = `本地结构检查：未通过（${result.inspection.errors.length} 项问题）`;
    this.ui.message.hidden = false;
    this.ui.message.textContent = '结构检查未通过；该文件不能作为可播放图集，也不能作为保存依据。';
    this.ui.errors.replaceChildren(...result.inspection.errors.map((issue) => {
      const item = createElement('li');
      item.dataset.issueCode = issue.code;
      if (issue.row !== undefined) {
        item.dataset.row = String(issue.row);
      }
      if (issue.frame !== undefined) {
        item.dataset.frame = String(issue.frame);
      }
      item.textContent = issue.message;
      return item;
    }));
    this.ui.errors.hidden = false;
    this.ui.warningList.replaceChildren(...result.inspection.warnings.map((warning) => {
      const item = createElement('li');
      item.textContent = warning;
      return item;
    }));
    this.ui.warnings.hidden = false;
    this.ui.warnings.open = false;
    this.showMeta(result);
    this.ui.lookField.remove();
    this.setControlsEnabled(false);
    this.clearCanvas();
    this.ui.frame.textContent = '结构检查未通过';
    this.ui.root.dataset.atlasPlaying = 'false';
    this.ui.play.textContent = '播放';
  }

  private showFailure(error: unknown): void {
    this.stopPlayback();
    this.closeBitmap();
    this.result = null;
    this.mode = 'none';
    this.ui.root.dataset.atlasValid = 'error';
    this.ui.root.dataset.atlasMode = 'none';
    this.ui.status.textContent = '本地结构检查：无法执行';
    this.ui.message.hidden = false;
    this.ui.message.textContent = errorMessage(error);
    this.ui.errors.replaceChildren();
    this.ui.errors.hidden = true;
    this.ui.warningList.replaceChildren();
    this.ui.warnings.hidden = true;
    this.clearMeta();
    this.ui.lookField.remove();
    this.clearCanvas();
    this.ui.frame.textContent = '未载入';
    this.setControlsEnabled(false);
    this.ui.root.dataset.atlasPlaying = 'false';
    this.ui.play.textContent = '播放';
  }

  private showCancelled(): void {
    this.stopPlayback();
    this.closeBitmap();
    this.result = null;
    this.mode = 'none';
    this.ui.root.dataset.atlasValid = 'cancelled';
    this.ui.root.dataset.atlasMode = 'none';
    this.ui.status.textContent = '本地结构检查：已取消';
    this.ui.message.hidden = false;
    this.ui.message.textContent = '本次加载已取消，未保留上一份预览。';
    this.ui.errors.replaceChildren();
    this.ui.errors.hidden = true;
    this.ui.warningList.replaceChildren();
    this.ui.warnings.hidden = true;
    this.clearMeta();
    this.ui.lookField.remove();
    this.clearCanvas();
    this.ui.frame.textContent = '已取消';
    this.setControlsEnabled(false);
    this.ui.root.dataset.atlasPlaying = 'false';
    this.ui.play.textContent = '播放';
  }

  private showMeta(result: AtlasPreviewResult): void {
    this.ui.meta.hidden = false;
    this.ui.meta.textContent = `文件 ${formatBytes(result.encodedBytes)}（${result.encodedBytes} 字节） · SHA-256 ${result.sha256}`;
    this.ui.meta.dataset.bytes = String(result.encodedBytes);
    this.ui.meta.dataset.sha256 = result.sha256;
  }

  private clearMeta(): void {
    this.ui.meta.hidden = true;
    this.ui.meta.textContent = '';
    delete this.ui.meta.dataset.bytes;
    delete this.ui.meta.dataset.sha256;
  }

  private clearCanvas(): void {
    this.ui.context.clearRect(0, 0, CELL_WIDTH, CELL_HEIGHT);
    delete this.ui.canvas.dataset.row;
    delete this.ui.canvas.dataset.cell;
    delete this.ui.canvas.dataset.frameIndex;
    delete this.ui.canvas.dataset.frameCount;
    delete this.ui.canvas.dataset.directionIndex;
  }

  private setControlsEnabled(enabled: boolean): void {
    this.ui.action.disabled = !enabled;
    this.ui.play.disabled = !enabled;
    this.ui.previous.disabled = !enabled;
    this.ui.next.disabled = !enabled;
    if (this.ui.lookField.isConnected) {
      this.ui.look.disabled = !enabled;
    }
  }

  private closeBitmap(): void {
    if (this.bitmap) {
      this.bitmap.close();
      this.bitmap = null;
    }
  }

  private stopPlayback(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    this.playing = false;
    this.ui.root.dataset.atlasPlaying = 'false';
    this.ui.play.textContent = '播放';
  }

  private isPlayable(): boolean {
    return !this.disposed
      && this.bitmap !== null
      && this.result !== null
      && this.result.inspection.valid;
  }

  private frameCount(): number {
    return ANIMATION_ROWS.find((row) => row.state === this.action)?.frames ?? 1;
  }

  private handleActionChange(): void {
    if (!this.isPlayable()) {
      return;
    }
    this.stopPlayback();
    const selected = this.ui.action.value as AnimationState;
    this.action = ANIMATION_ROWS.some((row) => row.state === selected) ? selected : 'idle';
    this.mode = 'animation';
    this.frameIndex = 0;
    this.render();
  }

  private handleGazeChange(): void {
    if (!this.isPlayable() || this.result?.profile !== 'v2') {
      return;
    }
    this.stopPlayback();
    const selected = Number.parseInt(this.ui.look.value, 10);
    this.gazeDirection = Number.isInteger(selected)
      && selected >= 0
      && selected < LOOK_DIRECTION_COUNT
      ? selected
      : 0;
    this.mode = 'look';
    this.render();
  }

  private togglePlayback(): void {
    if (!this.isPlayable()) {
      return;
    }
    if (this.playing) {
      this.stopPlayback();
      return;
    }
    if (this.mode === 'look') {
      this.mode = 'animation';
      this.frameIndex = 0;
    }
    this.playing = true;
    this.ui.root.dataset.atlasPlaying = 'true';
    this.ui.play.textContent = '暂停';
    this.render();
    this.timer = window.setInterval(() => this.advance(), PLAYBACK_INTERVAL_MS);
  }

  private advance(): void {
    if (!this.isPlayable() || !this.playing || this.mode !== 'animation') {
      this.stopPlayback();
      return;
    }
    this.frameIndex = wrapIndex(this.frameIndex + 1, this.frameCount());
    this.render();
  }

  private stepFrame(delta: number): void {
    if (!this.isPlayable()) {
      return;
    }
    this.stopPlayback();
    if (this.mode === 'look' && this.result?.profile === 'v2') {
      this.gazeDirection = wrapIndex(this.gazeDirection + delta, LOOK_DIRECTION_COUNT);
      this.ui.look.value = String(this.gazeDirection);
      this.render();
      return;
    }
    this.mode = 'animation';
    this.frameIndex = wrapIndex(this.frameIndex + delta, this.frameCount());
    this.render();
  }

  private render(): void {
    if (this.disposed || !this.bitmap) {
      return;
    }

    this.ui.context.clearRect(0, 0, CELL_WIDTH, CELL_HEIGHT);
    if (this.mode === 'look' && this.result?.profile === 'v2') {
      const rect = getLookFrameRect(this.gazeDirection * LOOK_STEP_DEGREES);
      this.ui.context.drawImage(
        this.bitmap,
        rect.x,
        rect.y,
        CELL_WIDTH,
        CELL_HEIGHT,
        0,
        0,
        CELL_WIDTH,
        CELL_HEIGHT,
      );
      this.ui.canvas.dataset.row = String(Math.floor(rect.y / CELL_HEIGHT));
      this.ui.canvas.dataset.cell = String(Math.floor(rect.x / CELL_WIDTH));
      this.ui.canvas.dataset.frameIndex = String(this.gazeDirection);
      this.ui.canvas.dataset.frameCount = String(LOOK_DIRECTION_COUNT);
      this.ui.canvas.dataset.directionIndex = String(this.gazeDirection);
      this.ui.root.dataset.atlasMode = 'look';
      this.ui.frame.textContent = `视线帧 ${this.gazeDirection + 1} / ${LOOK_DIRECTION_COUNT} · ${gazeLabel(this.gazeDirection)}`;
      return;
    }

    const rect = getAnimationFrameRect(this.action, this.frameIndex / FPS);
    this.ui.context.drawImage(
      this.bitmap,
      rect.x,
      rect.y,
      CELL_WIDTH,
      CELL_HEIGHT,
      0,
      0,
      CELL_WIDTH,
      CELL_HEIGHT,
    );
    const count = this.frameCount();
    this.ui.canvas.dataset.row = String(Math.floor(rect.y / CELL_HEIGHT));
    this.ui.canvas.dataset.cell = String(Math.floor(rect.x / CELL_WIDTH));
    this.ui.canvas.dataset.frameIndex = String(this.frameIndex);
    this.ui.canvas.dataset.frameCount = String(count);
    delete this.ui.canvas.dataset.directionIndex;
    this.ui.root.dataset.atlasMode = 'animation';
    this.ui.frame.textContent = `动作帧 ${this.frameIndex + 1} / ${count}`;
  }
}

export function createAtlasPreview(host: HTMLElement): AtlasPreviewController {
  if (!(host instanceof HTMLElement)) {
    throw new TypeError('createAtlasPreview 需要一个 HTMLElement 宿主。');
  }
  return new AtlasPreview(host);
}
