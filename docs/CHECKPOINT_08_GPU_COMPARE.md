# 0.8.2 检查点：默认图形后端与软件配置对照

2026-11-03。用户要求本轮在 13:20 左右结束，并收紧额度使用。只补充图形后端证据与一次同负载长测，没有改变产品渲染设置、增加其他功能或推送/发布。

## 交付和条件

- 测试工具提交：`862facae6da54113a8dc3795263470c84c35ee3c`，正式运行启动时工作区干净。
- 新增 `--renderer software|default`；缺省仍显式 SwiftShader，default 不强制后端。实际 WebGL renderer/vendor、Electron GPU feature 状态和 basic GPU 信息写入 conditions.json，不能仅凭参数名判断硬件加速。
- 默认模式产物另存到 `artifacts/chat-soak-default/`，不覆盖已有软件配置基线。
- 337 项单元测试通过；`npm run verify:desktop` 完整通过。新 EXE：`release/v0.8.2-1793678315344/OiGptPet-win32-x64/OiGptPet.exe`；基础验收：`artifacts/release-smoke/run-1793678324570/result.json`。
- 默认模式短预检：`artifacts/chat-soak-default/run-1793678200982/result.json`，仅用于工具预检，不计满小时。

本机临时 WebGL2 探针报告：`ANGLE (Intel, Intel(R) UHD Graphics 630 (0x00009BC8) Direct3D11 vs_5_0 ps_5_0, D3D11)`；gpu_compositing、webgl 等 feature 为 enabled。探针上下文显式释放，资源计数差保持不变。basic GPU 信息仅辅助记录，不用其中的设备列表或 active 标志替代实际 WebGL renderer 证据；本记录不是显存或功耗测量。

## 默认后端正式运行

命令 `npm run test:chat-soak-default`；结果 `artifacts/chat-soak-default/run-1793678490100/result.json`。

- 300 秒预热后观察 **3600.04 秒**，总时长 3900.04 秒，completeHour=true。
- **32 个完整循环、185 次模拟请求、65 个切换时刻、33 次隐藏恢复**。截止前最后一轮只完成 VRM 阶段，不冒充完整第 33 轮。
- **261 次定时采样**、sampleSkipped=0，最大间隔 15.07 秒；最大切换调度延迟 0.10 秒以内，无切换时刻跳过。
- 工坊 PID 55412、桌宠 PID 51036 固定；全程仅一个 GPU 进程身份，未发现进程重启。
- 气泡/改名同步、取消/清空/重试、历史滚动、迟到响应释放、隐藏绘制停止/显示恢复、当前资源计数断言通过；errors=[]。
- 退出重启后配置保留、会话清空、无自动请求。
- rawMemoryNeedsReview=false，memoryNeedsReview=false；没有强制 GC 或修改门槛。

额外脚本验证计时、采样覆盖、固定窗口/PID、稳定样本资源、统计重算、运行时代码和测试脚本摘要，verification.json 已保存。与软件基线逐一检查运行时代码 SHA-256，以及 minutes / warmup / switch / sample / settle / mixed / fixed 参数，均一致；comparison.json 保存对照原始汇总。

## 预热后稳定样本对照

软件配置基线：`artifacts/chat-soak/run-1793671897524/`，源码 2526a24；默认配置：上述正式运行，源码 862faca。均为同一宿主上的 0.8.2 运行时代码，300 秒预热后观察完整一小时、固定窗口、每 60 秒切换/15 秒采样、同样的模拟对话与资源检查。

| 进程 / 负载 | 软件配置净变 MiB | 软件配置斜率 MiB/min | 默认后端净变 MiB | 默认后端斜率 MiB/min |
| --- | ---: | ---: | ---: | ---: |
| GPU / 精灵图 | +87.57 | +2.32 | -0.89 | +0.21 |
| GPU / VRM | +51.93 | +1.70 | -23.86 | +0.22 |
| 工坊 / 精灵图 | +15.41 | +0.68 | +25.05 | +0.42 |
| 工坊 / VRM | +14.21 | +0.37 | +20.03 | +0.36 |
| 桌宠 / 精灵图 | -50.24 | +0.29 | +5.10 | +0.08 |
| 桌宠 / VRM | +2.77 | +0.09 | +2.89 | +0.04 |

以上为 GPU/renderer **进程 privateBytes** 的趋势，不是 VRAM。两组常驻基线不同，不直接相减比较占用；各自的首末差与全序列回归斜率也不是同一统计量。默认配置预热后 stable 样本为精灵图 90、VRM 91；软件基线分别为 118、94。两组总样本相同，但切换时序导致 transition 排除数量不同，原始数据全部保留。

## 结论和边界

本次默认 Intel/D3D11 配置未复现软件基线的原始 GPU 增长提示；软件基线 rawMemoryNeedsReview=true 的记录保持不变。这个结果支持将观察按后端区分，不支持把所有 GPU 增长归因为一个原因、宣称泄漏已完全解决或以修改生产设置掩盖提示。

这是同一宿主顺序运行的单次对照，不是随机化重复实验。旧软件配置没有保存 unmasked-renderer 探针，只能从当时提交的显式 SwiftShader 启动参数确认其请求配置。新探针为临时上下文的后端证据；没有逐帧证明所有渲染上下文的设备选择。更多设备/驱动或更长运行仍需观察，不能据此推广到所有电脑。

真实账户 API、多屏/DPI/休眠、硬件能耗、逐帧性能目标及 ChatGPT 官方宠物安装仍未验收。所有服务请求使用合成配置和模拟网络，模型、用户数据和测试产物均不进入公开包。
