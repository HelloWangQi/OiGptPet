# Live2D 接入可行性与前置条件

复核日期：2026-11-05。

## 结论

Live2D Cubism Web SDK 在技术上适配当前 Electron + TypeScript + Vite 渲染端。当前项目已将 VRM 与精灵图封装为统一 `CompanionRenderer` 接口，后续渲染器可在保留现有角色切换、尺寸同步、动画状态和命中测试流程的情况下接入。

现在不把 Cubism SDK/Core 或官方样例模型放进仓库、依赖清单或安装包。实现与发布前置条件如下：

1. SDK 通过 Live2D 官方下载并依照 SDK 使用协议获取。官方 Web Samples 仓库明确说明 Cubism Core 不由该仓库托管，需从 SDK 下载取得；官方 Vite 教程要求接入 Core 与 Framework。
2. Cubism Core 使用专有软件许可；发布包含运行时的衍生应用前，需要核对运行时获取方式及发布许可条件。
3. 官方发布许可将 AI/聊天机器人接口列为用途之一，并说明“可扩展应用”需审查和专门许可。官方定义包括通过添加文件或数据使用不特定数量模型的作品。本项目允许导入多种角色，因此**可能**属于该类别；这是根据定义做的初步判断，须由 Live2D 确认后才能决定公开发布方案。
4. Live2D 样例模型的许可与 SDK 许可分开处理。本项目不应把样例模型作为默认角色或发布资源。
5. 模型文件自身的使用、修改、动画导出及再分发许可仍需逐个确认。

## 当前实现边界

- `src/renderer-adapters.ts` 定义统一渲染器接口，并适配现有 VRM 与精灵图渲染器。
- `src/companion-stage.ts` 保留准备、取消、提交、旧角色释放、缩放、逐帧渲染和点击命中流程，不再直接区分各渲染器的绘制参数。
- 当前仍不支持 `.moc3` / Cubism 模型加载，不改变现有 VRM 或精灵图行为，也不代表 Live2D 功能已完成。

## 接入步骤

1. 取得 Live2D 对本项目“用户可导入模型”分发形态的书面许可适用结论；确认公开源代码仓库与预编译安装包分别可采用的分发方式。
2. 使用用户有权使用和导出的模型建立本地验证样例；不将模型或 SDK 复制进公共仓库。
3. 新建独立的 Live2D 渲染器包，实现异步加载、资源清理、透明渲染、缩放、状态动作映射、点击区域、表情/口型以及错误报告。
4. 通过本机提供的 SDK 做本地开发验证；将许可检查、模型能力检查、连续播放与资源释放纳入验收清单。
5. SDK 与模型许可路径确定后，才决定构建时注入或私有资源获取方案；发布前复核 Live2D 当时有效的协议和许可。

## 官方资料

- [Cubism SDK Release License](https://www.live2d.com/en/sdk/license/)
- [Expandable Applications](https://www.live2d.com/en/sdk/license/expandable/)
- [Live2D Open Software License Agreement](https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html)
- [Cubism Web Samples](https://github.com/Live2D/CubismWebSamples)
- [在 Vite 项目中使用 Cubism Web SDK](https://docs.live2d.com/en/cubism-sdk-tutorials/use-sdk-in-js/)
- [Cubism Web Samples 构建说明](https://docs.live2d.com/en/cubism-sdk-tutorials/sample-build-web/)
