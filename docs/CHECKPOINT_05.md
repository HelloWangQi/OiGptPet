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

## 同日补充：改为独立开发，完成位置持久化接线

用户确认 DeepSeek 不再参与，Codex 接手原 D23–D24。本次基线为首轮检查点 98b3dde，以上“等待 D23”的描述保留为当时记录，已被本节更新。

- 实现 window-state.cjs：校验/复制输入、300ms 防抖、串行 UUID 临时文件原子替换、失败回退与重试、可 await 的 flush。读取缺失/坏记录不覆盖磁盘；真实读取失败报告。
- main.cjs 正常退出前捕获实际位置并等待 flush，期间拒绝重复退出触发新写入，冻结移动保存、释放恢复监听器。保存失败保留旧位置并记录日志后退出，不无限阻止用户关闭。
- 补充 WINDOW_STATE.md 接口和失败边界、WINDOW_STABILITY_QA.md 实机检查矩阵及代码自查。未冒称 DeepSeek 交付或独立复核；不再等待外部协作者。

| 检查 | 实际结果 |
| --- | --- |
| npm test | 16 文件，225 项通过（新增 17 项位置持久化检查） |
| node --check | main.cjs、window-state.cjs 通过 |
| 立即退出/重启及失败回退 | artifacts/window-state/run-1793585372297/result.json 通过；真实 Electron，主进程同轮 move/app.quit，延迟替换验证退出等待，重启恢复；再注入替换失败验证旧文件、错误日志、临时文件清理，再启动恢复；pageErrors 为空 |
| 恢复接线回归 | artifacts/window-recovery/run-1793585391049/result.json 通过 |
| 备份完整回归 | 重建测试 demo 后，artifacts/phase-04/run-1793585531937/result.json 通过；跨 profile、别名/无效内容、故障注入、20 次双窗口切换、资源探针和重启 |
| 构建/分发 | npm run build:demo 通过；此前 C5 生产构建未改变 renderer；node scripts/package.mjs --stage-only 通过生产分发白名单（.cache/package-1793585626802/） |

验证中的失败均保留：新位置 smoke 最初在 Playwright evaluate 环境中使用 require、动态 import 均不受支持；改为 .cache 下独立测试入口暴露主进程 fs 对象进行注入，不新增应用 IPC 或 preload 权限。失败目录为 artifacts/window-state/run-1793585158554/ 与 run-1793585283844/。

第一次备份回归 artifacts/phase-04/run-1793585410047/ 加载了 2026-10-23 的旧 .cache/demo-dist，该目录中没有已提交的 addAndActivate 修复，故原子回退断言失败。核对生产 dist 含该实现后重建 demo，再完整复验通过；将 npm run test:phase-four 改为先 build:demo，防止缓存旧产物再次误导。未修改角色库/恢复实现或放宽其断言。

第一轮软件开发与自动化验收已完成，仍未做真实显示器/DPI/休眠、系统注销/关机、一小时 soak、耗电及新版 EXE。正常 app.quit 不代表强杀/崩溃/断电也能保存。版本仍为 0.4.0，暂不发布 Release；本次保存本地检查点，下一轮从上述实机及长期验证继续。额度检查：短窗口剩余约 88%、周剩余约 42%，继续至少保留 20%。
