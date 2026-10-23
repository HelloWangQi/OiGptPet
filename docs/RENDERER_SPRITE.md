# 精灵图桌宠渲染器

实现日期：2026-10-23。独立的 Canvas 2D 渲染层，把已导出的 v1/v2 图集解码、检查并绘制到宿主提供的画布，同时提供逐像素透明命中。模块不依赖 Electron、Node、Three.js 或 WebGL，不新增运行时依赖，不启动播放循环，也不保存、上传或修改角色文件。

## 文件

```text
packages/renderer-sprite/index.ts          公开接口、加载生命周期、绘制与命中
tests/renderer-sprite.test.ts              22 项纯逻辑与假画布行为测试
tests/fixtures/renderer-sprite/            独立浏览器 fixture（程序化测试图案）
scripts/renderer-sprite-smoke.mjs          独立 Playwright/Electron smoke
```

复用的共享实现（本次未修改）：

- `packages/atlas-preview/input.ts`：profile / MIME / 体积 / 文件头 / 尺寸校验。
- `packages/atlas-preview/sha256.ts`：Web Crypto 优先、纯 JavaScript 回退的 SHA-256。
- `packages/atlas-tools/inspect.ts`：完整 RGBA 的逐格结构检查。
- `packages/atlas-tools/playback.ts`：8 fps 动作帧与 22.5° 视线帧坐标。

## 公开接口

```ts
import type {
  AnimationState,
  AtlasInspection,
  AtlasProfile,
} from '../target-chatgpt/contract';

export const SPRITE_ALPHA_HIT_THRESHOLD = 8;
export const SPRITE_MAX_CANVAS_DIMENSION = 4096;
export const SPRITE_MAX_PIXEL_RATIO = 2;

export interface SpriteLoadResult {
  blob: Blob;                 // 调用者传入的同一个 Blob
  profile: AtlasProfile;
  inspection: AtlasInspection; // 成功 resolve 时 valid 恒为 true
  sha256: string;              // 实际字节的小写十六进制摘要
  encodedBytes: number;        // 等于 blob.size
}

export type SpriteStageErrorCode = 'inspection' | 'decode' | 'canvas';

export class SpriteStageError extends Error {
  readonly code: SpriteStageErrorCode;
  readonly inspection: AtlasInspection | null; // code 为 inspection 时携带
}

export class SpriteStage {
  constructor(canvas: HTMLCanvasElement);
  load(blob: Blob, profile: AtlasProfile, signal?: AbortSignal): Promise<SpriteLoadResult>;
  resize(width: number, height: number, pixelRatio?: number): void;
  render(state: AnimationState, timeSeconds: number, lookAngleDegrees?: number): void;
  hitTest(clientX: number, clientY: number): boolean;
  readonly loaded: boolean;
  dispose(): void;
}
```

`constructor` 只保存宿主画布并获取一次 2D 上下文，不修改全局样式、不创建额外 DOM。无法取得 2D 上下文时抛出 `SpriteStageError`，`code === 'canvas'`。宿主应自行把画布放进自己的布局；`SpriteStage` 只设置画布的 `width` / `height` 与内联 CSS 尺寸。

`load` 成功 resolve 代表图集可用：`result.blob === blob`，`result.sha256` / `result.encodedBytes` 来自该实际文件，`result.inspection.valid === true`。结构无效不会 resolve，而是 reject `SpriteStageError('inspection')` 并附上完整 `inspection`，便于界面展示逐格错误。

## 加载、失败与取消

`load` 的顺序：

1. 同步清空当前画面、命中数据和上一份 Bitmap；`loaded` 立即变为 `false`。
2. 校验 profile、真实 `blob.size`（正整数、≤ 20 MiB）和 MIME（`image/png` / `image/webp`，缺失或与文件头不符都拒绝）。
3. 读取字节，按 PNG/WebP 文件头核对 v1（1536×1872）或 v2（1536×2288）尺寸。
4. 对该 Blob 的原始字节计算 SHA-256；非安全上下文自动走包内回退。
5. `createImageBitmap` 解码并核对解码尺寸。
6. 读取一次完整 RGBA，调用 `inspectAtlas` 检查空帧、污染格、不透明背景等问题。
7. 结构通过后建立 alpha 掩码并提交换入；否则关闭 Bitmap 并 reject。

| 情况 | 结果 |
| --- | --- |
| 有效 v1/v2 PNG/WebP，结构完整 | resolve；保留 1 个 Bitmap 与 alpha 掩码；画布在首次 `render` 前保持空白 |
| 可解码但结构无效 | reject `SpriteStageError`，`code === 'inspection'`，`inspection.valid === false`；不保留画面 |
| 损坏或无法解码 | reject `SpriteStageError`，`code === 'decode'` |
| profile / 体积 / MIME / 格式 / 尺寸不合格 | reject `AtlasInputError`，`code` 为 `profile` / `file-size` / `mime` / `format` / `dimensions` |
| 外部 signal 中止、被更新的 load 取代、加载中 dispose | reject `DOMException`，`name === 'AbortError'` |
| 传入已 aborted 的 signal | 先清空旧画面，再立即 reject `AbortError` |
| dispose 后调用 load / render / resize / hitTest | load reject `AbortError`；其余不产生画面或命中 |

非 `Blob` 输入抛出 `TypeError`。`signal` 只约束本次 load；load 完成后再中止同一 signal 不会清除已加载结果。

并发与资源：

- 新的 `load` 会中止旧 load；旧 Promise 以 `AbortError` 结束，旧任务即使稍后解码成功也不能写回。
- `decodeBitmap` 竞速监听中止信号，取消不必等待底层解码完成；迟到的 Bitmap 会立即 `close()`。
- 成功状态下始终只保留 1 个 ImageBitmap 和 1 份 alpha 掩码。掩码每像素 1 字节（v1 约 2.74 MiB，v2 约 3.35 MiB）。
- 不创建 Object URL，不创建 WebGL 上下文，不注册全局事件或样式。
- `dispose()` 可重复调用；会中止加载、释放 Bitmap/掩码/渲染状态并清空画布，销毁后不能恢复。

## 尺寸与 DPR

`resize(width, height, pixelRatio?)`：

- `width` / `height` 是 CSS 像素，必须是有限正数；否则抛出 `RangeError`，且不修改画布。
- 缺省倍率取 `devicePixelRatio`，无效时按 1；显式倍率必须是有限正数，否则抛出 `RangeError`。
- 无论默认还是显式倍率，最终都限制在 2 以内。
- backing 尺寸按四舍五入计算并至少为 1；任一维超过 **4096** 时抛出 `RangeError`，校验发生在写入 `canvas.width/height` 之前，不会静默分配超大画布。
- 成功后设置 backing 尺寸与内联 CSS 尺寸；若已有成功绘制，会按最近一次 `render` 参数立即重绘。
- 仅 `load` 后尚未 `render` 时，`resize` 不会凭空生成画面。

上限含义：单边 4096、DPR 封顶 2，最坏 backing 为 4096×4096（RGBA 原始约 64 MiB）。宿主仍应只分配实际桌面宠物需要的尺寸。

## 绘制语义

`render(state, timeSeconds, lookAngleDegrees?)`：

- 未加载、已 dispose 或加载失败时是安全的空操作；不会抛出、不会恢复旧画面。
- `state` 必须是共享契约中的九种动作之一；未知值由 `getAnimationFrameRect` 抛出 `Error`。
- `timeSeconds` 是当前动作开始后的秒数，按 **8 fps** 采样。非有限值或负数按 0 处理；极大值溢出为无穷时也回到第 0 帧。
- 动作切换由宿主把 `timeSeconds` 重置为 0；渲染器不保存“上一个动作”的帧索引，也不在内部计时。
- 传入 `lookAngleDegrees` 且 profile 为 v2 时，按 **22.5°** 量化到 16 个方向之一（0° 向上、顺时针，半格向上取整）；非有限角度降级为 0°。缺省角度播放动作。
- v1 忽略 `lookAngleDegrees`，始终播放动作帧。
- 只读取共享帧函数返回的 192×208 完整单格；不会进入尾部透明格，也不会跨行复用帧索引。
- 每次绘制先清空完整 backing 画布，再把完整单格等比 **contain** 到目标区并居中留白。角色不裁切、不重定位、不单独缩放；跳跃在格内的原始垂直位移完整保留。
- 不修改 `imageSmoothingEnabled` 等全局画布状态，不碰宿主其他 canvas。

“最新一帧”只由最近一次成功的 `render` 决定。宿主改变动作、时间或视线后，应先 `render`，再调用 `hitTest`；命中测试不会自行按当前时间重采样。

## 坐标映射与 alpha 命中

`hitTest(clientX, clientY)` 使用视口 client 坐标，与 `VrmStage.hitTest` 一致。顺序：

1. 未加载、已 dispose、从未成功 `render` 或坐标非有限时返回 `false`。
2. 读取最新的 `canvas.getBoundingClientRect()`；宽或高为 0 时返回 `false`。
3. client → backing：
   ```text
   backingX = (clientX - rect.left) / rect.width  * canvas.width
   backingY = (clientY - rect.top)  / rect.height * canvas.height
   ```
   因此 DPR 以及宿主 CSS 拉伸都会经过实际矩形映射。
4. 计算 contain 目标区：
   ```text
   scale = min(canvas.width / 192, canvas.height / 208)
   destW = 192 * scale
   destH = 208 * scale
   destX = (canvas.width  - destW) / 2
   destY = (canvas.height - destH) / 2
   ```
   落在目标区外（留白或越界）返回 `false`。
5. backing → 源单格：
   ```text
   column = floor((backingX - destX) / destW * 192)
   row    = floor((backingY - destY) / destH * 208)
   sourceX = lastFrame.sourceX + column
   sourceY = lastFrame.sourceY + row
   ```
6. 查询加载时建立一次的 alpha 掩码：**alpha >= 8 命中**，`0..7` 穿透。阈值导出为 `SPRITE_ALPHA_HIT_THRESHOLD`。

命中依据当前已绘制的源帧，而不是整张图集、整块画布矩形或人物包围框；透明像素内部同样会穿透。每次 pointer 事件只做常数时间查表，不重新解码、不读取整张大图。

## 集成示例

```ts
import { SpriteStage, SpriteStageError } from '../packages/renderer-sprite';
import type { AnimationState } from '../packages/target-chatgpt/contract';

const canvas = document.querySelector<HTMLCanvasElement>('#pet-canvas');
if (!canvas) throw new Error('缺少桌宠画布');

const stage = new SpriteStage(canvas);
stage.resize(192, 208); // CSS 尺寸；默认按 devicePixelRatio（上限 2）分配 backing

const abort = new AbortController();

async function loadPet(blob: Blob, profile: 'v1' | 'v2') {
  try {
    const result = await stage.load(blob, profile, abort.signal);
    // result.blob / result.sha256 / result.encodedBytes 可用于保存与一致性检查。
    stage.render('idle', 0);
    return result;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return null; // 取消、被新 load 取代或已销毁。
    }
    if (error instanceof SpriteStageError) {
      // error.code: 'inspection' | 'decode' | 'canvas'
      // inspection 失败时读取 error.inspection.errors（含 row/frame）。
    }
    // 其余通常是 AtlasInputError：profile / file-size / mime / format / dimensions。
    throw error;
  }
}

// 播放由宿主驱动，模块不创建 RAF/interval。
let state: AnimationState = 'idle';
let actionStartedAt = performance.now();
let lookAngle: number | undefined;

function frame(now: number) {
  const elapsed = (now - actionStartedAt) / 1000;
  stage.render(state, elapsed, lookAngle);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function setState(next: AnimationState) {
  state = next;
  actionStartedAt = performance.now(); // 动作切换从第 0 帧开始。
  lookAngle = undefined;
}

canvas.addEventListener('pointerdown', (event) => {
  if (stage.hitTest(event.clientX, event.clientY)) {
    // 命中不透明角色像素，继续处理点击。
  }
});

// 布局变化时由宿主调用；会保留最近一次渲染并立即重绘。
window.addEventListener('resize', () => stage.resize(192, 208));

// 卸载：先取消待完成加载，再释放。
abort.abort();
stage.dispose();
// 需要再次显示时创建新的 SpriteStage，不复用已销毁实例。
```

注意事项：

- 应用保存/上传时应直接使用 `result.blob`，不要重新编码。
- `stage.load` 一开始就会清空旧画面；界面应在 promise settle 前显示加载状态，不能继续把旧图集当成当前宠物。
- 只有 `load` resolve 后 `loaded` 才为 `true`，且首次 `render` 前命中恒为 `false`。
- 本模块只做本地解码、结构检查、绘制和透明命中；不判断动作语义、角色一致性或视觉质量，也不代表目标平台官方预检或安装成功。
- 不修改 `src/**`、`electron/**`，不负责 IPC、设置、角色管理、持久化或动画调度。

## 验证

```bash
npx tsc --noEmit
npm test -- tests/renderer-sprite.test.ts
node scripts/renderer-sprite-smoke.mjs
```

- 单元测试覆盖加载/哈希/同 Blob、结构失败清空、同步清屏、preflight、解码错误、latest-load-wins、取消与迟到 Bitmap、dispose、contain、8 fps 采样、v1/v2 视线、DPR 上限与重绘、非法 resize、跨 DPR/CSS 拉伸/留白的命中、alpha 7/8 边界、动作/视线/跳跃命中、pointer 移动不重读图集以及无内部计时器。
- 独立 smoke 用真实 `artifacts/animation-fixes/run-04/atlas-v1.png` 与 `atlas-v2.png` 验证解码、结构、哈希、绘制和透明命中；再用程序化不对称图案验证精确帧序、视线量化、完整单格边缘、contain/DPR/CSS 拉伸；并覆盖 WebP、非法输入、并发、取消、销毁和资源探针。
