# Atlas 预览组件

实现日期：2026-10-22。浏览器端组件，用于重新解码**最终导出的 Blob**，执行结构检查并逐帧预览。它不依赖 Electron、Node、Three.js，不新增运行时依赖，也不保存、上传或生成角色美术。

## 文件

```text
packages/atlas-preview/index.ts        公开接口、DOM/Canvas 预览与生命周期
packages/atlas-preview/input.ts        profile / MIME / 体积 / 尺寸 / 文件头校验
packages/atlas-preview/image-format.ts PNG 与 WebP 文件头解析
packages/atlas-preview/sha256.ts       Web Crypto 优先 + 纯 JavaScript SHA-256 回退
tests/atlas-preview.test.ts            23 项纯逻辑测试
tests/fixtures/atlas-preview/          可运行 fixture（只生成测试图）
scripts/atlas-preview-smoke.mjs        独立 Playwright/Electron smoke
```

## 公开接口

```ts
import type { AtlasInspection, AtlasProfile } from '../target-chatgpt/contract';

export interface AtlasPreviewResult {
  blob: Blob;                 // 调用者传入的同一个 Blob
  profile: AtlasProfile;
  inspection: AtlasInspection;
  sha256: string;             // 小写十六进制
  encodedBytes: number;       // 等于 blob.size
}

export interface AtlasPreviewController {
  load(blob: Blob, profile: AtlasProfile, signal?: AbortSignal): Promise<AtlasPreviewResult>;
  dispose(): void;
}

export function createAtlasPreview(host: HTMLElement): AtlasPreviewController;
```

`createAtlasPreview` 只向传入的 `host` 追加一个 `.atlas-preview-widget` 根节点；不会清空宿主或操作宿主已有的其他子节点。一个宿主同时只应挂载一个控制器；关闭弹窗时调用 `dispose()`，重新打开时重新创建。

## 挂载、检查、关闭

```ts
import { createAtlasPreview } from '../packages/atlas-preview';

const host = document.querySelector<HTMLElement>('#export-inspection-host');
if (!host) throw new Error('缺少检查区域');

const preview = createAtlasPreview(host);
const abort = new AbortController();

try {
  // finalBlob 必须是实际导出的 PNG/WebP，不要传编码前画布或实时 VRM。
  const result = await preview.load(finalBlob, profile, abort.signal);

  if (!result.inspection.valid) {
    // 显示 result.inspection.errors（含 row/frame）和 warnings；
    // 禁用保存入口，不能把该文件当作通过检查的宠物图集。
  } else {
    // 保存时使用 result.blob，而不是另一个重新编码的 Blob。
    // result.sha256 / result.encodedBytes 与保存文件一致。
  }
} catch (error) {
  if (error instanceof DOMException && error.name === 'AbortError') {
    // 用户取消、被后续 load 取代或组件已销毁；不要更新“通过”状态。
  } else {
    // MIME/格式/尺寸/体积/解码失败；显示错误并禁用保存。
  }
} finally {
  // 仅在弹窗关闭、重新导出完成或不再使用时释放。
  // 不要在这里无条件 dispose，否则预览无法继续播放。
}

// 弹窗关闭时：
preview.dispose();
// 再次打开时重新 createAtlasPreview(host)，不要复用已销毁实例。
```

## 输入与失败约定

`load` 的顺序：

1. 检查 `Blob`、profile、真实 `blob.size`（必须为正且 ≤ 20 MiB）与 MIME。
2. 读取字节，验证 PNG/WebP 文件头声明的尺寸等于 v1（1536×1872）或 v2（1536×2288）。
3. 计算该 Blob 字节的 SHA-256（Web Crypto 优先；无 `crypto.subtle` 的局域网 HTTP 环境使用包内纯 JavaScript 回退）。
4. `createImageBitmap` 解码，核对解码尺寸。
5. 读取完整 RGBA，用真实 `blob.size` 调用 `inspectAtlas`。
6. 结构通过才保留 ImageBitmap、启用播放；结构失败关闭 Bitmap、显示逐格错误但**不播放**。

| 情况 | 结果 |
| --- | --- |
| 有效 v1/v2 PNG/WebP，结构完整 | resolve，`inspection.valid: true`，控件可用 |
| 可解码，但空帧、空白格污染、不透明背景等 | resolve，`inspection.valid: false`，显示错误，不播放 |
| 缺失 MIME、MIME 与文件头不一致、非 PNG/WebP、未知 profile、尺寸错误、超过 20 MiB、损坏/不可解码 | reject 普通 `Error`，显示“无法执行”，不保留上一份预览 |
| 外部取消、被更新的 load 取代、组件 dispose | reject `DOMException`，`name === 'AbortError'`；过期任务不能改 UI |
| 传入已 aborted 的 signal | 立即 reject `AbortError`，不改变当前已有预览 |
| dispose 后调用 load | reject `AbortError`，不创建 UI |

MIME 策略：

- 仅接受 `image/png` 或 `image/webp` 的基础类型（大小写不敏感，允许参数）。
- **缺失 MIME 明确拒绝**，不使用扩展名或字节猜测后“补上”MIME。
- MIME 与文件头不一致时拒绝，例如 WebP 字节标成 `image/png`。
- 文件头只用于快速校验与尺寸限制；实际内容仍需完整解码和逐格检查。

取消与并发：

- 同一控制器上新的 `load` 会中止旧的 load；旧 Promise 以 `AbortError` 拒绝。
- 新 load 开始时清理上一份 Bitmap、结果、错误和播放计时器；旧任务即使稍后完成也不能写回 UI。
- 外部取消会清理当前预览并显示“已取消”，不会保留之前的“通过”状态。
- `dispose()` 中止待完成 load、关闭 Bitmap、移除监听与计时器、删除自己的根节点；可重复调用。

## SHA-256：原生与回退路径

`load` 对传入 Blob 的原始字节计算 SHA-256，结果始终是小写、64 位十六进制。实现位于 `packages/atlas-preview/sha256.ts`：

1. 若 `globalThis.crypto.subtle.digest` 可用，优先走 Web Crypto；这是 localhost、HTTPS 和 Electron 安全上下文的常规路径。
2. 若不可用（典型情况是通过局域网 IP 的普通 HTTP 打开界面，`isSecureContext === false`），自动回退到包内纯 JavaScript SHA-256（FIPS 180-4）。回退不依赖 Node、不添加运行时依赖、不调用网络摘要服务；长度按 64 位大端编码，支持空输入和跨 64 字节块的数据。
3. 两条路径直接摘要调用者传入的 Blob 字节，不使用文件名、临时标识或替代算法；`result.blob` 仍是同一个 Blob。

回退路径每 512 KiB 为一批，批次之间通过 `scheduler.yield()`（不可用时 `setTimeout(0)`）让出事件循环并检查 `AbortSignal`。取消会在批次之间以 `AbortError` 结束。Web Crypto 的 `digest` 调用本身不可中断，因此原生路径在 digest 返回后立即检查取消，组件随后检查 generation；过期任务不会写回 UI。

2026-10-22 本机实测（仅用于量级参考，机器和负载不同会变化）：

| 输入 | 路径 | 耗时 |
| --- | --- | --- |
| 81,470 B v2 PNG fixture | Web Crypto | 0.3 ms |
| 81,470 B v2 PNG fixture | 纯 JavaScript（测试强制） | 3.9 ms |
| 20 MiB 零字节 | 纯 JavaScript | 334 ms，40 个批次/让出点，71 次计时器 tick |

主程序不需要按环境另写哈希实现，`load` 会自动选择路径。该摘要用于文件身份一致性检查，不作为密码学机密保护或恒定时间比较的实现。

## 控件与显示

- 九种动作来自共享契约，动作选择会暂停并重置到该动作第 0 帧。
- 播放/暂停、上一帧/下一帧、当前帧编号；播放按 8 fps（125 ms）循环，只在本动作真实帧数内循环，不会进入尾部透明格。
- v2 显示 16 方向视线选择；选择或单步方向会进入视线模式。单步在 0/15 边界循环。播放会回到动作模式。
- v1 不创建视线控件。
- 画布 backing store 固定为 192×208，CSS 保持 192 / 208 比例。
- 绘制时从图集复制**完整单格**到 192×208 画布，不裁切、不居中、不缩放单个角色、不重画像素；跳跃图集原有的垂直位置会被保留，导出缺陷会直接暴露。
- 默认不自动播放。`prefers-reduced-motion` 下同样不自动播放，用户仍可手动开始。
- `visibilitychange` 到隐藏状态时停止播放计时器；重新可见不自动恢复。
- 样式全部位于 `.atlas-preview-widget` 命名空间，样式节点也在组件根节点内，不覆盖全局 `button` / `body` / `canvas`。

## 供集成测试使用的稳定属性

| 元素 | 属性 |
| --- | --- |
| 根节点 | `data-atlas-valid`（`pending` / `true` / `false` / `error` / `cancelled`）、`data-atlas-mode`（`none` / `animation` / `look`）、`data-atlas-playing` |
| 状态 / 消息 | `[data-atlas-status]`、`[data-atlas-message]` |
| 文件信息 | `[data-atlas-meta]`，其 `data-sha256` / `data-bytes` |
| 错误 | `[data-atlas-errors] li[data-issue-code][data-row][data-frame]` |
| 画布 | `[data-atlas-canvas]`，`data-row` / `data-cell` / `data-frame-index` / `data-frame-count` / `data-direction-index`（均从 0 开始） |
| 控件 | `[data-atlas-action]`、`[data-atlas-gaze]`、`[data-atlas-play]`、`[data-atlas-prev]`、`[data-atlas-next]`、`[data-atlas-frame]` |

这些属性用于测试与主界面接线；文本内容可调整，属性名保持稳定。

## 资源生命周期

- 成功预览期间保留 **1 个** ImageBitmap；新 load、结构失败、取消、外部 signal 中止和 dispose 都会关闭它。
- 组件不创建 Object URL。主程序保存时直接使用 `result.blob`。
- 播放在暂停、动作切换、新 load、页面隐藏和 dispose 时清除 125 ms 计时器。
- DOM 事件通过同一个 `AbortController` 统一移除；dispose 只删除自己的根节点。
- 持续加载、并发 load、取消和关闭的资源清理由 smoke 用计数器验证，不依赖内存快照。

## 测试与 fixture

```bash
npm test -- tests/atlas-preview.test.ts tests/atlas-tools.test.ts
node scripts/atlas-preview-smoke.mjs
```

2026-10-22 实测：

- Vitest：`tests/atlas-preview.test.ts` 23 项、`tests/atlas-tools.test.ts` 23 项全部通过；全量 `npm test` 为 6 个文件、70 项通过。
- SHA-256 覆盖：空字节、`abc`、标准 64 字节消息、55/56/63/64/65/1000 字节、二进制零字节、真实 PNG/WebP 字节、原生路径、缺失 `crypto.subtle` 的强制回退、批次间取消和 20 MiB 回退。Node `crypto` 只在测试中作为对照，不进入浏览器模块。
- 独立 smoke：通过。使用独立随机端口 Vite fixture、临时 Electron 应用与临时用户数据目录；结束时关闭自己启动的进程并删除临时目录。
- 覆盖有效 v1/v2/WebP、损坏 PNG、错误 profile/MIME/尺寸、超限文件、空帧、污染空白格、动作切换与循环、单步、v2 视线边界、播放/暂停、页面隐藏、并发 load、取消、dispose 与重新挂载。
- 安全上下文（localhost 随机端口）：真实 `isSecureContext === true`、subtle 可用；81,470 B 图集原生与强制回退摘要一致（`16dcf8a…`），原生 0.3 ms、回退 3.9 ms。20 MiB 回退摘要 334 ms，每 512 KiB 让出一次，共 40 个让出点。
- 实际非 localhost HTTP（本机 LAN 地址 `http://192.168.160.1:<随机端口>/…`）：真实 `isSecureContext === false`、`crypto.subtle` 不可用；同一图集的回退摘要与安全上下文一致，预览仍可加载；新 load 取代旧 load 时旧任务以 `AbortError` 结束。smoke 记录实际 URL、传输方式、`isSecureContext` 与 subtle 可用性；只有 LAN 地址不可达时才用 `--host-resolver-rules` 的主机别名回退，并标记为别名而非局域网证据。localhost 成功不会被当成局域网成功。
- 资源探针结果：8 个 ImageBitmap 创建、8 个关闭，未完成数 0；活动 125 ms 计时器 0；组件创建 Object URL 0；页面错误 0。无 subtle 场景单独统计为 2 个创建、2 个关闭、未完成 0。
- 截图与 `result.json` 位于本机 `artifacts/atlas-preview-smoke/`，不提交 Git。

fixture 会程序化生成测试图集（只用于验证控件，不用于创建宠物），入口为 `tests/fixtures/atlas-preview/index.html`。smoke 以 `configFile: false`、仓库根为 Vite root 启动，不读取主应用配置，也不会修改主工坊窗口。

## 局限

- 只做本地结构检查与逐帧查看；不判断动作语义、角色一致性、视线正确性或视觉质量。
- 不替代目标平台预检、安装或实际播放验证；本地通过不会自动改变平台状态。
- 不保存文件、不上传、不修改主页面、不注册全局快捷键。
- 不提供 VRM 0.x 转 VRM 1.0，也不修改加载器绕过版本限制。
