# 阶段六接续：0.6.1 本地检查点

已发布 0.6.0 Preview：https://github.com/HelloWangQi/OiGptPet/releases/tag/v0.6.0 ，对应 b5ad62d；发布资产及独立远端核验保存在 artifacts/github-release-v0.6.0/。Git HTTPS 当时不可用，最终通过 Git Data API 同步了完全相同的 blob/tree/commit SHA，并以非强制方式快进分支。

本轮用户只要求继续开发，交付 0.6.1 本地检查点，不推送也不发布。范围：失败/取消消息恢复、重试与草稿保护、Ctrl/⌘+Enter 与输入法组合键处理、初始化禁用、请求全程可取消等待、独立移除密钥、避免保存后检查失败误报。详见 PHASE_06.md 和 CHECKPOINT_06_1.md。

272 项单元测试通过；最新实际 EXE 验证和包路径以 artifacts/release-smoke/latest.json、release/latest.json 为准。本地只保留最近三个 EXE 包。网络测试是模拟服务与合成密钥，真实 API 账户尚未联调。

本轮完整 verify:desktop 通过。最新 EXE：`release/v0.6.1-1793609669954/OiGptPet-win32-x64/OiGptPet.exe`；烟测结果：`artifacts/release-smoke/run-1793609678277/result.json`。一次物理鼠标混入导致的拖动检查失败及重跑通过记录见 CHECKPOINT_06_1.md。

下一步优先由用户验证当前 EXE 的恢复/重试手感和真实账户对话，再推进流式输出。真实多屏/DPI/休眠、硬件功耗与 ChatGPT 官方宠物安装仍未完成。阶段五的一小时记录发生在诊断与对话新增前，不能作为新功能长测结论。将来用户明确请求发布时，重新制作当前源码对应版本的 ZIP/manifest，不能复用旧资产。
