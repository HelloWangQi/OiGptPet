# 阶段五第一轮：Codex 检查点

2026-11-02，基线 6224437，版本仍为 0.4.0。此记录是 C5 开发检查点，不表示整个阶段五完成。

## 已完成

- 新增 window-recovery.cjs，统一启动位置计算、屏幕增加/移除/指标变化、系统 resume 后的窗口恢复，以及大小调整与手动找回路径。
- 恢复使用执行时真实窗口位置，工作区与窗口均使用 DIP，不手动乘 scaleFactor；只在坐标或大小变化时 setBounds，自动恢复不显示/聚焦隐藏桌宠。
- 屏幕事件防抖、恢复延迟检查、销毁窗口忽略、退出监听器/计时器清理均有回归。
- 阶段五范围及 DeepSeek D23–D24 文件所有权、接口和停工点已经写入文档，尚未收到其本轮交付。

## 验证

| 检查 | 结果 |
| --- | --- |
| npm test | 15 个文件，208 项通过，含 8 项新增恢复回归 |
| npm run build | TypeScript 与生产 Vite 构建通过 |
| node --check | main.cjs、window-recovery.cjs 通过 |
| node scripts/window-recovery-smoke.mjs | artifacts/window-recovery/run-1793584844276/result.json 通过；真实 BrowserWindow、独立空 profile、生产构建、注入工作区及移除/指标/resume 事件，验证隐藏、调整大小、找回。pageErrors 为空 |

首次测试启动因沙箱 spawn EPERM 失败，获得沙箱外执行授权后运行成功。首轮单元测试有一项将合法 y=0 误写为默认坐标，修正断言后全量通过。首次原生 smoke 使用窗口标题定位，页面加载修改标题后定位失败；改为等待 mode=pet 页面并用 URL 识别后通过，失败记录仍保留在本地 artifacts/window-recovery/run-1793584771677/。没有通过放宽产品行为断言掩盖失败。

## 尚未完成

旧位置写入仍由 main.cjs 防抖 writeFile 完成，快速退出可能丢最后一次移动。D23 将实现可 flush 的串行原子存储，Codex 收到交付后接线并验证快速退出/重启。不要把此问题视为已经修复。

真实显示器拔插、100%/150%/200% DPI、真实休眠/恢复、一小时 soak、能耗、最终新版 EXE 均未验收。本轮注入测试不等于硬件测试；未改包版本、未创建 Release。本轮先保存本地开发检查点，待双方对齐再整理共同阶段提交与推送。
