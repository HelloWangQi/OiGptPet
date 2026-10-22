# 阶段 02：主程序验收快照（待协作方最终交付）

日期：2026-10-22。版本 `0.2.0`，分支 `codex/desktop-prototype`，基线提交 `7ea0cbc`。

用户确认 DeepSeek 仍在收尾，并明确要求暂不提交其文件，随后授权先单独提交 Codex 部分。本次提交仅含主程序、保存/报告、分发脚本、主集成测试与协作记录；DeepSeek 的组件、动画代码及其测试和文档保留在工作区，等待后续提交，不推送。

下列完整联调结果针对包含双方代码的工作区快照，不代表本次单独提交已包含全部依赖。仅检出本次提交时，预览组件尚缺，点击导出会提示“动画预览暂不可用”；动画仍使用基线实现。完整阶段交付需再纳入 DeepSeek 文件；若其最终交付改变代码，先核对差异并补跑受影响检查。

单独提交另行验证：使用 `git checkout-index` 将暂存内容导出到独立 `.cache/codex-commit-1792658590950/`，在该快照运行 `npm run build` 通过，`npm test` 为 5 个文件、45 项通过。此快照不包含 DeepSeek 未提交的组件、动画修复及测试。

## 本轮交付

- 局域网工坊：Vite 开发与预览监听 `0.0.0.0:5173`；浏览器支持本地导入、角色预览与图集导出。悬浮桌宠使用 Electron。
- 实际 PNG 检查与逐帧预览：从最终 Blob 解码、检查和计算 SHA-256，提供九种状态及 v2 十六方向控件。结构错误定位行/帧，并禁止 PNG 保存，诊断报告仍可保存。
- 导出生命周期：取消、更换角色、关闭弹窗和重新导出会清除旧结果，释放预览，忽略过期异步回调。
- 文件一致性：保存检查过的同一个 Blob；JSON 报告记录规格、精确字节数、哈希、模型元数据与检查结果。Electron 主进程保存 PNG 前再次核对哈希。
- 发布边界：普通生产构建排除 `public` 模型；`build:demo` 单独输出至 `.cache/demo-dist/`。打包使用文件白名单检查，默认不含源模型、下载元数据和用户产物；提供导入空状态。
- DeepSeek 已落盘预览组件、局域网 HTTP 的 SHA-256 回退、播放数值边界修复及动画修复代码。动画修复通过最终归一化后初始化 Spring Bone、固定步长稳定物理和每帧一次绘制，改善首帧头发状态；失落姿态更明确。其最终交付说明仍待完成。

## 本机验证

| 命令/检查 | 结果与证据 |
| --- | --- |
| `npm test` | 7 个文件、82 项通过，包含导出会话、预览、分发与动画回归 |
| `npm run build:demo` | 类型检查和示例构建通过 |
| `npm run build` | 类型检查和生产构建通过 |
| `npm run test:smoke` | 最新代码 v1/v2 预览、原生 PNG/报告保存、哈希不符拒绝、污染格保存门控、取消重开、透明置顶桌宠通过，无渲染错误 |
| `node scripts/atlas-preview-smoke.mjs` | 已有组件实测通过：有效 PNG/WebP、损坏/超限/错误规格、并发/取消、控件、资源释放和真实非安全局域网 HTTP 摘要回退；结果见 `artifacts/atlas-preview-smoke/result.json` |
| `node scripts/animation-render-smoke.mjs --model public/models/demo.vrm --out-dir artifacts/animation-fixes/run-01` | DeepSeek 独立结果 `ok: true`；v1/v2 结构通过，重复 v2 哈希一致，取消产生 AbortError，4 个 WebGL 上下文均释放；主程序导出哈希与之相同 |
| `node scripts/atlas-visual-qa.mjs --file artifacts/animation-fixes/run-01/atlas-v2.png --profile v2 --out-dir artifacts/animation-fixes/run-01/qa-v2` | 新输入结构通过，联系表和基线图已生成；下述视觉结论仅限已查看静态帧 |
| `node scripts/package.mjs` | 新 Windows x64 免安装包生成成功，打包前后分发白名单检查通过 |
| `npm run test:release` | 实际启动上述最新包，确认 `app.isPackaged` 为 true、无默认模型、可本地导入且重启恢复，无渲染错误；证据见 `artifacts/release-smoke/result.json` |

最新主冒烟证据：`artifacts/smoke/phase-02/run-1792657885250/result.json`，也可从 `artifacts/smoke/latest.json` 查找。所有产物与模型均被 Git 忽略，不纳入源码提交。

当前包：`release/v0.2.0-1792657961181/OiGptPet-win32-x64/OiGptPet.exe`。`release/latest.json` 指向最新成功生成目录，旧包保留。该包使用当前工作区快照，仍属开发验收包。

## 精确图集与视觉范围

输入为官方 `VRM1_Constraint_Twist_Sample.vrm`，SHA-256：

`12c2b97e95e700783a6a550dc0eee2d7880aeedccef9ae67bc4c5a2f0f2631a2`

| 最终输出 | 字节数 | SHA-256 |
| --- | ---: | --- |
| v1，1536×1872，57 帧 | 293312 | `4b0af6b5f6020bf49ebfd42328aaf73d2b4f963f40bfeb35b8042c489a243b4d` |
| v2，1536×2288，73 帧 | 371206 | `8194c372a25653fe9939de507a8b5b6d5319e9b3a1d02cff1f059202a86b2d15` |

主开发者查看新图集的待机头部、失落、工作、向左移动、挥手、跳跃与十六方向静态联系表：原待机首帧孤立发刺已消失，失落低头/上身姿态更明显；十六方向顺序可辨，跳跃底部保持 188 / 178 / 167 / 178 / 188，挥手与移动帧保留。工作状态的动作变化仍小，保留语义辨识度 warning；移动幅度和跳跃屈膝仍有改善空间。静态联系表不等于已完成人工连续播放验收。

旧 QA 的失败结论只对应 SHA-256 `11177753492b6d8b959fb67d092f591a9ae4a1f0d1e5fb7cc4d0f74ff0b92e0d`。该原始输入已按哈希恢复到 `artifacts/smoke/baseline-01/atlas-v2.png`，恢复记录 `reconstruction.json` 显示精确匹配。后续不能用已更新的旧根目录同名文件代替它。

独立渲染实测 v1 约 4.26 秒、v2 约 4.74 秒；这些是本机该次运行数据，不是跨硬件性能承诺。每个样本仅一次最终绘制，避免物理预热时重复 GPU 绘制。

## 未完成与恢复入口

1. 等待 DeepSeek 完成 D8–D10 并停止编辑、交付 `docs/ANIMATION_FIXES_02.md`。收到后核对最终差异，再单独提交其交付文件并完成阶段检查点；本轮仅提交 Codex 部分。
2. 第二个来源不同的真实 VRM 1.0 尚未取得和验证。AvatarSample_A 获取/转换步骤见 `docs/MODEL_VALIDATION_02.md`，不能将资料确认视为加载/导出通过。
3. ChatGPT 官方预检、上传、安装及目标应用播放均未执行。界面与报告始终显示这些状态为未执行，本地通过不代表双端已获正式验收。
4. 连续播放下九种状态语义、工作动作辨识度、更多真实角色、长时间运行与多显示器/DPI 等仍需后续验收。
5. GPT 对话、语音、聊天记录及任务状态同步尚未实现；本阶段不展开。
