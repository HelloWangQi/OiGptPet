# 0.8.8 检查点：手臂落点适配

2026-11-04。继续处理上一轮 AvatarSample_B 失落/工作手臂偏低的问题，新增通用的头部相对目标定位；不按模型名称设置特例。保存本地阶段提交，不推送或发布。

## 实现及边界

在现有程序姿态之后、VRM 更新之前调整规范化手臂链。目标由 head/neck 的世界距离和头部朝向确定：失落调整双手至脸前，工作只调整右手至下巴侧面。每帧从重置后的程序姿态求解，固定十二轮，单次旋转最多 0.4 弧度；不累计上一帧结果，不改变骨骼长度。

只在 failed/running 生效。缺少 head/neck、比例无效或某侧 UpperArm/LowerArm/Hand 不完整时跳过该侧，保留原姿态。实时和离线导出共用同一实现。此方法没有关节活动范围、手掌方向、手指姿势或衣袖碰撞约束，不能当作完整的人体动画重定向；宽袖遮挡仍需按角色复核。

## 验证证据

- 34 个文件、408 项单测通过：旋转/缩放的世界目标求解、头部相对目标、工作仅动右臂、非法/不可达目标、骨骼长度保持及降级。初版旋转限幅曾因四元数别名被覆盖，已修正并由目标距离测试检出/复验。
- 首模 `artifacts/animation-fixes/demo-arm-088-final/manifest.json`：v1 c3d95475b4e4b67c2d0674a61a405968f45756c4e6eab9177e9f67c1932e9882，v2 7333eb60121633b26c0abc45e674a4dfc9c73b980720a03280df49e5a72cc716。
- AvatarSample_B `artifacts/animation-fixes/avatar-b-arm-088-final/manifest.json`：v1 3bca835ab3f6e104e820a01272ee314f846c575137458afc326298fdf2612247，v2 e1c04494e29f383271d6c292135e95625ba27377cc4fc0194280c988754b5fb4。
- 两模型 v1/v2 结构检查、第三格取消、取消后重复 v2 哈希确定性均通过，最终各四个 context 全部释放，无 page/console error。中间 probe/probe02 不是最终模型证据。
- 两个 final 目录的 arm-before-after.png 已查看：固定第 2 格、全格三倍最近邻放大。两模型的失落双手已到脸前，工作右手已抬近下巴；AvatarSample_B 宽袖仍遮挡部分嘴部，不宣称已消除穿插或完整连续播放通过。
- row-comparison.json 保存逐行 RGBA 比较：首模除第 5/7 行外全部像素一致；第二模型第 2/6 行各有两个 RGB 像素差、alpha 无差，其余非目标行一致。该细小颜色差未作原因归因，不将其写成全图像素完全不变。
- 当前源码通过 `npm run verify:desktop` 后，新包与对应记录见下方最终验收；生产分发不附带模型和上述测试图片。

## 最终 EXE 验收

新包：`release/v0.8.8-1793759084153/OiGptPet-win32-x64/OiGptPet.exe`。
验收目录：`artifacts/release-smoke/run-1793759096468/`。最终 ok、渲染错误和提交摘要对应关系以该目录的 result.json、commit-verification.json 为准。

本次完整 verify:desktop 已通过，result.json 的 ok=true、rendererErrors=[]。复验角色库、拖动、设置重启、布局三尺寸、性能/原生隐藏恢复、模拟聊天和四份能力报告；缺少 neck 的模型副本继续正常加载及导出，走原姿态降级。

本轮查看的是关键帧前后对比，不是九状态全帧连续视觉认证。真实 API、物理多屏/DPI/休眠、更多独立模型、硬件能耗及 ChatGPT 官方安装仍待实际环境；不使用旧版长测替代本版稳定性结果。
