# Atlas 检查与播放坐标模块

本模块提供纯函数：结构检查与帧坐标计算。不依赖 Electron、Node、DOM 或 Three.js，不读取磁盘、不发起网络请求，也不解码图片。

## 文件与导出

```text
packages/atlas-tools/index.ts     统一导出
packages/atlas-tools/inspect.ts   inspectAtlas
packages/atlas-tools/playback.ts  getAnimationFrameRect / getLookFrameRect
tests/atlas-tools.test.ts         结构测试
```

共享类型和常量来自 `packages/target-chatgpt/contract.ts`。

```ts
import {
  inspectAtlas,
  getAnimationFrameRect,
  getLookFrameRect,
  type AtlasPixels,
} from '../packages/atlas-tools';

const pixels: AtlasPixels = { width, height, data: rgbaBytes };
const report = inspectAtlas(pixels, 'v2', encodedBytes);

if (!report.valid) {
  for (const issue of report.errors) {
    console.error(issue.code, issue.row, issue.frame, issue.message);
  }
}

const frame = getAnimationFrameRect('idle', elapsedSeconds); // 默认 8 fps
const gaze = getLookFrameRect(112.5); // 第 9/10 行的视线格
```

`inspectAtlas(image, profile, encodedBytes?)` 返回 `AtlasInspection`：`valid`、`profile`、`requiredFrames`、`errors`、`warnings`。

## 数值边界

| 项目 | v1 | v2 |
| --- | --- | --- |
| 图集尺寸 | 1536 × 1872 | 1536 × 2288 |
| 网格 | 8 列 × 9 行 | 8 列 × 11 行 |
| 单格 | 192 × 208 | 192 × 208 |
| 必需帧 | 57 | 73 |
| 空白格 | 15 | 15 |

- 必需帧数来自共享契约（九种动作行）加 v2 的两行视线（每行 8 帧）。
- 每行动作的有效帧必须从最左侧开始；该行其余格子属于空白格，必须全透明。
- `encodedBytes` 是可选的编码后文件大小，必须是正的 safe integer 且不超过 20 MiB（20,971,520 字节）。它不用于推断 RGBA 数据长度。
- `image.data` 必须是解码后的 RGBA 字节，长度精确等于 `width × height × 4`。
- 必需格中任意 `alpha > 0` 的像素即视为非空；不要求整格覆盖、不要求特定 RGB 或内容覆盖率。
- 未使用格中任意 `alpha > 0` 的像素都会报 `unused-cell`。
- 整张图所有像素的 alpha 均为 255 时报 `opaque-background`。部分透明、单格满幅或内容碰到格边都不算背景错误。
- 尺寸或像素数据长度不符时立即返回错误，不继续扫描。尺寸不正确时即使数据长度与输入宽高一致也会拒绝。
- 非法 `profile`（契约之外的值）抛出明确异常，不静默降级。

检查顺序与错误码：

1. `file-size`：编码文件大小不合法。
2. `dimensions`：宽高不是契约要求的整数尺寸（提前返回）。
3. `pixel-data`：RGBA 数据长度不精确（提前返回）。
4. `empty-frame` / `unused-cell`：逐行逐格扫描，携带从 0 开始的 `row`、`frame`。
5. `opaque-background`：整图检查。

`valid` 仅表示上述结构检查通过。

## 播放坐标

`getAnimationFrameRect(state, timeSeconds, fps = 8)`

- 返回像素坐标 `{ x, y, width: 192, height: 208 }`。
- 状态行和帧数来自共享契约，仅在各自真实帧数内循环，不会播放行尾空白列。
- `timeSeconds` 为负数、`NaN` 或 `±Infinity` 时按 0 处理。
- `fps` 为 `undefined`、非有限值或 ≤ 0 时按 8 处理。
- 契约之外的动画状态抛出明确异常。

`getLookFrameRect(angleDegrees)`

- 16 个方向，每格 22.5°，取最接近的方向。
- 0° 为屏幕上方，顺时针增加；0°–157.5° 位于第 9 行，180°–337.5° 位于第 10 行。
- 角度先归一化到 `[0, 360)`，支持负数、超过一圈以及 359° → 0° 跨界。
- 非有限角度按 0°；正好落在两个方向中点时按顺时针（较大角度）取整。
- v1 没有视线行；对 v1 图集不应调用此函数。该函数不接收 profile，仍会返回第 9/10 行的坐标。

两个函数都不做整图镜像、模型旋转、像素重绘或时间轴插值。

## 局限

- 只做结构检查，不判断动作语义、角色一致性、视线正确性、动作衔接、裁切、基线或视觉质量。
- 不解码 PNG/WebP，不校验文件头、MIME、色彩空间、压缩方式或实际编码大小；调用方需先解码并把 RGBA 与编码字节数传入。
- 不检查像素是否来自同一角色、是否共用缩放/基线、头发或衣摆是否出格。
- 不替代目标平台的官方预检、安装或实际播放验证。`valid: true` 不代表目标平台接受该文件。
- 规则来自当前共享契约和目标规格记录；上游契约变化后需同步复核本模块的测试与文档。

## 本地结构检查与官方校验

| 检查 | 能回答的问题 | 不能回答的问题 |
| --- | --- | --- |
| 本模块 | 尺寸、必需/空白格、透明度、编码大小、帧坐标是否符合当前契约 | 目标平台是否接受、动作是否好看、实际播放是否正确 |
| 目标平台预检/安装 | 该平台当前版本是否接受并播放 | 长期协议稳定性、其他入口是否同样接受 |

发布前应以精确的目标文件运行官方预检，并保留报告与文件哈希；本模块只用于本地快速反馈和回归测试。

## 测试

```bash
npm test -- tests/atlas-tools.test.ts
```

2026-10-22 实测结果：1 个测试文件、21 项测试全部通过。覆盖 v1/v2 正常图集、必需格为空、空白格污染、尺寸/数据长度/文件大小错误、全不透明背景、各状态尾帧与下一轮循环、视线基本方向与角度归一化、非有限输入及非法状态/profile。
