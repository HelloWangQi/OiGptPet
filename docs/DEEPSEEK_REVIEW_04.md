# 阶段四 D22 集成边界只读复核

2026-10-23，工作区 `E:\GitWorkSpace\OiGptPet`，分支 `codex/desktop-prototype`。本次只读检查新容器入口、桌面保存 IPC、候选加载/存储失败/取消/关闭、跨窗口旧结果和重复恢复。没有修改 `src/**`、`electron/**`、`packages/character-library/**`、既有测试、根配置或依赖。

## 结论

发现 **1 个可复现、影响本阶段的非阻断数据一致性缺陷**：恢复流程先完成 `library.add` 的独立事务，再调用 `library.activate`；如果激活失败，或取消落在“add 已提交、add promise 尚未返回”的窄窗口，库内会留下一条未激活条目。当前角色、active 指针和可见画面仍保持原角色，因此不是阻断缺陷，但违反阶段验收中的“无半条写入”，应修复或由 Codex 明确接受。

容器入口与桌面保存 IPC 未发现可确认的阻断缺陷。D21 的真实浏览器备份/恢复、重复别名保留、错误文件回退、导出门控、20 次切换和刷新持久化均通过；D21 的 `pageErrors` 与 `consoleErrors` 为空。

## 缺陷 1：恢复入库成功后激活失败/取消会留下未激活条目

### 位置

- `src/main.ts:339`：`summary = await library.add(...)` 在独立事务中提交新角色及原始字节。
- `src/main.ts:340`：add 返回后才检查取消。
- `src/main.ts:341-344`：设置 `committing` 后调用 `library.activate(summary.id)`；激活是另一次独立调用。
- `src/main.ts:344-345`：只有 activate 成功后才 `prepared.commit()`。
- `src/main.ts:353-356`：catch 只把状态设为失败；`finally` 只刷新库和释放候选，没有删除已加入的条目。
- `packages/character-library/index.ts:34-42` 与 `:49-82`：`add` 和 `activate` 是两个公开调用；`add` 内部先 `prepareCharacter`，再 `store.add`。
- `packages/character-library/store.ts:166-211`：add 使用 `[characters, assets]` readwrite 事务；`store.ts:238-266`：activate 使用 `[characters, assets, meta]` 另一次 readwrite 事务。激活事务失败只会中止自己，不会撤销已经提交的 add。
- `packages/character-library/store.ts:495-501` 与 `:517-523`：如果 abort 发生在 add 事务已经完成后，`tx.abort()` 抛错，已提交写入保留；`tx.oncomplete` 仍会以成功值解析 add。因此取消可以发生在 add 已提交之后。
- `src/main.ts:201-213`：取消按钮中止 package controller；它不能回滚已经提交的 library.add。

### 复现 1：激活失败（确定性故障注入）

1. 用隔离的临时 Electron profile 加载真实 `src/main.ts`，导入 `public/models/demo.vrm`，等它成为当前角色和 active；库内 1 条。
2. 准备一个合法的 v1 PNG `.oipet`（payload `atlas-v1.png`，清单名“半写探测”，容器 SHA-256 `4714732a5407a925d0d5e0a858c0050fea2f4453c4c4324efa30192b9fdf32a7`）。
3. 在页面 DevTools 中把 `IDBObjectStore.prototype.put` 对 `meta` store 替换为抛出 `QuotaExceededError`，模拟 active 指针写入失败；其余 store 的写入保持真实。
4. 通过 `#package-file` 选择该 `.oipet`，等待 `body[data-package-busy]` 结束。
5. 观察状态和 IndexedDB。

实际结果：

- `#package-status`：`恢复未完成，原角色保持不变。`，`error` 为 `true`。
- 当前角色和 active：仍为 VRM `vrm:12c2b97e...`；可见画面仍是 VRM。
- 库：`characters` 2 条、`assets` 2 条、列表 2 行，新增 `sprite:v1:05ac930c...` “半写探测”，原始字节已写入。

期望：恢复失败后库仍为 1 条，或在激活/提交失败时回滚本次新增条目；不得留下未激活的半条记录。

证据：`artifacts/web-package/half-write/result.json`、`half-write.png`、`half-write-sprite.oipet`。该次 `errors = []`，没有脚本错误，只有注入的存储失败。

### 复现 2：取消落在 add 完成后的窄窗口

1. 同样的干净临时 profile，导入 demo VRM 并激活；库内 1 条。
2. 在页面中把 `IDBTransaction.prototype.oncomplete` 的 setter 包装为延迟 2 秒执行，并在 `assets.add` 的 `complete` 事件上记录提交时刻；这只放大真实存在的“事务已提交、promise 尚未返回”窗口。
3. 通过 `#package-file` 恢复一个合法的 v2 PNG `.oipet`（清单名“取消半写探测”，容器 SHA-256 `0becceee8f88ac5d609abea8dc0cfb7488b45ab1a3e74ded033b6c8be8b8153e`）。
4. 在记录到 add 事务 `complete` 后、2 秒延迟结束前点击 `#cancel-package`。
5. 等待状态和 `body[data-package-busy]` 结束，观察 IndexedDB。

实际结果：

- 点击后状态：`已请求取消，正在结束当前操作。`
- 最终状态：`恢复已取消，原角色保持不变。`，`error` 为 `false`。
- 当前角色和 active：仍为 VRM；可见画面仍是 VRM。
- 库：`characters` 2 条、`assets` 2 条、列表 2 行，新增 `sprite:v2:84604125...` “取消半写探测”，原始字节已写入。

期望：取消后不新增条目；库仍为 1 条。

证据：`artifacts/web-package/half-write/cancel-result.json`、`cancel-half-write.png`、`cancel-half-write-sprite.oipet`。该次 `errors = []`。

### 影响

- 失败或取消的恢复会在角色库留下用户没有成功恢复的条目；刷新/重启后仍可见，但不会被激活。
- 每次留下一个原始 payload，计入角色库 12 条 / 256 MiB 限额；重复失败可能挤占条目或字节配额。用户需要手动“移除”清理。
- 当前画面、active 和源 VRM 导出不受影响；不会把旧角色替换成错误内容，因此按非阻断记录。
- 该路径与阶段验收“库写入/激活失败、取消、关闭后无半条写入”直接相关；应在阶段收尾前处理，至少要在交付说明中明确接受。

### 修复方向（交 Codex）

- 在 add 成功后，只有 activate 和 commit 都成功才算本次恢复完成；activate/commit 失败或 add 后收到取消时，删除本次确实新增的 ID 及字节，再刷新库。
- 必须区分“本次新增”和“已存在的重复条目”：`store.add` 的重复路径（`store.ts:176-188`）返回既有 summary 并保留别名，回滚不能误删既有角色。
- 可让 library 返回 `created` 标记，或提供原子的 add+activate/回滚接口；仅修改 smoke 断言或把状态改成成功都不能修复数据问题。

## 已复核且未发现可确认缺陷的边界

### 新容器入口

- `packages/character-package/index.ts` 的 encode/decode 严格检查 magic、清单长度、字段集合/类型/版本/名称/profile/MIME、safe integer、kind 上限、总大小、截断/尾随和两层摘要；解码入口不创建持久化记录或资源。
- `npx vitest run tests/character-package.test.ts` 为 21/21；D20 smoke 的 4 个真实输入（VRM、v1/v2 PNG、生成 WebP）encode→decode→IndexedDB add 字节一致，`errors` 为空；见 `artifacts/character-package/run-01/result.json`。
- 未确认容器层存在可复现的阻断缺陷。

### 桌面保存 IPC

- `electron/character-package-save.cjs:7-15` 校验 operation ID、大小、magic、manifest 长度和整包摘要；`:27-51` 使用 `wx` 临时文件、写入后再 rename，只有 rename 前未取消才提交；`:21-25` 与 `:33` 处理取消/owner 关闭，提交标记避免把已 rename 的结果误报为取消。
- `electron/main.cjs:109-110` 用 trusted sender 接入 save/cancel；`character-package-save.cjs:43-47` 的 committing 保护使取消不能声称撤销已经开始的 rename。
- 未确认过期对话框结果能写入另一角色、取消会留下临时文件、或关闭窗口后仍向旧 renderer 交付结果的路径。Codex 的 `scripts/phase-four-smoke.mjs` 已覆盖原生保存失败、延迟对话框取消和窗口关闭，本次未重跑。

### 候选加载、失败、取消和关闭

- `src/companion-stage.ts:30-86` 在克隆画布上准备候选；`commit()` 只在调用方完成库操作后替换当前画布；加载失败/取消会释放候选，旧画面保持。
- `src/main.ts:317-364` 的顺序是候选准备 → 入库 → 取消检查 → committing → 激活 → 提交画面；D21 的截断/错误文件/错误源类型恢复都保留了当前画面和条目集合。唯一已确认问题是本报告缺陷 1 的入库/激活非原子性。
- `src/main.ts:654-657` 的卸载处理中止 package/load、取消 native save、关闭库和渲染器；未确认存在取消后仍替换画面的路径。

### 跨窗口旧结果

- 库变更通过 `BroadcastChannel('oigptpet-library-changed')`（`src/main.ts:118`、`:315`）通知其他窗口；`syncLibrary`（`:389-397`）在 package job 期间只记录 `syncRequested` 并请求取消当前操作，不把旧 active 直接提交到画面。
- `model:changed` 仅在 `electron/main.cjs:112-120` 的 `model:set` 中发出；`preload.cjs:5` 暴露 `setModel`，但唯一调用者是 `src/model-store.ts:27` 的 `saveModel`，而 `saveModel` 在当前主程序中无调用者（`src/main.ts` 只导入 `getSavedModel`）。启动时的旧模型迁移发生在 `src/main.ts:571-575`，早于 `:582-583` 的通知监听器注册。因此本次未找到可由正常用户操作触发的 `model:changed` 陈旧结果路径。
- 未在本次复核中重跑双窗口桌面切换；桌面 20 次切换/重启由 Codex 的 phase-four smoke 覆盖。

### 重复恢复

- `store.ts:176-188` 对相同 ID 返回既有 summary（保留库内名称/createdAt），`library.activate` 在 `index.ts:49-82` 重新读取字节、核对 summary 摘要/大小后才写入 active。
- D21 的 profile A/B 都验证了重复恢复不增加条目、保留别名、active 正确；未确认重复恢复会覆盖别名或重复写资产。

## 复核边界

Codex 收尾补充：缺陷 1 已改为 `library.addAndActivate` 原子事务，角色摘要、Blob 和 active 同时提交或回滚，不以事后删除方式清理，因而不会误删既有重复条目。UI 在写入开始前锁定取消，消除 add 已完成而 active 尚未写入的窗口。新增三项单测验证激活失败回滚、重复别名保留和校验后取消，全量 200 项通过；实际包复验结果见 `CHECKPOINT_04.md`。上文保留修复前复现证据。

- 本报告只记录可复现且影响本阶段的代码问题；未把未执行的外部 Chrome/Edge、真实 LAN/手机、打包 Windows 包、完整重启、一小时 soak 或 DPI/能耗验收写成代码缺陷。
- D22 未修改主程序文件；缺陷 1 的复现使用隔离临时 profile 的运行时故障注入/延迟，测试脚本与截图只放在忽略目录 `artifacts/web-package/`。
- 未提交、未推送，未上传角色；阶段收尾、修复和打包由 Codex 负责。
