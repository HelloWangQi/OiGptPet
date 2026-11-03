# 接续：0.8.2 预热后满小时混合运行完成

GitHub 已发布 [v0.8.0 Preview](https://github.com/HelloWangQi/OiGptPet/releases/tag/v0.8.0)，标签提交 682348199db6af727fa7ea9fc8494163df8f0b39。0.8.1 为 8477f01，0.8.2 位图释放修复为 9afa1fe；本轮在其上新增长测工具并保存 2526a24d9353b5e22560f5b5bb46df0ba01452d5 后，以干净工作区运行正式长测。没有推送或更新 GitHub 附件。用户手动推送代码，代理只在明确要求后发布 Release。

当前主进程最多保留四轮成功对话和最后一次尝试，工坊刷新/关闭仅取消当前请求；重开恢复成功历史与失败/取消消息，桌宠重开读取显示状态。清空、保存设置、退出应用清除会话，没有聊天磁盘文件。未发送草稿不保留。快照与事件按序列防旧状态覆盖，完整会话 IPC 只给工坊；IPC 归属新增 null/销毁/无关窗口/子 frame 拒绝。

保留 `PetChatPresentation` 的角色切换气泡/动作恢复。本轮新增 `disposeVrmScene`：关闭整模型材质与 shader uniform 持有的 ImageBitmap，共享图片去重；正常释放、已取消但加载完成、缺失 VRM 候选路径共用清理。每次加载图片独立且 THREE.Cache 未启用；不能用于跨模型共享图片的部分释放，也未证明解析过程中尚未返回场景的异常资源回收。旧 0.8.1 包实测切回精灵图后两个窗口各有 18 张解码位图未关闭，复现记录 artifacts/chat-mixed/run-1793670246064/failure.json。

最新 `npm test`：28 文件、336 项通过；`npm run verify:desktop` 完整通过。最新 EXE `release/v0.8.2-1793671606125/OiGptPet-win32-x64/OiGptPet.exe`；基础包验收 artifacts/release-smoke/run-1793671619694/result.json。运行时代码仍为 0.8.2，测试前比较所有包内 Electron 与前端文件，并保存 SHA-256。所有请求均为模拟服务和合成设置，产物和原始资源留在 Git 忽略目录。

新增 `npm run test:chat-memory`：chat-stress --mixed --fixed-windows --cycles 8 --settle-seconds 5。固定两个窗口，保留对话、取消/清空、隐藏、改名和迟到响应，循环中不重建窗口；最后仍重启检查会话/配置边界。按原生 PID 映射工坊/桌宠，记录 post-load/settled/cycle-end、近似 performance.memory 和 Node 内存；原始与 settled 报告阈值相同，无强制 GC。结果 artifacts/chat-memory/run-1793670589941/result.json：46 请求、143.21 秒、41 样本、errors=[]；两个窗口各 144 张 VRM 位图全部对应关闭，原始和 settled 提示均未触发。详见 CHECKPOINT_08_2.md。

新增 `npm run test:chat-soak`：自动固定窗口和混合负载，300 秒预热后观察完整 3600 秒，每 60 秒按绝对截止时刻切换，每 15 秒独立采样。参数/计时/采样覆盖在 chat-stress-options.mjs，说明 CHAT_SOAK.md。短预检 artifacts/chat-soak/run-1793671694777/result.json：65.33 秒总时长、completeHour=false，正常通过，不能当满小时。

正式 artifacts/chat-soak/run-1793671897524/result.json：total=3900.50 秒、observation=3600.50 秒、completeHour=true、32 个完整循环、185 模拟请求、65 个切换时刻、33 次隐藏恢复、261 次定时采样、sampleSkipped=0、最大采样间隔 19.73 秒，errors=[]。固定工坊 PID 36684 / 桌宠 PID 30868；退出重启配置保留、会话清空且不自动请求。额外 .cache/verify-chat-soak.mjs 校验计时/采样/资源/统计重算/源码摘要通过，verification.json 已保存。最终文档提交不改变被测代码。

预热后 stable 的 memoryNeedsReview=false，但 rawMemoryNeedsReview=true：GPU 原始精灵图净增 108.14 MiB，transition 净增 156.01 MiB。预热后 GPU 精灵图仍净增 87.57 MiB、斜率 +2.32 MiB/min，VRM 净增 51.93 MiB、斜率 +1.70；保留 GPU 正斜率观察项，不能宣称无泄漏。工坊两种负载净增约 14–15 MiB，桌宠 VRM +2.77 MiB；详见 CHECKPOINT_08_SOAK.md。后续优先做相同负载的实际 GPU 对照或更长池化/回收观察，不用改阈值或强制 GC 消除提示。真实账户、多屏/DPI/休眠、实际能耗及 ChatGPT 官方宠物安装仍待实际环境。

用户忙碌，不必反复请求验证；需要用户体验新功能前先运行 verify:desktop，提供新 EXE 与对应提交。本地仅保留最近三个包。后续推送/发布按用户当次要求，不能因为旧授权自动发布下一版本。
