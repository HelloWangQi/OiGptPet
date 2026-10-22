# 阶段 02：预览、动画修复与发布包集成检查点

日期：2026-10-22。版本 `0.2.0`，分支 `codex/desktop-prototype`，基线提交 `7ea0cbc`。

主程序部分已先提交为 `bdfc7a2`。用户确认 DeepSeek 已完成并授权检查、提交剩余代码；本次纳入独立预览组件、播放修复、动画修复、测试与交付文档，完成双方代码的集成。源码提交不包含本地模型、图集、账号信息或发布包，也不推送远端。按用户要求在阶段检查点提交后暂停。

最终复核补了三项取消回归：启动前已取消、最后一格完成后取消、PNG 编码期间取消。导出器在分配资源前与编码前后检查 signal，已取消的导出统一拒绝为 AbortError；分配过的资源仍由 finally 释放。`npm test` 排除 `.cache`，避免把先前暂存区快照的测试重复计数。

## 本轮交付

- 局域网工坊：Vite 开发与预览监听 `0.0.0.0:5173`；浏览器支持本地导入、角色预览与图集导出。悬浮桌宠使用 Electron。
- 实际 PNG 检查与逐帧预览：从最终 Blob 解码、检查和计算 SHA-256，提供九种状态及 v2 十六方向控件。结构错误定位行/帧，并禁止 PNG 保存，诊断报告仍可保存。
- 导出生命周期：取消、更换角色、关闭弹窗和重新导出会清除旧结果，释放预览，忽略过期异步回调。
- 文件一致性：保存检查过的同一个 Blob；JSON 报告记录规格、精确字节数、哈希、模型元数据与检查结果。Electron 主进程保存 PNG 前再次核对哈希。
- 发布边界：普通生产构建排除 `public` 模型；`build:demo` 单独输出至 `.cache/demo-dist/`。打包使用文件白名单检查，默认不含源模型、下载元数据和用户产物；提供导入空状态。
- DeepSeek 已交付预览组件、局域网 HTTP 的 SHA-256 回退、播放数值边界修复及动画修复代码。动画修复通过最终归一化后初始化 Spring Bone、固定步长稳定物理和每帧一次绘制，修复首帧孤立发刺；失落改为低头掩面，工作改为托腮思考。完整原始证据见 `docs/ANIMATION_FIXES_02.md`。

## 本机验证

| 命令/检查 | 结果与证据 |
| --- | --- |
| `npm test` | 7 个文件、85 项通过，包含导出会话、预览、分发、动画与最终取消边界回归；不扫描缓存快照 |
| `npm run build:demo` | 类型检查和示例构建通过 |
| `npm run build` | 类型检查和生产构建通过 |
| `npm run test:smoke` | 最新代码 v1/v2 预览、原生 PNG/报告保存、哈希不符拒绝、污染格保存门控、取消重开、透明置顶桌宠通过，无渲染错误 |
| `node scripts/atlas-preview-smoke.mjs` | 已有组件实测通过：有效 PNG/WebP、损坏/超限/错误规格、并发/取消、控件、资源释放和真实非安全局域网 HTTP 摘要回退；结果见 `artifacts/atlas-preview-smoke/result.json` |
| `node scripts/animation-render-smoke.mjs --model public/models/demo.vrm --out-dir artifacts/animation-fixes/run-04` | DeepSeek 最终独立结果 `ok: true`；v1/v2 结构通过，与 run-03 哈希一致，取消产生 AbortError，4 个 WebGL 上下文均释放；最终主程序导出哈希与之相同 |
| `node scripts/atlas-visual-qa.mjs --file artifacts/animation-fixes/run-04/atlas-v2.png --profile v2 --out-dir artifacts/animation-fixes/run-04/qa-v2` | 最终输入结构通过，联系表和基线图已生成；静态目视范围与连续播放验收分开记录 |
| `node scripts/package.mjs` | 新 Windows x64 免安装包生成成功，打包前后分发白名单检查通过 |
| `npm run test:release` | 实际启动上述最新包，确认 `app.isPackaged` 为 true、无默认模型、可本地导入且重启恢复，无渲染错误；证据见 `artifacts/release-smoke/result.json` |
| 第二模型 AvatarSample_B | 真实 v1/v2 导出和结构检查、重复哈希、取消及资源清理通过，完整图集与主要静态联系表已查看；证据见 `artifacts/animation-fixes/avatar-b-checkpoint-02/manifest.json` 和 `docs/MODEL_VALIDATION_02.md` |

最新主冒烟证据：`artifacts/smoke/phase-02/run-1792661855919/result.json`，也可从 `artifacts/smoke/latest.json` 查找。所有产物与模型均被 Git 忽略，不纳入源码提交。

当前包：`release/v0.2.0-1792661947969/OiGptPet-win32-x64/OiGptPet.exe`。`release/latest.json` 指向最新成功生成目录，旧包保留。该包使用最终集成代码，仍属开发验收包。

## 精确图集与视觉范围

输入为官方 `VRM1_Constraint_Twist_Sample.vrm`，SHA-256：

`12c2b97e95e700783a6a550dc0eee2d7880aeedccef9ae67bc4c5a2f0f2631a2`

| 最终输出 | 字节数 | SHA-256 |
| --- | ---: | --- |
| v1，1536×1872，57 帧 | 293190 | `05ac930c71c9a8f5308c2fc4c5aedcffaec99b865cbdc5a36b1c4ade1156e8f6` |
| v2，1536×2288，73 帧 | 370954 | `84604125009381796d748388ab5b934dd9faac581b8cd8a00fd4417b4b3acada` |

主开发者查看 run-04 的最终待机头部、失落与工作静态联系表：首帧没有孤立发刺，失落有低头与双手掩面线索，工作有托腮轮廓，两者与待机可区分。十六方向、挥手与跳跃证据见交付报告，跳跃底部保持 188 / 178 / 167 / 178 / 188。移动幅度、跳跃屈膝、waiting/review 幅度及细分视线仍有改善空间。静态联系表与自动化控件检查不等于已完成人工连续播放验收。

旧 QA 的失败结论只对应 SHA-256 `11177753492b6d8b959fb67d092f591a9ae4a1f0d1e5fb7cc4d0f74ff0b92e0d`。该原始输入已按哈希恢复到 `artifacts/smoke/baseline-01/atlas-v2.png`，恢复记录 `reconstruction.json` 显示精确匹配。后续不能用已更新的旧根目录同名文件代替它。

run-04 独立渲染实测 v1 约 6.27 秒、v2 约 4.84 秒；这些是本机该次运行数据，不是跨硬件性能承诺。每个样本仅一次最终绘制，避免物理预热时重复 GPU 绘制。

## 未完成与恢复入口

1. DeepSeek D8–D10 已交付并完成集成复核；剩余视觉 warning 作为后续调优项，不在本阶段继续扩展。
2. AvatarSample_B 已作为第二真实模型完成加载、v1/v2 导出、结构检查与静态查看；手臂姿态语义弱于首模，保留适配 warning。Vita、Seed-san 和两份熊少女只做了文件检查，详见 `docs/MODEL_VALIDATION_02.md`。Fred 由用户明确排除，Shiro 未下载；所有源模型均不提交。
3. ChatGPT 官方预检、上传、安装及目标应用播放均未执行。界面与报告始终显示这些状态为未执行，本地通过不代表双端已获正式验收。
4. 连续播放下九种状态语义、工作动作辨识度、更多真实角色、长时间运行与多显示器/DPI 等仍需后续验收。
5. GPT 对话、语音、聊天记录及任务状态同步尚未实现；本阶段不展开。
