# OiGptPet

同一个二次元角色，同时用于独立 Windows 桌宠和 ChatGPT 自定义宠物。

推荐路线：VRM 角色源资产 + 独立桌面运行时 + ChatGPT 精灵图导出适配器。

当前源码：0.8.6 本地检查点；上一阶段已发布 0.8.5 Preview。新增左右眼独立表情的同步眨眼适配，面板和导出报告记录所选方式，见 [0.8.6 版本说明](docs/releases/v0.8.6.md)。保留右栏独立滚动、每窗口绘制监测、[角色动作适配检查](docs/MOTION_CAPABILITIES.md)、聊天认证修复和离线配置检查，配置方法见 [对话配置](docs/CHAT_SETUP.md)。独立桌宠支持流式文字与气泡、取消、中断重试及工坊重开的本次会话恢复；会话仅在内存中保留，退出应用清除。真实 API 账户对话、ChatGPT 宠物官方安装与物理多屏/DPI/休眠仍待验收。

桌面工坊“陪伴设置”支持保存本地桌面诊断，方便对比显示器和窗口状态；使用说明见 [桌面诊断](docs/DESKTOP_DIAGNOSTICS.md)。

## 启动

需要 Node.js 22.12 或更高版本及 Windows x64。首次安装、Electron 运行时下载及获取演示模型需要联网。

```powershell
npm install
npm run demo:fetch
npm run dev
```

也可以导入自己的 VRM 1.0，无需演示模型。仅接受纹理和二进制数据全部内嵌、大小不超过 64 MiB 的模型。

角色工坊点击“放到桌面”打开独立桌宠。按住宠物身体的可见部分即可拖动；轻点仍会挥手，拖动结束不会误触挥手。顶部手柄仍可拖动，底部按钮可挥手或隐藏。空白区域会穿透鼠标；`Ctrl+Alt+P` 或托盘菜单可以恢复互动。关闭工坊后程序保留在托盘，通过托盘“退出 OiGptPet”完全关闭。

可导入 VRM 1.0（≤64 MiB）或本项目规格的 PNG/WebP 精灵图（≤20 MiB）。精灵图需先选择 v1/v2 规格，普通立绘不能直接当作动画图集。角色库最多保存 12 个角色、文件合计 256 MiB，支持改名、切换及移除非当前角色；移除只删除库内副本。切换失败保留当前角色，工坊与桌宠同步，重启恢复上次选择。精灵图直接播放原动作；导出新图集需要源 VRM。

“陪伴设置”支持小/标准/大和画质/均衡/省电模式。绘制上限分别为 60/30/15 fps，闲置 10 秒降为 30/12/5 fps，隐藏时停止绘制。设置本地保存；具体 CPU、内存和耗电效果因设备而异。

阶段五开发中：显示器增加/移除、工作区变化及系统恢复后重新约束桌宠窗口位置，保持隐藏状态；手动找回时也检查位置。窗口与屏幕工作区使用 Electron 的逻辑坐标，避免重复按 DPI 缩放。真实多屏/DPI/休眠验收尚未完成。

窗口位置防抖保存，正常退出会等待最后一次位置的原子写入；保存失败保留上次成功记录。强制结束、断电或系统终止进程不保证保存最后一次移动。详见 [窗口位置存储](docs/WINDOW_STATE.md)。

新版角色库使用独立 IndexedDB。首次启动可从旧 Electron `current.vrm` 或浏览器旧数据库迁移模型，保留旧数据。浏览器按来源地址隔离存储；更换 IP、端口或协议后不会自动共享角色。默认生产桌面应用使用固定本地来源，用户数据位于 Electron 的 userData 目录；开发版数据在 `.cache/electron-user-data/`。

### 角色备份与恢复

先把角色导入角色库，再点“备份当前角色”，保存 `.oipet` 文件。在另一个应用数据目录或浏览器中点“恢复角色备份”即可恢复角色、名称和图集规格，也支持拖入备份文件。重复恢复沿用已有角色与本地名称；失败保留当前可用角色。

备份包含一个角色的原始 VRM/PNG/WebP、名称和规格，不包含应用设置或整个角色库。文件不自动上传；作者及许可信息保留在原资产中，外部说明请另外保管。浏览器交给下载管理器保存，桌面通过保存对话框原子写入；最终重命名开始后，取消不能撤销已经提交的保存。

## 检查与构建

```powershell
npm test
npm run build
npm start
```

`npm run dev:web` 提供浏览器中的工坊预览；桌面窗口、托盘和快捷键需要 Electron。

### 局域网访问

```powershell
npm run dev:web
```

服务监听 `0.0.0.0:5173`，同一局域网的设备可打开终端输出的 Network 地址，例如 `http://192.168.0.54:5173/`（以电脑当前 IP 为准）。`npm run dev` 也启用此访问方式，Electron 仍连接本机 `127.0.0.1:5173`。

只预览构建产物时运行 `npm run build`，再运行 `npm run preview`，端口同为 5173。两种预览服务不要同时启动。

如果其他设备无法连接，检查是否处于同一网络，以及 Windows 防火墙是否允许 Node.js 在当前局域网接收连接。局域网页面支持角色预览、本地导入和图集导出；桌宠悬浮窗口仍需在本机使用 Electron。导入的角色保存在访问设备的浏览器中，不会自动同步到主机。

### 示例与端到端检查

```powershell
npm run demo:fetch
npm run build:demo
npm run test:smoke
node scripts/atlas-preview-smoke.mjs
node scripts/renderer-sprite-smoke.mjs
node scripts/character-library-smoke.mjs
node scripts/smoke.mjs --preferences-only
npm run test:phase-three
node scripts/character-package-smoke.mjs
node scripts/web-package-smoke.mjs
npm run test:phase-four
node scripts/window-recovery-smoke.mjs
node scripts/window-state-smoke.mjs
```

`build:demo` 将开发示例放入独立的 `.cache/demo-dist/`，用于测试，不改变生产 `dist/`。主冒烟测试验证 v1/v2 预览、实际 PNG/报告保存与哈希一致性、异常图集保存门控、取消重开及透明桌宠。组件 smoke 单独验证解码、逐帧播放、局域网 HTTP 摘要回退和资源清理。

Electron 图形测试建议顺序运行，使用独立测试用户目录；产物保存到被 Git 忽略的 `artifacts/`。

主冒烟测试每次写入独立目录，`artifacts/smoke/latest.json` 指向最新成功结果，避免覆盖旧视觉 QA 的输入。

阶段三集成检查验证旧文件迁移、角色命名/移除、VRM/精灵图切换、加载和存储失败回退、取消、跨窗口同步及重启恢复。需有本机旧 QA 图集 `artifacts/animation-fixes/run-04/atlas-v1.png` 和 `atlas-v2.png`；这些本地资源不随仓库分发。结果写入 `artifacts/phase-03/`。

阶段四桌面检查验证 profile A→B 的实际备份/恢复、重复别名保留、坏容器/坏源文件、取消、原生保存失败、20 次角色选择、资源探针与重启。`node scripts/phase-four-smoke.mjs --release` 使用 `release/latest.json` 指向的实际 EXE，产物写入 `artifacts/phase-04/`。短时内存样本不代表长期无泄漏。

`npm run test:phase-four` 会先重建测试 demo，避免读取旧 `.cache/demo-dist`；直接运行该脚本的开发模式前仍需手动 `npm run build:demo`。`--release` 检查使用已有 EXE，不以重建网页替代重新打包。

### Windows 发布包

```powershell
npm run package
npm run test:release
npm run test:chat-stress
```

生成 Windows x64 免安装目录，输出在 `release/v<版本>-<运行编号>/`，双击其中 `OiGptPet.exe` 启动。`release/latest.json` 指向最新成功构建，成功打包后自动保留最近 3 个包。打包可能下载 Electron 分发文件，已有本地缓存时复用。

用户验证前运行 `npm run verify:desktop`，会重新编译、打包并启动最新 EXE 做基础检查。成功打包后，本地 `release/` 仅保留最近 3 个 EXE 包目录（含当前 latest；同版本号多次构建分别计数），较旧的已识别包自动清理。未知目录、源模型、用户数据和远端 Release 不参与清理。手动预览清理清单用 `node scripts/package-retention.mjs`，确认执行用 `node scripts/package-retention.mjs --apply`。

默认生产构建和发布包不附带源 VRM、开发下载元数据、用户模型或导出图集，首次启动通过本地导入添加角色。构建与打包阶段分别检查分发文件范围。`test:release` 实际启动最新包，验证空模型首次启动、导入和重启恢复。

`test:chat-stress` 在当前包上进行 24 轮模拟对话与窗口循环，检查取消/重试、上下文滚动、工坊和桌宠重开、流释放及迟到响应隔离。运行前先 `npm run verify:desktop`；范围、产物与限制见 [对话循环检查](docs/CHAT_STRESS.md)。

`npm run test:chat-mixed` 增加对话中的 VRM/精灵图切换、名称同步、隐藏接收回复与重新显示、渲染资源释放检查，需要本地示例 VRM。它是有界混合回归，不代表满小时稳定性通过。

`npm run test:chat-memory` 固定两个窗口，每次角色切换后等待 5 秒再采样，记录工坊/桌宠 PID、位图关闭情况以及原始和等待后的内存趋势；不强制 GC，不用短测替代满小时验收。

`npm run test:chat-soak` 在 5 分钟预热后观察完整 60 分钟，固定切换时刻并独立采样。0.8.2 已完成该软件环境的满小时功能检查：32 个完整循环、185 次模拟请求、261 次采样；预热后未触发内存门槛，原始 GPU 样本的增长提示继续保留。范围与证据见 [满小时检查点](docs/CHECKPOINT_08_SOAK.md)。

`npm run test:chat-soak-default` 用默认图形后端做同负载对照，保存实际 WebGL 后端证据。本机 Intel UHD 630 / D3D11 对照已完成满小时，原始与预热后内存均未触发提示；这是单机顺序观测，不证明任意设备无泄漏，也不覆盖原软件配置的增长记录。详见 [默认后端对照](docs/CHECKPOINT_08_GPU_COMPARE.md)。

## 导出与兼容范围

支持导出透明 PNG：v2 为 1536×2288 / 73 帧，v1 为 1536×1872 / 57 帧。弹窗从实际编码文件检查尺寸、帧占用、透明格及体积，并提供动作播放/暂停/单步、v2 十六方向和完整图集查看。

结构失败会禁用 PNG 保存，仍可保存诊断报告。报告记录精确文件的 SHA-256、字节数、规格、模型元数据来源、检查时间和结果；桌面保存 PNG 时主进程会再次校验哈希。关闭弹窗、换模型或重新导出都会清除旧结果。

本地检查不判断动作语义或资源许可，也不替代目标 ChatGPT 入口的预检与安装。界面和报告分别标记这些状态。首个回归模型与 AvatarSample_B 已完成实际加载、v1/v2 导出及结构检查；更多角色的动作适配和连续播放视觉验收仍需完善。与 ChatGPT 的聊天记录和任务状态同步未实现。

演示资源按官方模型原许可使用；详见 [模型来源与许可说明](public/models/README.md)。其他模型的导出、上传和再分发权限需分别确认。

## 协作与文档

- [开发计划](docs/DEVELOPMENT_PLAN.md)：目标范围、模型资源、双端架构、里程碑和验收标准。
- [阶段二检查点](docs/CHECKPOINT_02.md)：双方最终集成、测试证据和未完成项。
- [阶段三任务与对齐点](docs/PHASE_03.md)：设置、角色库和两种桌宠的分工及集成范围。
- [阶段三检查点](docs/CHECKPOINT_03.md)：最终交付、验证证据和未完成项。
- [版本更新说明](docs/releases/v0.3.0.md)：0.3.0 发布内容；历史 0.1.0/0.2.0 说明位于同目录。
- [阶段四计划](docs/PHASE_04.md)：角色备份/恢复的双轮分工与共同验收点。
- [阶段五计划](docs/PHASE_05.md)：窗口恢复、位置持久化与实机稳定性验收。
- [窗口位置存储](docs/WINDOW_STATE.md)：原子保存、正常退出等待与失败边界。
- [窗口稳定性检查矩阵](docs/WINDOW_STABILITY_QA.md)：自动化范围和待实机验收项；阶段五现由 Codex 独立推进。
- [桌面一小时检查](docs/DESKTOP_SOAK.md)：实际 EXE 操作、资源/内存采样及结果边界。
- [精灵图渲染器](docs/RENDERER_SPRITE.md)：绘制、视线、透明命中与资源生命周期。
- [角色库](docs/CHARACTER_LIBRARY.md)：本地存储、迁移、容量限制和原子操作。
- [DeepSeek 协作任务](docs/DEEPSEEK_HANDOFF.md)：独立文件范围和稳定接口。
- [阶段二协作任务](docs/PHASE_02.md)：三个问题的决策、双方任务、预览组件接口与验收标准。
- [图集检查模块](docs/ATLAS_TOOLS.md)：结构检查、播放坐标和局限。
- [预览组件](docs/ATLAS_PREVIEW.md)：最终文件解码、动画预览和摘要兼容。
- [真实图集 QA](docs/ATLAS_VISUAL_QA_02.md)：已有图集的具体视觉问题。
- [动画修复交付](docs/ANIMATION_FIXES_02.md)：首帧物理、失落/工作姿态、精确图集哈希与视觉限制。
