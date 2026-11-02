# 0.7.0 本地检查点：流式回复

基线为 0.6.1 本地提交 778423e。用户忙碌期间授权继续开发，按阶段计划补充流式文本输出；本检查点只提交本地，不推送或发布。GitHub 仍以 0.6.0 Preview 为已发布版本。

## 行为

固定 OpenAI Responses 请求增加 `stream: true`，继续使用 `store: false` 和最近四轮成功上下文。工坊与桌宠接收逐步更新的纯文本；同一条伙伴回复会原地更新，完成后不会重复插入。更新最多约每 50ms 一次，完成和错误状态立即发送。每轮使用 UUID 关联进度，工坊拒绝不属于当前请求的进度事件。

仅收到有效 `response.completed` 且最终回复非空时，才将完整文本加入历史。断线、超时、取消、`response.failed`、`response.incomplete` 和流式错误都不保存片段到上下文。工坊将可见片段标记为“未完成，未加入上下文”，恢复草稿并允许重试；重试会移除旧片段并复用原消息记录。清空对话会移除片段与重试状态，迟到事件不会恢复已清空内容。

## 读取边界

`electron/response-stream.cjs` 独立解析 SSE：支持 UTF-8 跨字节分段、初始 BOM、LF/CRLF/CR、跨网络块的行、注释和多行 data。按输出/内容索引组合文字；忽略推理与其他非文本事件，不执行工具。完成事件的文本是最终依据。

单次编码响应仍限制 256 KiB、可见回复 8000 字、60 秒总超时。错误内容不直接回显上游原文。读取完完成事件立即释放流，不等待连接继续闲置；取消保留 0.6.1 的全程等待边界并释放迟到响应。保留有界完整 JSON 回复读取以兼容已有非流式返回测试，并不表示已验收其他供应商接口。

协议依据：[OpenAI 官方流式指南](https://developers.openai.com/api/docs/guides/streaming-responses)、[Responses 流式事件](https://developers.openai.com/api/reference/resources/responses/streaming-events)。

## 验证

- 23 个单元测试文件、294 项通过。新增覆盖 UTF-8 单字节分片、三种换行、缺少完成标志、错误事件、非法/过长回复、无效 UTF-8、流保持打开、分段排序与上下文提交、取消通知清理等边界。
- `npm run verify:desktop` 通过；最新 EXE：`release/v0.7.0-1793610500470/OiGptPet-win32-x64/OiGptPet.exe`。
- 实际包记录：`artifacts/release-smoke/run-1793610510827/result.json`，验证完成前工坊/桌宠可见片段、完整回复原地替换、HTML 作为文本、中断后重试、取消片段与清空，以及现有草稿、角色库、诊断、拖动、密钥加密与重启流程。

全部服务验证使用模拟网络与合成密钥，没有付费请求。真实 API 账户、流式长测、真实多屏/DPI/休眠、硬件能耗及 ChatGPT 官方宠物安装尚未验收。此前阶段五满一小时记录不能代替本功能长测。本地仍只保留最新三个 EXE 包。
