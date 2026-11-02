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

## 用户实测修正：鼠标左右跟随

2026-11-02 用户报告扭头左右与鼠标相反。鼠标映射原先对横坐标取负，现改为屏幕右侧对应正 yaw，与 sampleLook 的顺时针方向约定一致；同时修正 VRM 眼睛目标 X 的相反符号，使头部和眼睛朝同侧。精灵图帧方向索引不变，既有图集像素不重写；眼睛目标修正也适用于此后新导出的视线帧，旧导出报告不能替代新文件的检查。

新增 pointer-look 回归通过真实 VrmStage 姿态方法及 Three.js 旋转验证左右、上下与居中，并核对 sampleLook 的左右方向一致。npm test：18 文件、234 项通过；TypeScript 检查通过。按用户约定，交给用户验证前重新执行 npm run verify:desktop，实际包结果以本机 release/latest.json 与 artifacts/release-smoke 最新成功记录为准。生产 EXE 基础检查不代替用户对具体角色转头观感的确认。

## 用户实测改进：直接拖动宠物身体

2026-11-02。新增按住可见身体拖动，VRM 使用现有射线命中、精灵图使用当前帧 alpha 命中；透明空白和底部按钮不作为身体拖动入口，顶部原生手柄保留。4 DIP 起拖阈值保留轻点挥手，拖动后抑制误触点击；捕获指针，松手/取消/失焦/隐藏/关闭/退出结束拖动。

主进程用全局 DIP 光标差值移动窗口，不根据移动中的 client 坐标累加位移；拖动期间不启用穿透，结束后恢复既有命中判断。新 start/end IPC 只允许桌宠窗口发起，不接受渲染进程提供的任意位置。结束时继续使用原位置保存和工作区恢复逻辑。

验证：npm test 19 文件、240 项通过；TypeScript 通过。npm run verify:desktop 成功，包为 release/v0.4.0-1793588105894/OiGptPet-win32-x64/，对应 artifacts/release-smoke/run-1793588119953/result.json。实际包使用精灵图身体像素发起 PointerEvent，注入主进程全局光标坐标（Playwright 不移动 Windows 硬件光标），检查位移、松手停止、拖后无点击、轻点仍有效、按钮不拖动、工坊调用被拒绝，以及原有导入/角色库/设置/重启回归。注入光标不是人工鼠标或真实混合 DPI 验收；VRM 命中和常用角色手感由用户继续实测。

本轮包仍显示 0.4.0，未发布 Release；本地只保留最近 3 个 EXE 包。

## 长时稳定性工具及未通过记录

2026-11-02。本轮新增实际 EXE 稳定性运行器、资源探针和内存趋势计算，说明见 DESKTOP_SOAK.md。npm test：20 文件、248 项通过；重新 npm run verify:desktop 通过，测试包 release/v0.4.0-1793588930488/OiGptPet-win32-x64/，包检查 artifacts/release-smoke/run-1793588938772/。未改产品版本或发布。

- 短预检 artifacts/desktop-soak/run-1793589016345/result.json：60.49 秒、11 次选择、13 份采样、2 轮拖动/隐藏检查成功；completeHour=false。初始化内存增长触发复核提示，不能据此判断泄漏。
- 正式一小时尝试 artifacts/desktop-soak/run-1793589190638/failure.json：在 1269.60 秒（21 分 9.6 秒）失败，完成 13 次选择、40 份采样、3 轮拖动/隐藏检查；失败是 page.waitForFunction 等待角色 ID 同步超时 60 秒。最后已记录资源计数符合当前 VRM，pageerror 列表为空，但不代表此次切换成功。尚未定位产品问题或测试问题，不算一小时通过。
- 运行器将同步状态等待改成 polling:100，避免依赖后台 RAF，并新增失败时两窗口状态、可见性、探针和截图；保留原失败，未修改产品切换逻辑或放宽 60 秒超时。
- 后续短复验 artifacts/desktop-soak/run-1793590555965/failure.json 又在身体拖动起始等待处超时，不能把轮询调整标为解决。该次新增现场状态和截图已保存，下一轮从这两份复现排查。

PowerShell 此环境下 npm 转发自定义参数被吞掉，短测请直接运行 Node；默认 npm run test:soak 可运行一小时。长测及短复验均已结束并关闭自己的 Electron，没有留下后台测试任务。用户日常配置未使用。

短窗口剩余额度已接近 25% 保留线，本轮保存工具和失败证据，停止新增范围，继续至少保留 20%。阶段五仍未完成：切换/拖动等待异常待定位，完整一小时、真实多屏/DPI/休眠、硬件耗电均未通过或未测。接续入口见 NEXT_SESSION.md。
