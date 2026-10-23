# DeepSeek 阶段三交付说明（D11–D13）

交付日期：2026-10-23。工作区 `E:\GitWorkSpace\OiGptPet`，分支 `codex/desktop-prototype`，基线 `402bbf8`。本阶段只实现独立精灵图渲染器、其测试、独立 fixture/smoke 与文档；未集成到 `src/**` / `electron/**`，未提交或推送。

## 文件清单

仅新增以下范围内的文件：

```text
packages/renderer-sprite/index.ts              14,621 B
tests/renderer-sprite.test.ts                  22 项测试
tests/fixtures/renderer-sprite/index.html      fixture 入口
tests/fixtures/renderer-sprite/main.ts         fixture 图案生成与探测接口
scripts/renderer-sprite-smoke.mjs              独立 Playwright/Electron smoke
docs/RENDERER_SPRITE.md                        接口、失败/取消、尺寸、坐标映射、阈值、集成示例
docs/DEEPSEEK_DELIVERY_03.md                   本文件
```

未修改 `src/**`、`electron/**`、根配置、`package.json` / lockfile、主 smoke、打包脚本、共享契约，也未修改 `packages/atlas-preview/**`、`packages/atlas-tools/**`。未增加依赖。

## 实现摘要

- 公开 `SpriteStage`：`load` / `resize` / `render` / `hitTest` / `loaded` / `dispose`，与任务指定签名一致。
- 复用现有格式/体积/尺寸校验、SHA-256、结构检查和帧坐标函数；成功返回原始 Blob、实际哈希与字节数。
- 最新 load 获胜：新 load 同步清空旧画面与命中数据；旧任务、外部取消和销毁都以 `AbortError` 结束；迟到的 Bitmap 会关闭。
- 结构无效时 reject `SpriteStageError` 并携带 `inspection`；解码失败、画布上下文失败分别使用 `decode` / `canvas` 错误码。
- 每次绘制取完整 192×208 单格，按 contain 居中到 backing 画布；保留跳跃格内位移，不裁切或重排角色。
- 加载时建立一次 alpha 掩码；命中按最新 `getBoundingClientRect`、contain 目标区、当前源帧和 `alpha >= 8` 查表，pointer 事件不重新解码。
- 不创建 RAF、interval、timeout、WebGL 或 Object URL；播放计时完全由宿主负责。
- 画布 backing 单边上限 4096，DPR/显式倍率封顶 2；非法尺寸或倍率在写入画布前抛出 `RangeError`。

## 实际命令与结果

在仓库根目录执行：

```bash
npx tsc --noEmit
```

结果：通过，退出码 0，无诊断输出。

```bash
npm test
```

结果：**10 个测试文件、130 项全部通过**，耗时 1.68 s。其中本阶段 `tests/renderer-sprite.test.ts` 为 **22 项通过**（978 ms）。全量包含工作区中同时存在的其他测试文件（`character-core`、`window-state`、`frame-pacer`、`export-session`、`distribution`、`desktop-preferences`、`atlas-tools`、`atlas-preview`、`animation-quality`），本次均未失败。

```bash
node scripts/renderer-sprite-smoke.mjs
```

结果：通过，输出：

```text
Renderer sprite smoke passed: real v1/v2, marker frames/gaze, contain/DPR, alpha hit tests, invalid inputs, races, cancellation and disposal.
```

smoke 使用随机端口的独立 Vite、隐藏的 Electron 窗口、临时用户数据目录；仅监听 `127.0.0.1`，结束后关闭自身进程并删除临时目录，未使用 5173 服务或主用户数据。

单元测试和 smoke 均未接触 Fred 或 Shiro；真实输入仅使用本机 run-04 的已提交/既有图集。

## 覆盖范围

### 单元测试（22 项）

- 有效 v1/v2 加载、哈希、同 Blob、结构检查、首次绘制的完整单格与留白。
- 结构无效（空帧/污染格）拒绝、携带 inspection、清空上一份画面；MIME/格式/尺寸/体积/profile preflight 失败。
- 损坏图集的解码失败；新 load 同步清屏；latest-load-wins；外部取消；销毁中取消；迟到 Bitmap 关闭；dispose 幂等与不可恢复。
- contain 几何、8 fps 帧采样、极端/负数/NaN/Infinity 时间，九个动作，v2 视线量化与 v1 忽略视线。
- DPR 默认值与上限、显式倍率上限、resize 后按最近请求重绘、非法 resize 不改变画布。
- 不同 DPR、CSS 拉伸、不同容器比例、留白、越界、未加载/未渲染和动作/视线/跳跃帧的命中；alpha 7/8 边界。
- 连续 pointer 命中不重读图集；渲染器和加载路径不创建计时器。

### 独立 smoke

- 真实 `run-04` v1 PNG 与 v2 PNG：实际解码、结构检查、输入哈希一致、全格像素绘制、透明命中与 v1 忽略视线。
- 程序化不对称 marker 图集：每行动作与帧序、v2 16 方向视线及边界量化、极值角度、完整单格上下边缘（无逐帧裁切/重定位）、alpha 7/200/7/8。
- contain + DPR：400×300 CSS、ratio 2 → 800×600 backing；左右/top 留白透明，目标区内命中、留白与远处不命中。
- CSS 拉伸后的实际矩形映射、不同容器比例；WebP v1/v2；非法 resize。
- 空帧、污染格、损坏 PNG、伪造格式、错误尺寸/profile/MIME、缺失 MIME、格式与 MIME 不符、超过 20 MiB；全部拒绝且释放 Bitmap。
- 重复加载、latest-load-wins、迟到解码关闭、外部取消、加载中 dispose、dispose 幂等；最终探针：原创建 20 / 关闭 20、未完成 0、活动 interval 0、RAF 0、timeout 0、WebGL 0、Object URL 0。

## 真实输入与哈希

| 输入 | 字节 | SHA-256 |
| --- | ---: | --- |
| `artifacts/animation-fixes/run-04/atlas-v1.png` | 293,190 | `05ac930c71c9a8f5308c2fc4c5aedcffaec99b865cbdc5a36b1c4ade1156e8f6` |
| `artifacts/animation-fixes/run-04/atlas-v2.png` | 370,954 | `84604125009381796d748388ab5b934dd9faac581b8cd8a00fd4417b4b3acada` |

smoke 内实际加载返回的 `sha256` / `encodedBytes` 与上表一致，且 `result.blob === 传入 Blob`。v1 结构检查为 57 个必需帧，v2 为 73 个。

## 输出与哈希

本次 smoke 输出位于本机 `artifacts/renderer-sprite/run-01/`，不提交 Git：

| 输出 | 尺寸 | 字节 | SHA-256 |
| --- | --- | ---: | --- |
| `real-v2-idle-192x208.png` | 192×208 | 9,433 | `27c4230da259fd0c40f23c8a9e4e8579499863e169765a7dbcfe195b8b438720` |
| `real-v2-gaze-90-192x208.png` | 192×208 | 9,724 | `9b7caca7c843ede80ddf2231d8eafd9706d642ad76199385d26aa3adad7e28d8` |
| `real-v1-idle-192x208.png` | 192×208 | 9,433 | `27c4230da259fd0c40f23c8a9e4e8579499863e169765a7dbcfe195b8b438720` |
| `marker-v2-contain-400x300-dpr2.png` | 800×600 | 13,462 | `125567d640ccea4efa6562cbb1f1bb38a5eba2304c83b4deb5a80c64646b144d` |

人工查看前三张真实图集截图：角色正常显示，192×208 画布与单格比例一致；v1 idle 与 v2 idle 画面相同；v2 视线截图使用视线行帧（smoke 另按源格像素逐点核对 90° 方向）。marker 截图显示 contain 居中、四周留白和格边 marker。`result.json` 含每次运行的时间戳与耗时，因此不作为稳定哈希。

## 性能测量条件

环境（smoke `result.json` 记录）：

```text
Windows 10 x64（win32 x64）
Electron 45.0.0 / Chrome 156.0.8078.48 / Node 24.22.0
12 个逻辑 CPU；系统内存 25,590,673,408 字节（约 23.84 GiB）
devicePixelRatio = 1
隐藏的 Electron 窗口，单进程，软件 Canvas 2D
```

最近一次运行：

| 指标 | 数值 |
| --- | --- |
| 真实 v1 完整 `load` | 45.6 ms |
| 真实 v2 完整 `load` | 56.0 ms |
| 20 次解码 | 15.2–26.7 ms（中位数约 20.4 ms） |
| 取消响应 | 约 1.4 ms 后以 `AbortError` 结束（底层解码被人为延迟 400 ms） |

`load` 是墙钟时间，包含 Blob 读取、文件头校验、SHA-256、解码、完整 RGBA 读取和结构检查。上一轮相同环境曾测得 v1 67.6 ms、v2 58.5 ms，说明单次运行存在明显波动。当前实现只保留 1 个 Bitmap 和约 2.74 MiB（v1）/3.35 MiB（v2）alpha 掩码；画布 backing 最坏为 4096×4096（RGBA 原始约 64 MiB）。

**这些只是本机单次量级参考，不构成跨硬件、跨系统、跨 DPI 或跨浏览器的性能保证。** 未做 CPU 占用、峰值内存、长时间运行或低端设备剖析。

## 尚存问题与未执行项

- 未接入主桌宠：`src/**` / `electron/**` 中的设置、角色管理、持久化、IPC 和宿主动画循环仍需 Codex 集成。模块不会自动 resize、自动播放或自动加载。
- 未运行主 `scripts/smoke.mjs`、`scripts/release-smoke.mjs`、打包脚本或真实应用窗口，避免与 Codex 的同时修改和主用户数据冲突。
- 未做 ChatGPT 官方预检、上传、安装、激活或替换用户宠物；本地结构通过与绘制正确不代表平台验收。
- 未在 macOS/Linux、移动端、不同 DPI（除 DPR 1/2 逻辑测试外）、低端 GPU/CPU、触摸/手写笔或真实桌面宠物悬浮窗中验证。
- 未测量峰值内存/CPU、未做长时间 soak、未测试超大图集以外的异常内存压力。4096 上限的极端 backing 画布只做逻辑拒绝测试，未在设备上实际分配。
- 未使用 Fred 或 Shiro；未提交、未推送，交由 Codex 统一集成和提交。
- 已知设计边界：结构无效必须先解码后才能报告，因此 `load` 会读取完整像素；命中依据最近一次 `render`，宿主改变动作/时间后需先渲染；画布上下文不可用时构造直接失败；宿主必须自行处理 `resize` / `RangeError`。
