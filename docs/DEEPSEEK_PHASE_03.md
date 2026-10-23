# 给 DeepSeek：阶段三精灵图桌宠渲染器（D11–D13）

日期：2026-10-23。共享工作区 `E:\GitWorkSpace\OiGptPet`，分支 `codex/desktop-prototype`，基线 `402bbf8`。Codex 已恢复开发，双方同时在原工作区修改各自文件；不另开 worktree、不切换分支。

## 目标

将已经能检查和预览的 v1/v2 图集，变成可供主桌宠调用的独立 Canvas 2D 渲染器。你的模块只负责解码、验证、绘制和透明命中；Codex 负责 Electron、设置、角色管理、持久化和动画调度。请读 `docs/PHASE_03.md` 后直接开工，不等待 UI。

## 文件范围

仅新增/修改：

```text
packages/renderer-sprite/**
tests/renderer-sprite.test.ts
tests/fixtures/renderer-sprite/**
scripts/renderer-sprite-smoke.mjs
docs/RENDERER_SPRITE.md
docs/DEEPSEEK_DELIVERY_03.md
```

不得改 `src/**`、`electron/**`、根配置、package/lock、主 smoke、打包脚本、旧包及共享契约。`atlas-preview`/`atlas-tools` 也暂不修改；发现阻断问题，附最小复现并报告，避免两人同时改共享文件。不增加依赖，不提交或推送，不运行主 `scripts/smoke.mjs`。

## D11：稳定接口与加载边界

从 `packages/renderer-sprite/index.ts` 导出：

```ts
import type { AnimationState, AtlasInspection, AtlasProfile } from '../target-chatgpt/contract';

export interface SpriteLoadResult {
  blob: Blob;
  profile: AtlasProfile;
  inspection: AtlasInspection;
  sha256: string;
  encodedBytes: number;
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

含义固定：

- `timeSeconds` 为当前动作的秒数，按现有 `getAnimationFrameRect` 的 8 fps 语义采样；由主程序计时，模块内不启动 RAF、interval 或其他播放循环。
- `lookAngleDegrees` 缺省则播放动作；v2 有值则显示按 22.5° 量化的最近视线方向，0° 上、顺时针。无穷/NaN 输入有明确定义的安全降级；v1 忽略 look 并继续动作。
- `load` 检查的是调用者原 Blob。复用 `atlas-preview/input.ts` 的格式/体积/尺寸校验、`sha256.ts` 的安全与非安全 HTTP 摘要、`inspectAtlas` 的结构检查。禁止仅按扩展名判断；PNG/WebP，<=20 MiB，固定 v1/v2 尺寸。
- 结构无效时 `load` 拒绝且携带清楚错误；不能标记 loaded=true 或继续显示上一个有效文件。返回的 blob 必须是同一个对象，哈希和字节数来自该实际文件。
- 最新一次 load 获胜。新 load 开始时清空旧画面/命中数据；过期、取消或销毁中的 decode 结果拒绝为 AbortError，释放迟到的 Bitmap。
- dispose 可重复调用；销毁后 load/render 不得恢复画面或资源。保存/上传/IPC/角色信息面板均由主程序处理。

## D12：绘制、缩放与透明命中

1. 始终取完整 192×208 单格，使用已有帧坐标函数，不进入透明尾格。动作切换由 timeSeconds=0 起始；不能复用另一个动作的行或帧索引。
2. 按完整单格等比 contain 到目标画布，居中留白；保留跳跃在格内的原始垂直位移。禁止逐帧裁切、重定位、重新缩放角色或改像素。
3. resize 的 width/height 为 CSS 像素；pixelRatio 缺省使用设备倍率并限制上限为 2，非有限或非正尺寸不产生巨大/非法 canvas。明确支持的最大画布尺寸，超限拒绝，不静默分配无界内存。
4. hitTest 参数与 VrmStage 一样是视口 client 坐标，必须结合最新 canvas.getBoundingClientRect、实际 contain 目标区、当前源帧与 alpha 数据映射。留白、越界、未加载和已 dispose 一律 false；透明像素穿透，以 alpha >=8 视为命中并在文档固定阈值。
5. DPR、CSS 缩放、不同容器比例、v2 视线和跳跃帧都要命中正确。不能用整张画布矩形或整个人物包围框代替 alpha 命中。
6. 可复用一次解码的像素数据；不要在每次 pointermove 中重新解码图集或读取整张大图。不要创建 WebGL context，不碰其他 canvas/全局样式。

## D13：独立验证和交付

- 使用程序构造的小面积、不对称透明图案验证帧序、视线量化、contain/DPR 与 alpha 命中，覆盖边界及极大时间输入；不要写只重复计算公式的测试冒充画布行为。
- 独立浏览器 fixture 和 smoke 用现有 Vite/Playwright/Electron 依赖，随机端口、独立用户目录与隐藏窗口；不碰 5173 服务或主用户数据。真实解码、实际绘制和资源探针要由 smoke 验证。
- 覆盖 v1/v2 PNG/WebP、污染格/缺帧、损坏或伪造格式、超限、重复加载、并发/取消/销毁、resize、不同动作/视线的命中；所有 bitmap 释放，无内部播放计时器。
- 真实输入优先使用本机 `artifacts/animation-fixes/run-04/atlas-v2.png` 及对应 v1；如验证熊少女源 VRM，仅通过已有独立导出脚本生成自己的新目录，输出仍在 artifacts 下，不改源模型或旧证据。**Fred 不得用于任何展示或测试；Shiro 未下载。**
- 在 `docs/RENDERER_SPRITE.md` 写接口、失败/取消约定、尺寸限制、坐标映射、alpha 阈值与集成示例。
- 在 `docs/DEEPSEEK_DELIVERY_03.md` 给出文件清单、实际命令与结果、真实输入/输出哈希、CPU/内存或解码耗时的测量条件、尚存问题及未执行项。性能数据不得变成跨硬件保证。
- 必须运行 `npx tsc --noEmit`、`npm test` 和独立 smoke；若 Codex 同时改主程序导致其他范围失败，记录准确错误，不抢改其文件。保持接口不变，如有实际必要先报告。

完成后停止编辑，交回上述说明，由 Codex 集成和统一提交。不要把本地结构通过写成 ChatGPT 官方预检/安装成功，也不要自行上传、激活或替换用户宠物。
