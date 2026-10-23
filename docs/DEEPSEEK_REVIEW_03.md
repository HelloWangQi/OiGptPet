# 阶段三 D18 集成边界只读复核

2026-10-23，工作区 `E:\GitWorkSpace\OiGptPet`，分支 `codex/desktop-prototype`。

本次只读检查 `src/companion-stage.ts`、`src/main.ts`、`electron/preferences.cjs` 及相关设置接线。没有修改主程序、测试或配置；以下缺陷与结论交 Codex 处理。

## 结论

发现 1 个可复现、影响本阶段的非阻断布局缺陷：从精灵图切回 VRM 后，画布沿用精灵图阶段的 inline CSS 尺寸，窗口缩放时不再跟随容器。

未发现其他可确认的阻断缺陷。D17 的迁移、改名持久化、WebP 导入、无效输入保护、VRM 导出恢复和 `pageerror` 为空均通过；该布局问题不影响数据、迁移或导出，但会造成预览尺寸与容器不一致。

## 缺陷 1：精灵图切回 VRM 后画布不跟随窗口缩放

### 位置

- `src/companion-stage.ts:34`：`prepare` 用 `this.canvas.cloneNode(false)` 创建候选画布，会连同旧画布的 inline `style` 一起复制。
- `packages/renderer-sprite/index.ts:222-223`：精灵图渲染时写入 `canvas.style.width` 和 `canvas.style.height`。
- `src/companion-stage.ts:64`、`:70`：候选在加载完成和 commit 时调用 `resize`。
- `packages/renderer-vrm/index.ts:80-82`：VRM 的 `resize` 使用 `renderer.setSize(width, height, false)`，只更新渲染 backing，不更新 CSS 尺寸。

因此精灵图 → VRM 切换后，新画布带着精灵图时期的 inline 尺寸；VRM 渲染器不会清除或更新它，之后宿主尺寸变化时画布仍保持旧 CSS 尺寸。

### 触发步骤

1. 在真实主页面加载已迁移的 VRM。
2. 通过 `#model-file` 导入 v2 WebP 精灵图，使画布写入 inline 尺寸。
3. 在角色列表中切回该 VRM。
4. 将 BrowserWindow 内容区从 1280×900 缩放到 980×760，等待 ResizeObserver 生效。

### 期望与实际

- 期望：画布的 `getBoundingClientRect()` 跟随宿主容器，约为 541×400；inline/计算尺寸随容器更新或由 CSS 布局控制。
- 实际：宿主 541×400，画布 763×425；inline CSS 为 `width: 763px; height: 425px`，computed 也是 763×425，`matchesHost: false`。

### 证据

- `artifacts/web-library/run-20261023022744/result.json` 的 `layoutAudit`：
  - `hostWidth: 541`, `hostHeight: 400`
  - `canvasWidth: 763`, `canvasHeight: 425`
  - `inlineWidth: "763px"`, `inlineHeight: "425px"`
  - `matchesHost: false`
- `artifacts/web-library/run-20261023022744/final-vrm.png`：缩放后的 VRM 画面，可直接看到画布与预览容器尺寸不一致。
- 同次运行的 `pageErrors` 与 `consoleErrors` 均为空；库内 3 个条目、active、VRM 导出均未受影响，因此按非阻断缺陷记录。

### 修复方向（交 Codex）

最小修复方向是创建候选画布后清除复制来的 `width`/`height` inline 样式，让 VRM 画布继续由宿主 CSS 布局控制；或者统一让 VRM 与精灵图渲染器都显式维护 CSS 尺寸。两种方式二选一即可，不应只修改 smoke 的断言来掩盖问题。

## 已复核且未发现可确认缺陷的边界

### `src/companion-stage.ts`

- 候选使用独立画布，只有加载成功后才在 `commit()` 中 `replaceWith`，旧画面在加载、校验和持久化期间保持可见。
- `pending`/`revision`/`AbortSignal` 共同拦截过期结果；取消、加载失败或过期候选会释放渲染器，不替换当前画布。
- commit 先再次应用当前尺寸，再替换画布、切换 `current` 和 `kind`，最后释放旧渲染器；正常路径没有旧资源提前释放。
- `dispose()` 会递增 revision、释放 pending 与当前渲染器；`release` 有 `released`/`committed` 幂等保护。VRM 加载中被释放时，`VrmStage` 也用 generation + `disposed` 丢弃解析结果并释放模型。
- 除上述 clone 带入 inline 尺寸的问题外，未确认其他可复现缺陷。

### `src/main.ts`

- 加载顺序为：校验已有角色摘要 → `stage.prepare` → 读取源 VRM 字节 → 需要时 `library.add` → 检查取消 → 加 commit 锁 → `library.activate` → `prepared.commit()` → 更新 `currentCharacter`/`info`/`source`/UI。
- 库写入或激活失败时，`source`、`info`、`currentCharacter` 和可见画布都还没有切换；catch + `prepared.dispose()` 保留旧角色。D17 的错误规格与损坏文件场景也验证了 active 和条目集合不变。
- 取消按钮在 commit 锁生效后禁用，点击处理也检查 `committing`；未确认存在取消后仍切换画面的路径。
- `source` 只在该次输入是 VRM 时赋值为 `ArrayBuffer`，精灵图赋为 `null`；`showCharacter` 按输入类型设置格式徽标与导出提示，最后统一按 `!source` 禁用导出。精灵图不能被当作源 VRM 导出；D17 切回 VRM 后导出按钮恢复。
- 窗口通知通过 BroadcastChannel 和桌面 `model:changed` 进入 `syncLibrary`；active 与当前不同时以 `persist: false` + 已存摘要校验加载，不重复 `add`；active 相同则刷新摘要显示。D17 刷新后仍为 1 条迁移记录、无重复迁移。
- D18 没有重跑多窗口桌面同步；该路径由既有 phase-three smoke 覆盖，本次结论来自代码只读核对与 D17 的刷新持久化证据。

### `electron/preferences.cjs` 与设置接线

- `validatePatch` 只允许 `scale`/`performance`，拒绝未知键和非法枚举值；`normalizePreferences` 对版本、类型或值不合法的情况回退默认值。
- `update` 通过 Promise 链串行化写入；先写 `.tmp` 再 `rename`，只有成功后才更新内存 `current`。失败写入被记录为已处理的 rejection，不阻塞后续写入，也不污染内存状态。
- `load` 等待进行中的写入；文件不存在或 JSON 语法损坏时使用默认设置，其他读取错误向上抛出，由 `electron/main.cjs` 的启动 catch 保留默认值并记录日志。
- 设置更新后主进程调整桌宠尺寸并广播；工坊更新期间禁用两个选择框，失败时回滚显示。未确认非法设置被接受、并发更新互相覆盖、保存失败却显示成功或损坏设置导致启动失败的可复现路径。
- 设置专项 smoke、Windows 包与重启验收由 Codex 负责，本次未重跑。

## 复核边界

- 本报告只记录可复现且影响本阶段的代码问题，不把未执行的外部浏览器、真实 LAN/手机、完整重启或打包验收写成代码缺陷。
- 唯一缺陷为非阻断布局问题，已交 Codex；本次交付未修改 `src/**`、`electron/**`、`packages/**`、既有测试、根配置或依赖，也未提交或推送。

## Codex 修复验收补充

上文保留 D18 修复前证据。Codex 已在候选 canvas 创建时清除继承的 inline 宽高，补充切换单测，并将主页面缩放结果作为 smoke 硬性断言。复验 `artifacts/web-library/run-20261023023709/result.json`：容器边框尺寸 541×400，内容区 539×398，画布 539×398，inline 宽高为空，`matchesHost: true`。比较采用容器内容区，扣除原有 1px 边框，避免把正常的 2px 边框差误判为回归。最终 169 项单测与重新打包后的原生 EXE 验收通过；此缺陷已关闭，详见 `CHECKPOINT_03.md`。
