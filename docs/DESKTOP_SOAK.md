# 桌面长时稳定性检查

2026-11-02。使用当前编译的 Windows EXE、隔离用户目录，保留生产 renderer，不访问日常角色库。运行前执行 `npm run verify:desktop`，本地仍只保留最近 3 个包；长测期间不要再次打包或清理正在运行的测试包。

## 命令

```powershell
# 先做短时工具预检；PowerShell 下直接调用 Node 保留参数
node scripts/desktop-soak.mjs --minutes 1 --switch-seconds 3 --sample-seconds 5

# 默认一小时，每次切换后至少等待 90 秒，每 30 秒采样
npm run test:soak
```

需要本地 `public/models/demo.vrm` 和 `artifacts/animation-fixes/run-04/atlas-v2.png`。原始模型不放进公开源码库。运行时显示测试桌宠，用户可继续对话；请不要操作该测试窗口。Ctrl+C 请求取消，取消写 failure.json，不计成功。强制终止可能只留下最后的 progress.json。

## 覆盖和产物

- 在独立 profile 中准备 VRM 和 v2 精灵图，真实工坊选择、桌宠同步；按间隔交替切换，并记录类型与耗时。一小时结果要求至少 20 次选择，计时从资源就绪后开始，使用 monotonic elapsed time，不压缩时间。
- 每四次选择轮换性能模式，在精灵图身体上触发拖动/轻点，检查按钮、松手，隐藏后检查绘制计数停止，再显示恢复。仅拖动的全局光标通过测试替身注入，不移动 Windows 硬件光标。
- 每次采样记录 app.getAppMetrics 原始 PID、创建时间、CPU 和内存，各窗口 WebGL 上下文创建/显式 loss 调用、图集 bitmap 创建/关闭、绘制调用，以及错误/渲染器崩溃。当前类型之外的渲染资源计数必须归零；窗口正常隐藏时不应继续绘制。
- 默认 SwiftShader 软件渲染，记录 OS、CPU、总内存、显示器/DPI、Electron、包路径、源码提交和包内 main.cjs 摘要。它不是硬件 GPU/耗电测试，也不替代真实多屏、休眠或系统注销验收。
- `artifacts/desktop-soak/run-*/conditions.json` 保存环境；`samples.ndjson` 每次追加采样，`actions.ndjson` 保存选择操作，`progress.json` 保存进度，`result.json` 保存完整成功结果；失败写 `failure.json`。原始资源和日志保持本地忽略。

## 如何解读

`ok=true` 只表示该配置下流程和硬性断言完成；只有完整满 3600 秒的结果才标 `completeHour=true`，短测永远不计一小时验收。

Electron 内存字段单位为 KiB，报告换算 privateBytes 为 MiB。缺失字段保持未知，不当作零。按 PID 与创建时间区分进程，正式一小时趋势排除前 5 分钟初始化，使用线性斜率与首末差；至少五个样本且净增超过 100 MiB、斜率超过 1 MiB/min 时标 `needsReview`。这是复核提示，不是泄漏的自动诊断；短测未排初始化，通常有资源增长，不能与长测等同。

资源计数是应用调用探针，不是实际显存测量。WebGL 多次 draw 不等于多帧，不从 drawCalls 推算 FPS。JS/GPU 的延迟回收、软件渲染和交替角色都会影响内存，应结合原始序列、当前类型及后续同类型采样比较；即使没有趋势警告也不宣称长期绝无泄漏。
