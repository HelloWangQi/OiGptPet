# 0.8.2 检查点：VRM 解码位图释放与进程归属

2026-11-03；基线 8477f01b58a4bac7ee8ca948657ce297411abbd6。只保存本地提交，未推送或更新 GitHub 0.8.0 Preview。

## 复现与修复

在 0.8.1 实际包上补充非图集 ImageBitmap 创建/关闭探针，`artifacts/chat-mixed/run-1793670246064/failure.json` 复现：切回精灵图后工坊和桌宠分别累计创建 18 张 VRM 位图、关闭 0 张，虽然 WebGL 上下文已释放。之前仅跟踪图集 bitmap 和上下文，无法发现这一遗漏。

当前安装的 three-vrm 3.5.5 的 `VRMUtils.deepDispose` 会 dispose 纹理，但不调用底层 ImageBitmap.close；Three.js GLTFLoader 使用 ImageBitmapLoader。官方文档明确要求应用单独处理 CPU 侧位图释放：[How to dispose of Objects](https://threejs.org/manual/pages/how-to-dispose-of-objects.html)。

新增 `disposeVrmScene`，释放模型前收集材质属性和 shader uniform 中的解码位图，在 GPU 纹理清理后关闭；共享图片用 Set 去重，不按是否有 close 方法处理 canvas/video 等其他源。正常模型释放、加载完成后已取消、无 VRM 候选共用清理；GPU dispose 抛错时也尝试关闭收集到的图片。本项目每次解析拥有独立图片且未开启 THREE.Cache，完整模型不再使用时才调用此函数；不能将它用于跨模型共享图片的部分场景释放。解析过程中尚未返回场景的异常资源回收不在本次证明范围。

## 采样改进

新增 `readProcessMetrics` / `labelProcessRoles`，以原生 OS PID 记录工坊/桌宠、窗口 ID、可见性；一个 PID 若共享多窗口仍只计一次进程内存。统计继续按 PID+创建时间+角色类型分组，不修改增长阈值。

`--mixed --fixed-windows --cycles 8 --settle-seconds 5` 固定两个窗口，保留对话/取消/清空/隐藏/改名/迟到响应检查；记录 post-load / settled / cycle-end 样本、近似 Chromium 堆与 Node 内存。报告同时保留原始 memory 和 settledMemory，未强制 GC。详细命令和限制见 [CHAT_STRESS.md](CHAT_STRESS.md)。

## 验证

- `npm test`：27 文件、317 项通过，新增共享图片去重、shader 源、非位图源、清理异常与 PID 归属/共享进程回归。
- `npm run verify:desktop` 完整通过。新 EXE：`release/v0.8.2-1793670399545/OiGptPet-win32-x64/OiGptPet.exe`；基础验收：`artifacts/release-smoke/run-1793670405870/result.json`。
- 四轮混合生命周期检查：`artifacts/chat-mixed/run-1793670497136/result.json`，23 次模拟请求、62.50 秒完成，所有位图关闭、流释放、窗口重开和角色切换断言通过。
- 固定窗口八轮检查：`artifacts/chat-memory/run-1793670589941/result.json`，46 次模拟请求、143.21 秒、41 样本、errors=[]。工坊 PID 12128 / 桌宠 PID 9860 在采样中固定；各创建并关闭 144 张非图集位图，VRM→精灵图后差为零；8 次上下文创建也对应 8 次显式 loss，仅当前一个精灵图 bitmap 保留。
- 原始精灵图命令兼容检查：`node scripts/chat-stress.mjs --cycles 4` 通过，`artifacts/chat-stress/run-1793670832698/result.json`。新参数不影响原有模式。

等待 5 秒后的精灵图阶段 privateBytes：工坊 156.25→128.61 MiB、桌宠 128.33→117.22 MiB；VRM 阶段分别 217.25→175.19 MiB、180.26→173.17 MiB。本轮原始及 settled 两个增长提示均未触发，没有将 post-load 样本从原始结果中移除。

运行时记录的源提交为基线、dirty=true；包内 Electron 和前端文件在运行前与本地代码逐字节比较并记录 SHA-256，最后保存为本地阶段提交。测试模型、profile 和产物均留在忽略目录，不进入公开包。

## 尚未证明

这次修复证明了已知回归模型的显式位图释放路径补齐，不能据此把 0.8.1 所有内存增长归因到这一处。短测环境与之前反复重建窗口的 24 轮不同，不能用这次没有提示消除之前的复核记录。新的预热后满小时混合负载仍需执行，真实账户、多屏/DPI/休眠、实际 GPU/能耗和 ChatGPT 官方宠物安装仍未验收。
