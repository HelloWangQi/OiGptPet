# 开发接续记录（2026-11-02）

## 当前状态

- 项目本地 `codex/desktop-prototype`；已发布版本仍为 0.4.0。
- 阶段五软件一小时运行已通过：`artifacts/desktop-soak/run-1793598937089/result.json`，3600.51 秒、39 次角色切换、9 轮拖动/隐藏交互、119 个采样、`errors=[]`。
- 拖动预检曾在角色画布替换后首帧绘制前读到透明画布。修复在测试助手中等待可见帧，悬停后重查视线帧像素，并轮询真实窗口坐标最多 2 秒；3 分钟高频测试 `artifacts/desktop-soak/run-1793598721673/result.json` 通过，33 次切换、8 轮交互。
- GPU 内存按 VRM / 精灵图分开统计：基于已完成长测样本，VRM 55 点为 466.0→515.4 MiB，精灵图 53 点为 239.3→305.6 MiB；各自净增未达 100 MiB 标记门槛，但有约 1.1 MiB/min 正斜率，继续观察。原始逐样本数据保留；此软件测试使用 SwiftShader。
- 真实多屏、DPI、显示器拔插、休眠/恢复、注销和硬件耗电未验收；ChatGPT 官方入口的安装与目标平台运行也未验收。
- 用户希望本地提交后自行推远端，远端确认一致后再创建 GitHub 新版本。当前候选 `v0.5.0`，package、lockfile、预发布说明和发布器 `--prerelease` 支持已准备；不要在远端分支未包含最终本地提交时发布。
- 每次让用户验证桌面前，先 `npm run verify:desktop` 重新编译并做真实 EXE smoke；本地 EXE 只留最新 3 个包。测试 VRM/图集保留在忽略目录，不进公开发布包。

## 本地改动待办

本次接续中 `scripts/pet-drag-smoke-steps.mjs`、`scripts/stability-metrics.mjs`、`tests/stability-metrics.test.js`、阶段文档、README、0.5.0 发布器和发布说明已有改动；全量测试与发布包 smoke 已通过，本地提交和 ZIP/manifest 仍待完成。先检查 `git status`，不要覆盖新的用户改动。

1. 检查最终 `git status` 和差异，确认没有并入其它人的未交付文件。
2. 按用户已有请求创建本地提交并生成 release ZIP、SHA256、manifest；不推送、不创建公开 Release。
3. 请用户手动推送最终提交。收到完成消息后核对 GitHub 分支 SHA 与本地提交，再创建 `v0.5.0` 预发布并核对附件 SHA256。
