# OiGptPet

同一个二次元角色，同时用于独立 Windows 桌宠和 ChatGPT 自定义宠物。

推荐路线：VRM 角色源资产 + 独立桌面运行时 + ChatGPT 精灵图导出适配器。

当前版本：0.1.0 开发原型。已包含角色工坊、Electron 桌宠壳、VRM 1.0 导入、动作预览及试验性 v1/v2 图集导出。尚未完成 ChatGPT 官方预检或宠物安装。

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

`npm run test:smoke` 在构建后实际启动 Electron，验证示例模型加载、动作切换、v2 导出以及桌宠窗口；测试产物位于被 Git 忽略的 `artifacts/smoke/`。运行前需下载演示模型，并关闭已运行的本项目桌宠。

`npm run package` 构建 Windows x64 的免安装目录，输出到 `release/`；打包过程可能下载 Electron 分发文件。该打包入口尚需单独验收。

## 导出与兼容范围

支持导出透明 PNG：v2 为 1536×2288 / 73 帧，v1 为 1536×1872 / 57 帧。导出面板可以预览整张图集，保存动作草稿。

本地结构检查模块已实现，尚未接入工坊 UI。当前动画仍需视觉调整，最终文件必须在目标 ChatGPT 入口完成官方预检与安装验证。未实现 GPT 对话、聊天记录或任务状态同步。

演示资源按官方模型原许可使用；详见 [模型来源与许可说明](public/models/README.md)。其他模型的导出、上传和再分发权限需分别确认。

## 协作与文档

- [开发计划](docs/DEVELOPMENT_PLAN.md)：目标范围、模型资源、双端架构、里程碑和验收标准。
- [DeepSeek 协作任务](docs/DEEPSEEK_HANDOFF.md)：独立文件范围和稳定接口。
- [图集检查模块](docs/ATLAS_TOOLS.md)：结构检查、播放坐标和局限。
