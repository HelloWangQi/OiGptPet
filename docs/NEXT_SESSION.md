# 阶段五接续（2026-11-02）

用户已确认直接拖动与鼠标转头方向改进可用，后续独立开发；DeepSeek 不再参与。每次让用户验证前按 AGENTS.md 重新 npm run verify:desktop，只保留最近 3 个 EXE 包。额度至少留 20%；本轮接近保留线停下，不自动重跑一小时或发布。

## 下一步先查异常，别先加功能

1. 阅读 CHECKPOINT_05.md 最后一节和 DESKTOP_SOAK.md。
2. 第一次长测 failure：artifacts/desktop-soak/run-1793589190638/failure.json，21 分钟后角色 ID 同步等待超时；samples.ndjson 有 40 个样本，native.log、操作序列可查。初版没有失败 UI 现场，不能断言根因。
3. 同步状态等待已改 polling:100（不用 RAF），新短测 artifacts/desktop-soak/run-1793590555965/failure.json 则在 scripts/pet-drag-smoke-steps.mjs 的 pet-body-dragging 起始等待失败；检查该目录的两窗口状态、hidden、probe、workshop-failure.png/pet-failure.png，核对浏览器/原生窗口焦点、pointer capture 与命中帧，区分测试假设和产品问题。不要简单增加超时或跳过断言。
4. 先做确定性小复现并修复，再直接 Node 短测复验；因 PowerShell 此环境吞 npm 转发参数，不要用带自定义参数的 npm 调用。

```powershell
npm test
npm run verify:desktop
node scripts/desktop-soak.mjs --minutes 1 --switch-seconds 3 --sample-seconds 5
# 上面完全通过，再运行正式测试；需真实一小时，失败不得标通过
npm run test:soak
```

产品运行代码在本轮没有改变；新增长测工具已做过一次成功短预检、一次正式失败和一次带现场记录的失败。248 项单元测试及基础 EXE 验收通过，不代表一小时验收完成。不要无必要重建旧版 0.1/0.2 或更改账号、许可、模型。真实多屏、DPI、休眠、注销和耗电仍留待实机矩阵。
