# DeepSeek 阶段三交付说明（D14–D16 角色库）

交付日期：2026-10-23。工作区 `E:\GitWorkSpace\OiGptPet`，分支 `codex/desktop-prototype`，基线 `402bbf8`。本轮只新增角色库模块、测试、fixture/smoke 和文档；未集成到 `src/**` / `electron/**`，未提交或推送。

## 文件清单

新增文件：

```text
packages/character-library/types.ts              2,544 B
packages/character-library/naming.ts             1,657 B
packages/character-library/prepare.ts            8,535 B
packages/character-library/store.ts             16,502 B
packages/character-library/index.ts              3,568 B
tests/character-library.test.ts                 23,501 B，31 项测试
tests/fixtures/character-library/index.html        593 B
tests/fixtures/character-library/main.ts        27,339 B
scripts/character-library-smoke.mjs             45,538 B
docs/CHARACTER_LIBRARY.md                        本模块文档
docs/DEEPSEEK_DELIVERY_03_LIBRARY.md             本文件
```

未修改 `src/**`、`electron/**`、现有包、根配置、`package.json` / lockfile、主 smoke、打包脚本或其他交付说明；未增加依赖；未使用 fake-indexeddb，单元测试使用自建的内存 IndexedDB 子集，真实 IndexedDB 由独立 smoke 覆盖。未使用 Fred；真实输入仍来自已存在的 `artifacts/`。

## 实现摘要

- 新增 `createCharacterLibrary` 与任务约定的完整接口；数据库默认 `oigptpet-library`、版本 1，允许注入名称，明确拒绝 `oigptpet`。
- 存原始编码 Blob，不重编码；SHA-256 来自实际字节；ID 为 `vrm:<sha>` / `sprite:<v1|v2>:<sha>`；重复导入返回已有摘要且不改名称、创建时间或 active。
- VRM 复用 `inspectVrmFile` 与 64 MiB 上限；图集复用 preflight、文件头、解码尺寸和 `inspectAtlas`，PNG/WebP ≤ 20 MiB，临时 Bitmap 始终关闭。
- `characters` / `assets` / `meta` 三个 store；数量 12、原始字节合计 256 MiB 的检查与写入在同一 `readwrite` 事务内；哈希/解码在事务外；写成功以 `oncomplete` 为准。
- `activate` 先对实际 Blob 重算摘要，再在事务内复核条目未被并发删除/改动，最后写 active；失败保留旧 active。
- `remove` 拒绝当前条目、允许其他条目、缺失时幂等；缺失的 `rename` / `activate` 明确报错。
- `migrateLegacyVrm` 由调用方提供 `ArrayBuffer`；同事务完成“复用或插入 + 仅无 active 时首次选中”；重复迁移不覆盖名称/active；失败不改旧数据或新库。
- 取消在读取、哈希、解码、结构检查和事务边界分别处理；迟到 Bitmap 关闭；事务已提交时不把成功伪造成取消；`close()` / versionchange / blocked / 打开失败均有明确结果。

## 实际命令与结果

在仓库根目录执行：

```bash
npx tsc --noEmit
```

结果：通过，退出码 0，无诊断输出。

```bash
npm test
```

结果：**12 个测试文件、168 项全部通过**，Vitest 5.0.5，耗时 1.44 s。本阶段 `tests/character-library.test.ts` 为 **31 项通过**（451 ms）。全量同时包含工作区中的 `character-core`、`window-state`、`frame-pacer`、`export-session`、`distribution`、`desktop-preferences`、`companion-stage`、`atlas-tools`、`atlas-preview`、`animation-quality`、`renderer-sprite` 等测试，本次均未失败。

```bash
node scripts/character-library-smoke.mjs
```

结果：通过，输出：

```text
Character library smoke passed: real VRM plus real v1/v2 PNG/WebP in Chromium IndexedDB, restart persistence, migration, limits, races, corruption, cancellation and close boundaries.
```

smoke 使用随机端口的独立 Vite、隐藏 Electron 窗口、临时用户数据目录和本次运行专属的多个数据库名；仅监听 `127.0.0.1`，结束后关闭自身进程并删除临时目录，未使用 5173 服务或主用户数据。所有数据库操作都通过独立数据库名完成，最终检查 `indexedDB.databases()` 中不存在 `oigptpet`。

## 环境与真实输入

smoke `result.json` 记录：

```text
Windows 10 x64（win32 x64）
Electron 45.0.0 / Chrome 156.0.8078.48 / Node 24.22.0
12 个逻辑 CPU；系统内存 25,590,673,408 字节（约 23.84 GiB）
devicePixelRatio = 1
隐藏的 Electron 窗口，单进程，本地 Vite，临时 userData
```

| 输入 | 字节 | SHA-256 |
| --- | ---: | --- |
| `artifacts/model-library/2026-10-22/AvatarSample_B.vrm` | 21,047,556 | `ffbd8c92a9e67c0a948f69c7a2eec91e5c282c9ae70e9184309fc164d74cbc27` |
| `artifacts/animation-fixes/run-04/atlas-v1.png` | 293,190 | `05ac930c71c9a8f5308c2fc4c5aedcffaec99b865cbdc5a36b1c4ade1156e8f6` |
| `artifacts/animation-fixes/run-04/atlas-v2.png` | 370,954 | `84604125009381796d748388ab5b934dd9faac581b8cd8a00fd4417b4b3acada` |

浏览器通过 Vite 取到的字节与上表哈希一致；VRM 缺省名称取静态元数据 `AvatarSample_B`。smoke 还用 canvas 将真实 v1/v2 PNG 转为 WebP 后入库：

| 生成 WebP | 字节 | SHA-256 |
| --- | ---: | --- |
| v1（quality 1） | 506,194 | `d43bb5a90601e7a316d1102e64c40d3453ed17cfcabf1d462dd85269e534d6c3` |
| v2（quality 1） | 630,984 | `c678283924c8594d117eb234950a1f570eecd18acc4a7b83fa6a73ab33a84817` |

编码后的 WebP 比原 PNG 更大，这是 canvas 编码行为，不是库的转换；库只接受调用方提供的 Blob，不会自行转码。

## 覆盖范围

### 单元测试（31 项）

- 原始字节/稳定 ID/不自动激活；VRM 静态名称、长名称截断、显式名称校验、无 `File.name` 回退。
- 损坏 VRM、外部引用、无效图集元数据不入库且不改变旧 active。
- 数量/字节上限、测试上限收敛到生产最大值、非法 limit 同步拒绝。
- 选中成功、摘要/Blob 缺失时不切换、旧 active 保留；改名、缺失/非法名称、删除当前/其他/缺失条目。
- 迁移合法模型、已有 active 不覆盖、无 active 时接入已有重复条目、坏字节不变、首次设 active 失败回滚。
- 资源写入失败回滚后可重试；预中止、延迟读取期间取消不入库；关闭幂等、关闭后调用、进行中操作不悬挂、close 与事务创建竞争时报告 `closed`。
- 双实例并发导入去重与上限；remove/activate 竞争结果一致；关闭重开保留摘要/Blob/名称/active；列表固定顺序与摘要副本；陈旧 active 指针。
- 不打开旧 `oigptpet`、blocked 打开可重试、空数据库名同步拒绝。

### 独立 smoke（真实 Chromium IndexedDB）

- 真实 VRM 与真实 v1/v2 PNG、由真实 PNG 生成的 v1/v2 WebP：入库、摘要、字节数、默认/显式名称、同字节重复导入、列表顺序与 active。
- 同一 renderer 关闭并重开数据库，以及 Electron 进程重启后（同一临时 userData）：摘要、Blob 哈希、名称、active 和列表顺序保留；默认数据库名 `oigptpet-library` 也保留。
- 迁移：已有 active 时迁移真实 VRM 不覆盖 active；重复迁移保留用户改名；空库首次迁移同时入库并设 active；坏/截断旧模型失败后库与 active 不变，随后成功重试。
- 上限：`maxEntries: 2` 时第三条拒绝并回滚，删除后可重试；`maxBytes: 664144`（等于 v1+v2 PNG 之和）时两条恰好允许，第三条 WebP 拒绝，腾出空间后重试成功。注入上限均小于生产上限，生产仍是 12 / 256 MiB。
- 双实例并发：同一 VRM 同时导入只产生一条；4 个不同条目在 `maxEntries: 3` 下恰好 3 成功、1 个 `entry-limit`。
- remove/activate 竞争：本次删除先完成，`remove` 成功、`activate` 以 `not-found` 失败，最终 active 保持另一条；smoke 同时接受相反顺序并核对状态一致性。
- 同长度损坏：直接修改 `assets` store 中的一个字节，`activate` 以 `incomplete-asset` 失败，旧 active 不变；摘要复核确实捕捉到大小不变的内容损坏。
- 非法输入：坏 VRM、外部引用、截断 VRM、错误图集尺寸、假 PNG、错误 MIME、空帧（携带 `empty-frame` inspection）、非法名称；全部拒绝，列表和 active 不变。
- 取消与关闭：立即取消、解码中取消（本次 6.3 ms 内以 `AbortError` 结束）、解码中 close（以 `closed` 结束且无半条记录）、关闭后调用、close 幂等；Bitmap 探针最终 23 创建 / 23 关闭 / 0 未完成。
- versionchange：外部升级到版本 2 后原实例以 `closed` 拒绝；新实例按版本 1 打开得到 `storage`，不悬挂、不删除数据。
- 原始 schema 检查：版本 1，store 为 `assets` / `characters` / `meta`，摘要与 Blob key 一致，active 指针等于当前条目。

## 输出

本次输出位于本机 `artifacts/character-library/run-01/`，不提交 Git：

| 输出 | 字节 | 说明 |
| --- | ---: | --- |
| `result.json` | 动态 | 环境、输入哈希、各场景结果、探针、耗时；含时间戳，不作为稳定哈希 |
| `main-session.png` | 13,937 | 主场景结束时的 fixture 状态页 |
| `after-restart.png` | 14,451 | Electron 重启并复核后的状态页 |

截图仅记录 fixture 文本状态，不是角色渲染截图；本模块不绘制角色。

## 性能参考

最近一次 smoke 的墙钟时间（包含 Playwright IPC、完整 Blob 读取和 IndexedDB 克隆）：

| 指标 | 数值 |
| --- | ---: |
| 首次 Electron 启动 + fixture 就绪 | 2,314.9 ms |
| 导入真实 VRM（21,047,556 B） | 148.9 ms |
| 导入真实 v1 PNG | 55.3 ms |
| 导入真实 v2 PNG | 102.8 ms |
| 导入真实 v2 WebP（含 fixture 转码） | 223.1 ms |
| 选中真实 VRM（重算 21 MB 摘要 + 事务） | 65.9 ms |
| 重复导入 v2 PNG（重算摘要，命中已有条目） | 55.3 ms |
| 迁移真实 VRM（已有 active） | 165.0 ms |
| Electron 重启至 fixture 就绪 | 325.3 ms |

**这些只是本机单次量级参考，不构成跨硬件、跨系统或跨浏览器保证。** 未测量峰值内存、长时间运行或低端设备表现。

## 尚存问题与未执行项

- 未接入主程序：列表/预览界面、窗口同步、Electron IPC/磁盘适配、渲染器加载顺序、渲染失败回退和真实启动恢复仍由 Codex 完成。`activate` 只写库内指针。
- 未读取真实旧 Electron `current.vrm` 或旧 IndexedDB：模块按要求只接收 Codex 传入的 `ArrayBuffer`；smoke 使用 artifacts 中的真实 VRM 字节验证迁移逻辑。旧数据的实际读取与清理未执行。
- 未运行主 `scripts/smoke.mjs`、`scripts/release-smoke.mjs`、打包脚本或真实应用窗口，避免与 Codex 修改和主用户数据冲突。
- 未主动制造浏览器配额不足或写满磁盘；`quota` 映射只由实现保证，未在真实 IDB 中触发。容量边界使用注入的小上限，未验证生产 12 × 256 MiB 的完整填充。
- `blocked` 打开只在单元测试的假实现中覆盖；versionchange 在真实 Chromium 中覆盖。未测试多进程/多窗口 UI 同步。
- 未在 macOS/Linux、其他 Chrome/Electron 版本、移动端或不同磁盘状态验证；未做崩溃/断电后的持久性测试。
- 非安全 HTTP 下的 SHA-256 回退还依赖既有 `atlas-preview` 测试；本次 smoke 运行在 `127.0.0.1` 安全上下文，走 Web Crypto。
- 未做 VRM 渲染、动画/表情兼容性或目标平台官方预检；静态校验通过与图集结构通过都不代表平台验收。
- 未提交、未推送，交由 Codex 统一集成与提交。
