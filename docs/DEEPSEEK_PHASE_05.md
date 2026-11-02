# DeepSeek 阶段五任务：D23–D24

共享目录 E:\GitWorkSpace\OiGptPet，分支 codex/desktop-prototype。先读取 PHASE_05.md。只做下述工作，完成后停止编辑、不提交、不推送。Codex 正在修改 main.cjs、window-recovery.cjs、window-recovery.test.js 和原生恢复 smoke，请勿修改这些文件、根配置和依赖。

## D23：窗口位置保存

独占文件：electron/window-state.cjs、tests/window-state-store.test.js、docs/WINDOW_STATE.md。当前 main.cjs 的 300ms 防抖直接 writeFile，before-quit 清除计时器会丢掉尚未落盘的位置；本轮由你实现独立存储模块，Codex 接线，避免竞争编辑。

请导出 createWindowStateStore(file, options?)，返回以下接口；构造不访问文件。

- load(): Promise<bounds | null>：仅接受 x/y/width/height 有限数且宽高为正的对象，复制四个字段；缺失、坏 JSON、非法结构返回 null，不覆盖原文件。真实读取失败应抛出。
- schedule(bounds): void：校验并立即复制四字段，300ms 防抖；调用者之后修改输入不能影响保存。失效参数不排入写入。后台错误须可通过 options.onError(error) 观察，不能形成未处理 rejection。
- flush(): Promise<void>：清除防抖，串行保存最近排入的位置，并等待本次调用前已排队的写入；退出时可 await，不丢最后一次移动。
- 写入同目录临时文件再 rename；并发 flush/schedule 不交错破坏数据，旧写入不覆盖新写入；失败后可再调 schedule/flush 重试，不破坏之前已成功保存的文件。不得因 load 把过期数据写回。

仅使用 Node 内置模块。测试使用独立 .cache/window-state-tests 目录；测试清理须确认绝对路径在该目录内。覆盖真实写入/重开读取、防抖、输入变更、快速 flush、并发顺序、读写失败与重试及错误回调。可以注入文件操作用于确定性的失败/阻塞测试，不必修改主进程。

## D24：只读复核与人工矩阵

独占 docs/DEEPSEEK_REVIEW_05.md、docs/DEEPSEEK_DELIVERY_05.md。复核 Codex 窗口恢复是否使用 DIP、当前实时位置，是否保持隐藏状态，以及跨屏选择、恢复计时器/监听器清理边界。发现缺陷提供复现，先不改 Codex 文件。

制定人工多屏/DPI/休眠检查表。没有真实执行就标未测；不执行真实休眠/切换系统显示设置。不要运行主 Electron smoke、打包或一小时测试，避免共享环境竞争。交付说明写命令、结果、未测内容和模块接口；两项完成后停下等待共同对齐。
