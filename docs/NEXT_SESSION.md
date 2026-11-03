# 接续：0.8.2 位图释放修复与固定窗口采样

GitHub 已发布 [v0.8.0 Preview](https://github.com/HelloWangQi/OiGptPet/releases/tag/v0.8.0)，标签提交 682348199db6af727fa7ea9fc8494163df8f0b39。本轮基线 8477f01，在本地开发 0.8.2，修复 VRM 解码位图释放遗漏；没有推送或更新 GitHub 附件。用户手动推送远端代码，代理只在明确要求后发布 Release。

当前主进程最多保留四轮成功对话和最后一次尝试，工坊刷新/关闭仅取消当前请求；重开恢复成功历史与失败/取消消息，桌宠重开读取显示状态。清空、保存设置、退出应用清除会话，没有聊天磁盘文件。未发送草稿不保留。快照与事件按序列防旧状态覆盖，完整会话 IPC 只给工坊；IPC 归属新增 null/销毁/无关窗口/子 frame 拒绝。

保留 `PetChatPresentation` 的角色切换气泡/动作恢复。本轮新增 `disposeVrmScene`：关闭整模型材质与 shader uniform 持有的 ImageBitmap，共享图片去重；正常释放、已取消但加载完成、缺失 VRM 候选路径共用清理。每次加载图片独立且 THREE.Cache 未启用；不能用于跨模型共享图片的部分释放，也未证明解析过程中尚未返回场景的异常资源回收。旧 0.8.1 包实测切回精灵图后两个窗口各有 18 张解码位图未关闭，复现记录 artifacts/chat-mixed/run-1793670246064/failure.json。

`npm test`：27 文件、317 项通过；`npm run verify:desktop` 完整通过。新 EXE `release/v0.8.2-1793670399545/OiGptPet-win32-x64/OiGptPet.exe`；基础包验收 artifacts/release-smoke/run-1793670405870/result.json。四轮混合生命周期 artifacts/chat-mixed/run-1793670497136/result.json：23 请求、62.50 秒通过；原始精灵图模式四轮 artifacts/chat-stress/run-1793670832698/result.json 也通过。所有请求均为模拟服务和合成设置，产物和原始资源留在 Git 忽略目录。

新增 `npm run test:chat-memory`：chat-stress --mixed --fixed-windows --cycles 8 --settle-seconds 5。固定两个窗口，保留对话、取消/清空、隐藏、改名和迟到响应，循环中不重建窗口；最后仍重启检查会话/配置边界。按原生 PID 映射工坊/桌宠，记录 post-load/settled/cycle-end、近似 performance.memory 和 Node 内存；原始与 settled 报告阈值相同，无强制 GC。结果 artifacts/chat-memory/run-1793670589941/result.json：46 请求、143.21 秒、41 样本、errors=[]；两个窗口各 144 张 VRM 位图全部对应关闭，原始和 settled 提示均未触发。详见 CHECKPOINT_08_2.md。

下一阶段重点是预热后固定窗口/固定切换间隔、独立定时采样的真正满小时混合负载。0.8.1 的 24 轮曾有两个 Tab PID 增长提示，本轮发现并修复具体释放遗漏，但新短测与旧的窗口重建场景不同，不能据此消除全部内存复核项或宣称无泄漏。不要调整阈值或强制 GC 使报告通过。旧阶段五满小时早于对话功能；真实账户、多屏/DPI/休眠、实际 GPU/能耗和 ChatGPT 官方宠物安装仍待实际环境。

用户忙碌，不必反复请求验证；需要用户体验新功能前先运行 verify:desktop，提供新 EXE 与对应提交。本地仅保留最近三个包。后续推送/发布按用户当次要求，不能因为旧授权自动发布下一版本。
