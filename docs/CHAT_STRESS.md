# 对话和窗口循环检查

针对 0.8.0 的流式对话与内存会话恢复，使用实际打包 EXE 反复操作工坊和精灵图桌宠。所有消息、模型 ID 和密钥均为合成测试值；在保存配置前替换主进程 fetch，不向真实服务转发请求。使用独立 `.cache/chat-stress-*` profile，不读取日常应用的设置或聊天。

```powershell
# 编译、打包，并先完成基础实际 EXE 检查
npm run verify:desktop

# 四轮预检，覆盖全部取消方式
node scripts/chat-stress.mjs --cycles 4

# 默认 24 轮，138 次模拟请求
npm run test:chat-stress

# 0.8.1 增加：VRM/精灵图、隐藏和回复混合负载
node scripts/chat-stress.mjs --mixed --cycles 4
npm run test:chat-mixed

# 固定两个窗口，八轮切换，每次等待 5 秒再记录回收后的样本
npm run test:chat-memory
```

`--cycles` 接受 4–200 的整数。本机需有 `artifacts/animation-fixes/run-04/atlas-v2.png`；资源不随公开包分发。每轮通过真实 UI 发送，测试服务校验请求上下文；不是直接调用服务层代替窗口交互。启动前检查包内所有 Electron 模块和前端文件与当前本地编译结果逐字节相同、版本相同，并检查分发白名单。运行中不要操作测试窗口。

每轮包含：

- 两次成功流式回复；过程中轮流刷新或销毁重开桌宠，检查片段恢复和最终气泡。
- 一次流式中断，依次轮换取消按钮、刷新工坊、关闭重开工坊和清空。前三种检查片段、原消息和重试，重试保留用户后来输入的新草稿；清空检查上下文消失。
- 一次不响应 AbortSignal 的模拟连接，取消后完成另一条新回复，再送达旧响应。旧响应的 body 必须释放，当前快照必须保持不变。
- 再刷新工坊，检查恢复历史无重复；请求必须恰好对应显式发送或重试，历史只保留成功的四轮，失败与取消片段不能混入请求。
- 检查只存在一个工坊和一个桌宠、可见记录最多 12 条，所有 SSE reader 在完成或取消后释放（完成事件到达后连接故意保持打开）。

最后退出并重新启动同一 profile，检查配置仍在、会话和回复状态为空、没有自动发请求。渲染器异常、崩溃或意外应用退出均导致失败。

产物保存在 `artifacts/chat-stress/run-*/`：`conditions.json` 记录环境、包目录、运行前提交及工作区是否有改动、所有运行时代码 SHA-256；`samples.ndjson` 保存各轮窗口数、请求数、流释放数及原始进程指标；`progress.json` 保存进度；成功写 `result.json` 并更新 `latest.json`，失败写 `failure.json` 和可获取的截图。Ctrl+C 请求中断后不计成功，强制终止可能只有进度。产物和测试 profile 均被 Git 忽略。

内存按 PID、进程创建时间和角色类型分组，采用既有 `stability-metrics.mjs` 汇总。该短测包含初始化、渲染器反复重建和延迟回收，没有强制 GC；`memoryNeedsReview` 只提示复核，不能证明泄漏或无泄漏。这不是满小时稳定性、VRM 切换、真实 API、多屏/DPI/休眠或能耗验收。

## 混合模式

`--mixed` 复用上述请求与窗口检查，另需本地 `public/models/demo.vrm`。每轮从精灵图开始，在第一条流式回复期间切换到 VRM；服务此时不再发新片段，以便确定加载本身不会清空气泡。轮流刷新/销毁重开桌宠后隐藏，隐藏中完成回复。检查原生窗口仍隐藏、实际 draw 计数停止，重新显示后恢复绘制。随后切回精灵图并改名，已完成气泡和主进程会话快照必须保持不变。恢复和角色操作不允许多发请求。

启动前注入资源探针，每次切换和每轮结束检查两个窗口的上下文/bitmap 计数：只保留当前角色的一个 WebGL 上下文或一个图集 bitmap。探针只计应用创建及释放调用，不能作为实际显存释放证明。每个类型分别采样进程指标，避免用 VRM 的内存基线与精灵图直接相减。

混合模式产物在 `artifacts/chat-mixed/run-*/`，profile 仍使用隔离的 `.cache/chat-stress-*`。成功报告含 `mixed=true` 和每轮两次切换及一次隐藏恢复的 `mixedActions`，样本含两个窗口的资源计数。本模式仍是按轮数运行，不以执行时间不足 3600 秒的结果冒充满小时；GPU/CPU 资源开销受到软件渲染影响。隐藏判断采用原生窗口可见性与实际绘制计数，不依赖隐藏窗口的定时器是否被调度。

## 固定窗口与内存回收采样（0.8.2）

`--mixed --fixed-windows --cycles 8 --settle-seconds 5` 是一轮有界定位检查。加载就绪后固定工坊和桌宠窗口，不在循环中刷新/销毁重建；取消方式轮换为显式取消和清空，仍检查流式回复、重试、隐藏、改名和迟到响应。每次角色切换后分别记录 `memoryPhase=post-load` 和等待后的 `settled`，每轮结束再记 `cycle-end`。最后仍退出并重启验证配置/会话边界，不计入固定窗口采样。等待时间为 0–30 秒整数，不保证 5 秒后已经进入稳态。

`artifacts/chat-memory/run-*/` 保存固定窗口结果，`windows` 中包括窗口角色、原生 PID、窗口 ID、原生可见性；进程样本增加 `roles`，共享 PID 不拆分或重复计算内存。按 PID+进程创建时间+角色类型分组，PID 不会被当作永久身份。`mainMemory` 是 Node 内存字节数，`workshopHeap` / `petHeap` 是 Chromium `performance.memory` 的近似字节数，不等于精确保留堆或原生内存。

资源探针增加已知回归资源的非图集 ImageBitmap 创建/关闭计数 `textureBitmaps` / `textureClosed`（图集仍按尺寸单独计数）。切回精灵图后，两个窗口的非图集位图差必须为零。它验证显式 `close()`，不追踪 GC，也不证明操作系统立即归还内存；尺寸分类只用于这组已知测试资源。

报告继续保留包含初始化/加载样本的原始 `memory` 与 `memoryNeedsReview`，另给仅 `settled` 样本的 `settledMemory` / `settledMemoryNeedsReview`。两者使用相同阈值，绝不通过隐藏原始增长或强制 GC 判定通过。固定窗口短测只有定位意义，不替代预热后的真实满小时、实际 GPU 或用户账户验收。
