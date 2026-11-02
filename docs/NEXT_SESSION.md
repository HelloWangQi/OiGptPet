# 阶段六接续（2026-11-02）

当前源码候选为 0.6.0 Preview，详见 PHASE_06.md。工坊支持配置模型 ID 与 API Key、文本对话、取消/清空；桌宠接收回复气泡及思考/挥手状态。系统 safeStorage 加密密钥，聊天仅保留内存中最近四轮上下文，主进程固定请求 OpenAI Responses API，不执行模型工具，不读取用户文件。

266 项单元测试通过；实际 EXE smoke 使用合成密钥和模拟网络验证系统加密、配置重启、对话气泡、纯文本输出、取消和越权拒绝。完整桌面验证以 release/latest.json 和 artifacts/release-smoke/latest.json 指向的本轮 0.6.0 记录为准。没有用户 API Key，真实付费服务未联调。

用户本轮要求先保存本地提交，再发布 GitHub 新版本，允许完成必要的分支推送和远端 SHA 校验。应使用 v0.6.0 预发布、当前提交对应的新 ZIP 和 manifest；artifacts/github-release-v0.5.0/ 是更早源码的旧资产，不能用于本轮发布。发布结果在 artifacts/github-release-v0.6.0/published.json 核对。

阶段五既有一小时软件稳定性记录保留在 artifacts/desktop-soak/run-1793598937089/，发生在诊断与对话功能加入前，不代表新功能满小时测试。真实多屏/DPI/休眠、硬件功耗、ChatGPT 官方宠物安装依然未完成。本地只保留最近三个 EXE 包。下一步为真实账户对话验收和上述硬件/平台矩阵，不自动追加语音或 Live2D。
