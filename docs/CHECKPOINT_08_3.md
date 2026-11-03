# 0.8.3 检查点：本地配置检查与认证修复

2026-11-03，用户恢复开发后完成本轮有界阶段。只保存本地提交，不推送或发布 GitHub。前一轮 13:20 停止约定已结束，本轮沿用保守额度预留，不启动额外长测。

## 修复与功能

实际 EXE 的本地配置检查发现旧实现误读了 Electron 45 的 `safeStorage.decryptStringAsync` 返回值。原生返回 `{ result, shouldReEncrypt }`，旧代码将整个对象写入认证头，形成错误的 Bearer 值。现明确读取并验证 result；异常值在请求前拒绝，并提示重新保存密钥。配置文件 version=1 和已保存密文不变。

旧单测模拟错误地返回字符串，旧 EXE 模拟服务没有断言认证头，因此未发现这一问题。本轮将 mock 改成原生对象形状，增加 shouldReEncrypt 两种值与无效返回值用例，并在实际 EXE 网络替身中严格断言合成密钥的 Authorization。shouldReEncrypt 提示不触发只读检查的文件更新。接口依据：[Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)。

新增工坊专属 `chat:check` IPC：只检查已保存配置、系统安全存储及本机解密，返回枚举结果，无密钥和对话内容；不联网、不写配置、不清空历史。最多等待 5 秒，可由窗口关闭/现有取消路径中止，检查期间排斥保存及发送。前端对未保存更改给出提示，未配置时展开设置，增加首次配置步骤和格式反馈。

错误分类使用应用固定文案，对 HTTP 400/404/429 的响应最多读取 8 KiB，只识别已知 error.code/type；其他状态不读取正文。区分认证、访问、模型、频率、额度/限额、参数及服务异常。未知 429 保留原因不确定性，不自动重试，不转发原始错误正文；错误体等待沿用请求的取消/60 秒超时。依据：[OpenAI API 错误说明](https://developers.openai.com/api/docs/guides/error-codes)。

## 本地验证

- `npm test`：29 个文件、362 项通过。
- `npm run verify:desktop`：TypeScript、生产构建、打包及实际 EXE 冒烟全部通过。
- 当前包：`release/v0.8.3-1793694190988/OiGptPet-win32-x64/OiGptPet.exe`。
- 基础结果：`artifacts/release-smoke/run-1793694195667/result.json`，ok=true、rendererErrors=[]。覆盖空模型启动、角色库、绘制、身体拖动、设置和重启，以及对话流式显示/取消/重试/恢复。
- 新增 EXE 检查：未配置检查、无效模型不落盘、原生加解密后的认证头、保存和检查请求计数为零、配置文件及会话快照不变、桌宠无权调用检查、未保存更改提示、额度提示不泄漏正文。
- `node scripts/chat-stress.mjs --mixed --cycles 4`：`artifacts/chat-mixed/run-1793694231615/result.json`，4 轮、23 次模拟请求、66.16 秒，errors=[]、restartClearedHistory=true；覆盖 VRM/精灵图切换、隐藏恢复及取消/刷新/重开/清空。运行时逐文件摘要与当时源码一致，记录的基底为 97a58be 加本轮未提交改动；随后提交包含相同生产代码。
- 打包保留策略自动执行，本地只保留最近 3 个已识别 EXE 包目录。

本轮第一次 EXE 检查 `run-1793693763692` 在本地检查等待阶段失败，由此定位原生返回值问题；不能把该失败构建当作通过包。上列新包已修复并通过。

## 范围和下一步

没有真实密钥或真实服务请求，未验证线上网络、模型权限、额度和生成质量。旧版本的模拟长测只证明其负载下的功能/稳定性，不证明真实认证成功。本轮短回归也不替代 0.8.3 满小时验收；0.8.2 的软件后端增长提示与默认 Intel/D3D11 对照均保留原结论。

后续优先：由实际配置验证一次线上对话；在物理设备完成多屏/DPI/休眠矩阵；完善更多模型的连续动作视觉 QA；在目标 ChatGPT 官方入口预检与安装。更多设备的 GPU/FPS/能耗、语音/口型、Live2D 和外部动作仍为后续范围。本轮使用说明见 [CHAT_SETUP.md](CHAT_SETUP.md)，版本说明见 [v0.8.3](releases/v0.8.3.md)。
