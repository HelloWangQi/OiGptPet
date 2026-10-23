# OiGptPet

同一个二次元角色，同时用于独立 Windows 桌宠和 ChatGPT 自定义宠物。

推荐路线：VRM 角色源资产 + 独立桌面运行时 + ChatGPT 精灵图导出适配器。

当前开发版本：0.4.0。已包含角色工坊、Electron 桌宠、VRM 1.0 / 精灵图角色库、单角色备份与恢复、大小和性能设置、v1/v2 图集导出、最终文件结构检查、逐帧预览和检查报告。ChatGPT 官方预检与安装尚未执行。

## 启动

需要 Node.js 22.12 或更高版本及 Windows x64。首次安装、Electron 运行时下载及获取演示模型需要联网。

```powershell
npm install
npm run demo:fetch
npm run dev
```

也可以导入自己的 VRM 1.0，无需演示模型。仅接受纹理和二进制数据全部内嵌、大小不超过 64 MiB 的模型。

角色工坊点击“放到桌面”打开独立桌宠。悬停后使用顶部手柄拖动、底部按钮挥手或隐藏。空白区域会穿透鼠标；`Ctrl+Alt+P` 或托盘菜单可以恢复互动。关闭工坊后程序保留在托盘，通过托盘“退出 OiGptPet”完全关闭。

可导入 VRM 1.0（≤64 MiB）或本项目规格的 PNG/WebP 精灵图（≤20 MiB）。精灵图需先选择 v1/v2 规格，普通立绘不能直接当作动画图集。角色库最多保存 12 个角色、文件合计 256 MiB，支持改名、切换及移除非当前角色；移除只删除库内副本。切换失败保留当前角色，工坊与桌宠同步，重启恢复上次选择。精灵图直接播放原动作；导出新图集需要源 VRM。

“陪伴设置”支持小/标准/大和画质/均衡/省电模式。绘制上限分别为 60/30/15 fps，闲置 10 秒降为 30/12/5 fps，隐藏时停止绘制。设置本地保存；具体 CPU、内存和耗电效果因设备而异。

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
```

`build:demo` 将开发示例放入独立的 `.cache/demo-dist/`，用于测试，不改变生产 `dist/`。主冒烟测试验证 v1/v2 预览、实际 PNG/报告保存与哈希一致性、异常图集保存门控、取消重开及透明桌宠。组件 smoke 单独验证解码、逐帧播放、局域网 HTTP 摘要回退和资源清理。

Electron 图形测试建议顺序运行，使用独立测试用户目录；产物保存到被 Git 忽略的 `artifacts/`。

主冒烟测试每次写入独立目录，`artifacts/smoke/latest.json` 指向最新成功结果，避免覆盖旧视觉 QA 的输入。

阶段三集成检查验证旧文件迁移、角色命名/移除、VRM/精灵图切换、加载和存储失败回退、取消、跨窗口同步及重启恢复。需有本机旧 QA 图集 `artifacts/animation-fixes/run-04/atlas-v1.png` 和 `atlas-v2.png`；这些本地资源不随仓库分发。结果写入 `artifacts/phase-03/`。

阶段四桌面检查验证 profile A→B 的实际备份/恢复、重复别名保留、坏容器/坏源文件、取消、原生保存失败、20 次角色选择、资源探针与重启。`node scripts/phase-four-smoke.mjs --release` 使用 `release/latest.json` 指向的实际 EXE，产物写入 `artifacts/phase-04/`。短时内存样本不代表长期无泄漏。

### Windows 发布包

```powershell
npm run package
npm run test:release
```

生成 Windows x64 免安装目录，输出在 `release/v<版本>-<运行编号>/`，双击其中 `OiGptPet.exe` 启动。`release/latest.json` 指向最新成功构建；旧包保留。打包可能下载 Electron 分发文件，已有本地缓存时复用。

默认生产构建和发布包不附带源 VRM、开发下载元数据、用户模型或导出图集，首次启动通过本地导入添加角色。构建与打包阶段分别检查分发文件范围。`test:release` 实际启动最新包，验证空模型首次启动、导入和重启恢复。

## 导出与兼容范围

支持导出透明 PNG：v2 为 1536×2288 / 73 帧，v1 为 1536×1872 / 57 帧。弹窗从实际编码文件检查尺寸、帧占用、透明格及体积，并提供动作播放/暂停/单步、v2 十六方向和完整图集查看。

结构失败会禁用 PNG 保存，仍可保存诊断报告。报告记录精确文件的 SHA-256、字节数、规格、模型元数据来源、检查时间和结果；桌面保存 PNG 时主进程会再次校验哈希。关闭弹窗、换模型或重新导出都会清除旧结果。

本地检查不判断动作语义或资源许可，也不替代目标 ChatGPT 入口的预检与安装。界面和报告分别标记这些状态。首个回归模型与 AvatarSample_B 已完成实际加载、v1/v2 导出及结构检查；更多角色的动作适配和连续播放视觉验收仍需完善。GPT 对话、聊天记录和任务状态同步未实现。

演示资源按官方模型原许可使用；详见 [模型来源与许可说明](public/models/README.md)。其他模型的导出、上传和再分发权限需分别确认。

## 协作与文档

- [开发计划](docs/DEVELOPMENT_PLAN.md)：目标范围、模型资源、双端架构、里程碑和验收标准。
- [阶段二检查点](docs/CHECKPOINT_02.md)：双方最终集成、测试证据和未完成项。
- [阶段三任务与对齐点](docs/PHASE_03.md)：设置、角色库和两种桌宠的分工及集成范围。
- [阶段三检查点](docs/CHECKPOINT_03.md)：最终交付、验证证据和未完成项。
- [版本更新说明](docs/releases/v0.3.0.md)：0.3.0 发布内容；历史 0.1.0/0.2.0 说明位于同目录。
- [阶段四计划](docs/PHASE_04.md)：角色备份/恢复的双轮分工与共同验收点。
- [精灵图渲染器](docs/RENDERER_SPRITE.md)：绘制、视线、透明命中与资源生命周期。
- [角色库](docs/CHARACTER_LIBRARY.md)：本地存储、迁移、容量限制和原子操作。
- [DeepSeek 协作任务](docs/DEEPSEEK_HANDOFF.md)：独立文件范围和稳定接口。
- [阶段二协作任务](docs/PHASE_02.md)：三个问题的决策、双方任务、预览组件接口与验收标准。
- [图集检查模块](docs/ATLAS_TOOLS.md)：结构检查、播放坐标和局限。
- [预览组件](docs/ATLAS_PREVIEW.md)：最终文件解码、动画预览和摘要兼容。
- [真实图集 QA](docs/ATLAS_VISUAL_QA_02.md)：已有图集的具体视觉问题。
- [动画修复交付](docs/ANIMATION_FIXES_02.md)：首帧物理、失落/工作姿态、精确图集哈希与视觉限制。
