# 0.8.4 检查点：角色动作适配检查

2026-11-03，按用户继续开发的要求完成一个有界阶段；保存本地提交后暂停，没有推送或发布 GitHub。

## 交付

- 新增 `inspectMotionCapabilities`，仅检查当前程序动作使用的十个骨骼、三个表情和视线控制器是否实际加载。`inspectVrmFile` 的文件声明检查不生成运行时能力记录。
- `VrmStage.load` 完成模型加载和姿态初始化后附加能力记录；没有改变动作采样、骨骼重映射、物理或文件加载规则。
- 工坊新增“动作适配检查”，有缺失项时展开提示。失败导入保留原模型信息；成功切到精灵图隐藏并清空，重新加载 VRM 后重新检查。
- 导出报告增加可选 `modelCapabilities`，随模型元数据在异步导出前复制，保留 `visualReview: not-reviewed`、平台预检/安装 not-run。主报告 schemaVersion 仍为 1，旧无能力信息调用者省略该字段。
- 使用说明：[MOTION_CAPABILITIES.md](MOTION_CAPABILITIES.md)，版本说明：[v0.8.4](releases/v0.8.4.md)。

## 验证

- `npm test`：30 个文件、366 项通过，包括缺少能力的反馈、报告间独立性、导出开始前的深拷贝和旧调用者兼容。
- `npm run verify:desktop`：TypeScript、生产构建、打包和实际 Windows EXE 冒烟通过。
- EXE：`release/v0.8.4-1793695291575/OiGptPet-win32-x64/OiGptPet.exe`。
- 结果：`artifacts/release-smoke/run-1793695296232/result.json`，ok=true、rendererErrors=[]。沿用空模型首次启动、角色库、身体拖动、诊断、设置重启、聊天流式/取消/重试和恢复检查。
- 新增 `motion-capabilities-smoke-steps.mjs`：演示模型十个受检骨骼和三个表情均存在，视线控制器已加载；移除可选 chest/neck、blink/happy/sad 和 lookAt 的临时副本实际加载及 v1 导出成功，报告准确记录缺失项，界面显示四组提示。
- 通过实际原生保存写出 original-capabilities-report.json、limited-capabilities-report.json 和 restored-capabilities-report.json。切回原模型后能力报告与原报告一致，坏文件导入保留能力结果，精灵图清空结果。报告始终保持视觉未验收、平台未预检/安装。
- 面板截图 `limited-capabilities.png` 已人工查看，文字未截断、缺失提示可见。源模型及临时副本 SHA-256 记录于结果文件，产物留在 Git 忽略目录，不进入分发包。
- 第一次新增冒烟 `run-1793695212019` 暴露测试等待竞争：点击切换后仅等“就绪”文字可能读到旧角色。改为同时等待目标角色身份与就绪，再完整重跑上述成功命令；没有因此修改生产加载行为。
- 打包自动保留最近三个已识别 EXE 包目录；不清理模型、证据或未知目录。

## 边界及后续

能力存在不证明绑定可见、眼睛实际运动、动作自然、无裁切或符合任意 VRM 的完整规范；缺失可选能力按现有渲染行为跳过对应通道，没有自动替代表情。检查结果不会把更多角色视觉 QA 或目标平台安装标为完成。

保留 0.8.3 聊天认证修复；本轮全部请求仍为合成配置和模拟网络，真实 API 账户待验收。物理多屏/DPI/休眠、更多模型的连续动作视觉检查、ChatGPT 官方入口预检与安装、更多设备性能/能耗仍待实际环境。本轮没有重跑满小时，不把 0.8.2 证据移作本版长测结论。
