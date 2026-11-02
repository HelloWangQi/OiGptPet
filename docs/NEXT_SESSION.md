# 接续记录：0.7.0 流式对话本地检查点

已发布 0.6.0 Preview：https://github.com/HelloWangQi/OiGptPet/releases/tag/v0.6.0 ，源码 b5ad62d。发布核验与原始附件在 artifacts/github-release-v0.6.0/，不要用其 manifest 发布后续源码。

用户要求继续往后开发，目前完成两个本地检查点：0.6.1（778423e）的失败恢复、草稿保护、快捷发送、取消边界；0.7.0 的流式回复、片段显示、中断标记、请求关联和 SSE 解析。详见 CHECKPOINT_06_1.md 与 CHECKPOINT_07.md。本轮只提交本地，未推送、未更新 GitHub Release。

294 项单元测试通过，完整 verify:desktop 通过。最新 EXE：release/v0.7.0-1793610500470/OiGptPet-win32-x64/OiGptPet.exe；实际包记录 artifacts/release-smoke/run-1793610510827/result.json。本地只保留最近三个 EXE 包。网络均为模拟服务，使用合成密钥；没有真实账户付费调用。

用户当前忙碌，不必反复要求验收。后续可先完善对话状态恢复与可复现压力检查；真实账户联调、多屏/DPI/休眠硬件矩阵和 ChatGPT 官方宠物安装仍需要用户环境。不要把以前的一小时结果当成新对话功能长测，也不要自动增加语音或切换服务商。新发布需用户明确要求，重新编译、制作对应 ZIP/manifest 并核对远端 SHA。
