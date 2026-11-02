# 开发与发布接续（2026-11-02）

## 上轮发布准备记录（原附件保持不变）

- 项目分支：`codex/desktop-prototype`；当前最新稳定版为 0.4.0，候选为 GitHub 预发布 `v0.5.0`。
- 阶段五软件一小时运行通过：`artifacts/desktop-soak/run-1793598937089/result.json`，3600.51 秒、39 次角色切换、9 轮拖动/隐藏交互、119 个采样、`errors=[]`。
- 拖动预检已修复画布替换后的首帧空白竞争；还等待鼠标触发的视线帧绘制，并轮询原生窗口到达目标坐标。3 分钟高频测试 `artifacts/desktop-soak/run-1793598721673/result.json` 通过，33 次切换、8 轮交互。
- GPU 内存按 VRM / 精灵图分开统计：VRM 55 点 466.0→515.4 MiB，精灵图 53 点 239.3→305.6 MiB；同类型首末净增低于 100 MiB 标记门槛，但各有约 1.1 MiB/min 正斜率，后续可继续观察。数据来自 SwiftShader，不代表真实显存或能耗。
- 真实多屏、DPI、显示器拔插、休眠/恢复、注销和硬件耗电未验收；ChatGPT 官方入口的安装与运行也未验收，已在预发布说明列出。
- `npm test`：20 个文件、249 项通过。`npm run verify:desktop`：通过，最新包 `release/v0.5.0-1793603164118/OiGptPet-win32-x64/OiGptPet.exe`，Smoke 记录 `artifacts/release-smoke/run-1793603170283/result.json`。本地只保留最近 3 个 EXE 包。
- 0.5.0 发布 ZIP、校验文件和 manifest 位于 `artifacts/github-release-v0.5.0/`。ZIP SHA-256：`d51d1ee654c667b3c2ea7cb7e983345a4a93a5c03bece139fec95ad720213906`。包中没有 VRM、测试图集、用户数据或 `.cache`。
- GitHub 已有 Release 仍只有 v0.1.0–v0.4.0；尚未创建 v0.5.0。

## 本轮继续开发：实机诊断支持

新增工坊“保存桌面诊断”，从主进程白名单采集系统、显示器、窗口和进程性能瞬时数据，由原生保存框写入本地 JSON；不采集角色/账号/路径，不显示隐藏桌宠。详见 DESKTOP_DIAGNOSTICS.md。工坊版本号现来自 package.json。254 项单元测试通过，最新实际 EXE 检查结果以 release/latest.json 和 artifacts/release-smoke/latest.json 为准。

本轮最新 EXE：`release/v0.5.0-1793606532631/OiGptPet-win32-x64/OiGptPet.exe`；验证结果：`artifacts/release-smoke/run-1793606598726/result.json`。完整 verify:desktop 已通过，本地仍只留最近 3 个 EXE 目录。到此保存阶段提交并停止；后续由用户决定继续实机验证或准备新附件发布。

原 artifacts/github-release-v0.5.0/ 附件仍绑定 b210522，只对应上轮候选，不能用于当前新增功能的发布。用户已要求继续开发；后续真正发布时应重新制作 ZIP/manifest、更新其提交和校验值，再由用户推送最终代码。保留旧附件便于追溯。

## 后续发布

用户希望由自己推送代码。先重新制作当前源码对应附件和 manifest，再核对本地 `git status -sb` 和 `HEAD`。等待用户推送并告知完成；确认 GitHub 分支精确指向本地 HEAD 且 manifest 也绑定该提交后才运行下列命令，不能直接使用上轮旧 manifest：

```powershell
node scripts/publish-releases.mjs --publish --versions 0.5.0 --prerelease --manifest artifacts/github-release-v0.5.0/manifest.json
```

发布后核对 Release 标记为预发布、标签提交与 HEAD 相同、两个附件 SHA-256 与 manifest 一致。未收到用户已推送的确认前，不发布，也不推送远端。
