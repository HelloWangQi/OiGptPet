# OiGptPet

同一个二次元角色，同时用于独立 Windows 桌宠和 ChatGPT 自定义宠物。

推荐路线：VRM 角色源资产 + 独立桌面运行时 + ChatGPT 精灵图导出适配器。

当前开发版本：0.2.0。已包含角色工坊、Electron 桌宠、VRM 1.0 导入、v1/v2 图集导出、最终文件结构检查、逐帧预览和检查报告。ChatGPT 官方预检与安装尚未执行。

## 启动

需要 Node.js 22.12 或更高版本及 Windows x64。首次安装、Electron 运行时下载及获取演示模型需要联网。

```powershell
npm install
npm run demo:fetch
npm run dev
```

也可以导入自己的 VRM 1.0，无需演示模型。仅接受纹理和二进制数据全部内嵌、大小不超过 64 MiB 的模型。

角色工坊点击“放到桌面”打开独立桌宠。悬停后使用顶部手柄拖动、底部按钮挥手或隐藏。空白区域会穿透鼠标；`Ctrl+Alt+P` 或托盘菜单可以恢复互动。关闭工坊后程序保留在托盘，通过托盘“退出 OiGptPet”完全关闭。

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
```

`build:demo` 将开发示例放入独立的 `.cache/demo-dist/`，用于测试，不改变生产 `dist/`。主冒烟测试验证 v1/v2 预览、实际 PNG/报告保存与哈希一致性、异常图集保存门控、取消重开及透明桌宠。组件 smoke 单独验证解码、逐帧播放、局域网 HTTP 摘要回退和资源清理。

Electron 图形测试建议顺序运行，使用独立测试用户目录；产物保存到被 Git 忽略的 `artifacts/`。

主冒烟测试每次写入独立目录，`artifacts/smoke/latest.json` 指向最新成功结果，避免覆盖旧视觉 QA 的输入。

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

本地检查不判断动作语义或资源许可，也不替代目标 ChatGPT 入口的预检与安装。界面和报告分别标记这些状态。当前仍需动作视觉验收、第二个真实模型兼容验证；GPT 对话、聊天记录和任务状态同步未实现。

演示资源按官方模型原许可使用；详见 [模型来源与许可说明](public/models/README.md)。其他模型的导出、上传和再分发权限需分别确认。

## 协作与文档

- [开发计划](docs/DEVELOPMENT_PLAN.md)：目标范围、模型资源、双端架构、里程碑和验收标准。
- [阶段二检查点](docs/CHECKPOINT_02.md)：当前已验证内容、测试证据和未完成项；Codex 部分先单独提交，DeepSeek 组件和动画修复待后续纳入。
- [DeepSeek 协作任务](docs/DEEPSEEK_HANDOFF.md)：独立文件范围和稳定接口。
- [阶段二协作任务](docs/PHASE_02.md)：三个问题的决策、双方任务、预览组件接口与验收标准。
- [图集检查模块](docs/ATLAS_TOOLS.md)：结构检查、播放坐标和局限。
- [预览组件](docs/ATLAS_PREVIEW.md)：最终文件解码、动画预览和摘要兼容。
- [真实图集 QA](docs/ATLAS_VISUAL_QA_02.md)：已有图集的具体视觉问题。
- [动画修复分工](docs/DEEPSEEK_ANIMATION_FIXES_02.md)：DeepSeek 当前负责的修复范围。
