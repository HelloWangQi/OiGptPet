# 接续：0.8.6 眨眼适配验收完成

2026-11-04 用户明确恢复工作，之前的会议暂停已经解除。当前源码已运行完整 `npm run verify:desktop` 并通过；新包 `release/v0.8.6-1793757299769/OiGptPet-win32-x64/OiGptPet.exe`，结果 `artifacts/release-smoke/run-1793757309012/result.json`。原模型 combined、左右眼副本 paired、无眨眼副本 none，以及切回恢复的四份报告均通过；布局/性能/聊天/角色库回归继续通过。生产代码仍为已通过 392 项单测的 4dea8b2，本轮只补验收记录。详见 [CHECKPOINT_08_6.md](CHECKPOINT_08_6.md)。

本阶段保存本地检查点后停止，未推送或发布 0.8.6。上一阶段已发布的 0.8.5 Preview 指向 55e11ad。后续优先更多模型连续动作视觉 QA、真实 API 或物理设备验收；不要把通道和结构检查当作完整视觉/目标平台验收。需要用户验证前仍按约定重新 verify:desktop、提供当前包和对应提交。

## 此前暂停记录（已由本次用户指令恢复）

2026-11-04 用户要开会，明确要求暂时停止测试以降低电脑负载。已中止本轮 verify:desktop，并确认本次测试 EXE 无剩余进程。不要自动恢复测试或启动打包；等用户继续指令。按约定保存本地 WIP 提交，不推送、不发布。

本轮已实现：优先通用 blink，缺少时完整 blinkLeft/blinkRight 成对同步；单侧不自动眨眼。实时与导出共用渲染路径，未用通道清零，报告新增可选 blinkMode，面板兼容旧报告。33 个文件、392 项单元测试已通过。第一次单测的参数化输入已修正。

当前包 `release/v0.8.6-1793754859607/OiGptPet-win32-x64/OiGptPet.exe` 尚未完成本轮 EXE 验收，不能作为已通过包交付。当前尝试产物 `artifacts/release-smoke/run-1793754864221/`；更早 `run-1793754784459` 在测试工坊被隐藏、无法取得采样时失败，已修改测试等待：需要双窗口数据时先恢复被隐藏的测试窗口。恢复后从当前源码重新运行 verify:desktop，继续原模型/成对眨眼副本/无眨眼副本与报告切回检查，成功后补检查点与提交对应关系。

上一阶段已发布 v0.8.5 Preview，标签提交 55e11ad501d102478a0252f9280521caf80e05d9；远端发布回执与 SHA-256 校验在 artifacts/github-release-v0.8.5/verification.json。0.8.6 尚未推送或发布。下面为旧阶段记录，以本段暂停状态为准。

## 0.8.5 保留记录

最新阶段：用户要求继续，随后指出右栏撑长页面、滚动到底左侧留空。本轮完成窗口内布局：桌面右栏独立滚动，左侧预览和动作保持原位，窄屏单列网页仍使用页面滚动。补齐每窗口绘制采样与诊断，并将原生 hide/show 同时用于隐藏暂停；不只依赖 document.hidden。具体范围见 [CHECKPOINT_08_5.md](CHECKPOINT_08_5.md)、[DESKTOP_DIAGNOSTICS.md](DESKTOP_DIAGNOSTICS.md)。

最新验证：32 文件、385 项单测通过。最终新包 `release/v0.8.5-1793697248931/OiGptPet-win32-x64/OiGptPet.exe`，最终验收 `artifacts/release-smoke/run-1793697254159/result.json`。布局测三个内容尺寸，滚右栏不移动左侧、整页无纵向滚动；截图已查看。性能检查覆盖 15/60 互动上限、5 闲置上限、两个窗口独立采样、原生隐藏 drawImage 增量为零及显示后新采样。较早 `run-1793697137342` 为同运行时代码预检通过，不能替代新包编号。失败预检记录不作通过证据。

采样为绘制调用频率/同步墙钟耗时，不代表屏幕呈现 FPS、GPU 完成时间或能耗。诊断对隐藏/过期/未采样返回明确状态，不把旧数值当当前值；字段白名单、缓存清理和 IPC 归属已接线。真实 API、物理多屏/DPI/休眠、更多角色连续动作视觉 QA、ChatGPT 官方安装及更多设备性能仍待实机。按约定只保存本地提交，未推送/发布；最近三包策略继续执行。

## 0.8.4 保留记录

最新阶段：2026-11-03 用户再次要求继续，完成 0.8.4 动作适配检查并保存本地提交，没有远端推送或发布。新能力读取实际加载的骨骼、表情及视线控制器，缺少可选项时给出提示；结果附到导出报告，异步导出前快照，角色切换后重新检查，精灵图清空。未改变动作算法或增加自动重映射。说明见 [MOTION_CAPABILITIES.md](MOTION_CAPABILITIES.md)、[CHECKPOINT_08_4.md](CHECKPOINT_08_4.md)。

最新验证：30 文件、366 项单测通过；`npm run verify:desktop` 完整通过。新 EXE `release/v0.8.4-1793695291575/OiGptPet-win32-x64/OiGptPet.exe`，结果 `artifacts/release-smoke/run-1793695296232/result.json`。真实 EXE 加载原模型及缺少可选能力的临时副本，原生保存三份报告，缺失项、失败导入保留、精灵图清理和切回恢复均通过，rendererErrors=[]。截图已查看；临时模型和产物只留在忽略目录。第一轮新增测试的角色切换等待竞争已修正为按目标身份等待，成功结果以上述新运行编号为准。

能力存在不等于视觉合格、模型规范完全符合、平台预检或安装成功；视线控制器存在不证明眼睛实际运动。`visualReview: not-reviewed`、platformPreflight/Installation not-run 保持不变。下一阶段仍可推进更多模型连续动作视觉 QA 和性能工具；真实 API、物理多屏/DPI/休眠、ChatGPT 官方入口安装待实际环境。下面保留 0.8.3 和旧长测证据；不可将旧 EXE 路径或旧版满小时结论当作当前包验收。

## 0.8.3 保留记录

2026-11-03，用户“继续干吧兄弟”恢复开发。本轮只保存本地阶段提交，没有推送或发布。用户自行推送远端；GitHub 最后已知发布仍为 v0.8.0 Preview，标签提交 682348199db6af727fa7ea9fc8494163df8f0b39，后续发布必须依据当次要求。

## 本轮结果

0.8.3 新增不联网的配置检查、首次设置指引和格式反馈，以及按 HTTP 状态/已知错误码区分认证、模型、频率、额度等错误。检查为工坊专属 IPC，只返回枚举，不写配置、不清会话、最多等待 5 秒，检查期间排斥保存/发送。详见 [CHECKPOINT_08_3.md](CHECKPOINT_08_3.md)、[CHAT_SETUP.md](CHAT_SETUP.md) 和 [版本说明](releases/v0.8.3.md)。

重要修复：Electron 45 的异步解密返回 `{ result, shouldReEncrypt }`，旧实现误把对象放入 Bearer 认证头。现在取 result 并校验；已有 version=1 密文兼容。旧 mock 返回了错误形状且没有认证头断言；已补上原生返回形状单测与实际 EXE 的严格认证头断言。未调用真实 API，不能把旧模拟测试当作真实认证成功。

验证：29 文件、362 项单测通过，`npm run verify:desktop` 完整通过。新 EXE：`release/v0.8.3-1793694190988/OiGptPet-win32-x64/OiGptPet.exe`；基础结果 `artifacts/release-smoke/run-1793694195667/result.json`。4 轮混合回归 `artifacts/chat-mixed/run-1793694231615/result.json`：66.16 秒、23 次模拟请求、errors=[]，切换/取消/工坊重开及重启边界通过。测试时基底 HEAD 为 97a58be 加本轮改动，之后提交包含相同生产代码；该短测不代表本版满小时或真实账户验收。

## 已完成的基础能力和旧证据

VRM/精灵图角色库、改名/切换、角色备份恢复、v1/v2 图集导出及预览、本地桌面诊断、透明桌宠身体拖动/鼠标视线、位置原子保存/找回和画质/省电设置已实现。首个回归模型与 AvatarSample_B 已实际加载、导出并结构检查，不能把历史 AvatarSample_A 未取得当作“第二模型尚未验证”。更多角色动作及连续播放仍需视觉 QA。

对话保留四轮成功消息及最后一次尝试，仅在内存；工坊刷新/关闭取消当前请求，重开恢复会话，桌宠重开恢复气泡。退出应用、清空或保存设置清除会话。IPC 拒绝无关窗口、子 frame、销毁/null sender；快照/事件用序列防旧状态覆盖。失败重试保留新草稿。保留角色切换/改名时的气泡与动作恢复。

0.8.2 已修复整模型释放时未关闭 ImageBitmap 的遗漏，重入/已取消但加载完成/缺少 VRM 候选共用清理；不能用于跨模型共享图片的部分释放，也未证明解析尚未返回场景时的所有异常清理。固定窗口资源检查见 [CHECKPOINT_08_2.md](CHECKPOINT_08_2.md)。

0.8.2 软件配置满小时：`artifacts/chat-soak/run-1793671897524/result.json`，源码 2526a24，300 秒预热后观察 3600.50 秒，32 完整循环/185 模拟请求/261 定时样本/0 跳采，功能 errors=[]。预热后 memoryNeedsReview=false，原始 rawMemoryNeedsReview=true，GPU 精灵图 +108.14 MiB、transition +156.01 MiB；保留 GPU 正斜率，不宣称无泄漏。见 [CHECKPOINT_08_SOAK.md](CHECKPOINT_08_SOAK.md)。

默认 Intel UHD 630 / D3D11 对照：`artifacts/chat-soak-default/run-1793678490100/result.json`，源码 862faca，300 秒预热后 3600.04 秒，32 完整循环/185 模拟请求/261 样本/0 跳采，errors=[]，raw 和预热后提示均 false。实际 WebGL 探针、GPU features/basic info、verification.json 和 comparison.json 已保存；两组运行时代码摘要和负载参数一致。单机顺序对照不能推广到所有设备或抹除软件配置提示。见 [CHECKPOINT_08_GPU_COMPARE.md](CHECKPOINT_08_GPU_COMPARE.md)。旧 EXE 可能已由三包保留策略清理，证据仍在忽略目录。

## 下一步与约定

1. 真实 API 账户对话仍待实际配置验收，不自动试用付费请求。
2. 物理多屏/DPI/休眠、关机边界和实际 FPS/能耗待实机；不要将自动模拟矩阵误标为已验收。
3. 更多模型连续动作视觉 QA、目标 ChatGPT 官方宠物入口预检/安装仍待完成；导出成功不代表安装成功。
4. 更多设备 GPU 观察、语音/口型、Live2D、外部动作及任务状态同步属后续范围。

需要用户体验桌面功能前先从当前源码运行 `npm run verify:desktop`，给出新 EXE 和对应提交；本地只留最近三包。阶段结束先保存本地提交再暂停。用户要求控制五小时额度，本轮保守预留至少 40%，不能声称已读取额度百分比；不启动无必要的重复长测。前轮 13:20 停止已履行，新指令恢复后不沿用过期时间点。无 DeepSeek 协作者，不另开代理或并行改共享文件。
