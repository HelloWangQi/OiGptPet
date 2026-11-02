# 窗口位置存储与退出

2026-11-02，阶段五。原 D23 由 Codex 接手并完成，未由 DeepSeek 执行。

electron/window-state.cjs 导出 createWindowStateStore(file, { io?, onError? }?)。构造不访问磁盘，生产使用 Node fs/promises；io 只用于可控失败/阻塞测试。

- load()：等待已排队写入后读取四字段 x/y/width/height。拒绝数组、缺字段、非有限数和非正尺寸；坏 JSON/缺失返回 null，不覆盖文件。其他读取错误抛出。不会把读到的记录排入写入，也不会主动 flush 尚在防抖的移动。
- schedule(bounds)：立即校验并复制四字段，丢弃额外字段；非法输入抛 TypeError，不改变待保存值。300ms 防抖合并移动，后台失败交给 onError。错误回调抛出也不会形成未处理 rejection。
- flush()：取消防抖，把调用时最近一次有效位置排入串行队列，等待其保存。已成功的版本不重复写入；失败版本保留，可再次 flush 重试。调用后发生的新 schedule 仍由后续计时器/flush 保存。

写入使用同目录 UUID 临时文件及 wx 独占创建，写完后 rename 替换目标；各次写入串行，失败不破坏上次成功记录，尝试清理自身临时文件。清理失败不隐藏原写入错误，后续使用新的 UUID，不复用残留文件。原子替换不等同于断电后的 fsync 持久性保证，也不支持多个进程同时写同一文件；应用已有单实例锁。

main.cjs 在移动、缩放、窗口关闭和初次打开后更新内存位置。正常 before-quit 先采集实际位置，停止恢复事件、冻结新移动写入并等待 flush；重复退出请求合并，完成后再次 app.quit 放行。失败记录到主进程日志，保留旧位置并退出，不伪报最后位置已保存，也不无限阻止用户退出。读失败同样报告后使用默认恢复位置。

本轮保证正常退出路径，不承诺任务管理器强制结束、崩溃、断电或系统直接终止进程时保存最后一次移动。Windows 会话关闭不一定走普通 before-quit，需另行实测。

## 检查

单元测试：tests/window-state-store.test.js，覆盖缺失/损坏/非法输入、复制与真实重读、防抖、并发顺序、原子替换失败、重试、后台错误通知和读取错误。

原生验证：node scripts/window-state-smoke.mjs，使用生产 renderer、独立数据目录，实际移动 BrowserWindow 后在同一主进程轮次调用 app.quit，延迟 rename 验证退出等待；重启验证位置，随后注入 rename 失败，核对旧文件、错误日志和临时文件清理，再次启动核对恢复。注入测试不代表物理显示器或 Windows 系统会话验收。
