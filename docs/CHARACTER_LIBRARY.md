# 本地角色库

实现日期：2026-10-23。`packages/character-library` 是浏览器与 Electron renderer 共用的本地角色数据层，负责校验、去重、持久化、选中指针和旧 VRM 迁移。它不依赖 Node、Electron、网络、UI 或播放循环，也不解码 VRM 或绘制角色。界面、窗口同步、Electron IPC/磁盘适配、渲染器加载和实际重启恢复由 Codex 接入。

数据保存在独立的 IndexedDB 数据库（默认 `oigptpet-library`，版本 1）。模块不会打开、升级或删除旧版 `oigptpet` 数据库，也不会读取 `userData/current.vrm`。

## 文件

```text
packages/character-library/types.ts    公开类型、常量与错误
packages/character-library/naming.ts   名称、稳定 ID 与列表排序
packages/character-library/prepare.ts  VRM/图集校验、SHA-256、解码检查
packages/character-library/store.ts    IndexedDB 事务、限制、选中指针与迁移
packages/character-library/index.ts    公开工厂与 activate 摘要复核
tests/character-library.test.ts        31 项单元测试
tests/fixtures/character-library/      真实 IndexedDB 浏览器 fixture
scripts/character-library-smoke.mjs    独立 Playwright/Electron smoke
```

复用的共享实现（本次未修改）：

- `packages/character-core/vrm-file.ts`：GLB/VRM 1.x 静态检查、内嵌资源检查、节点数限制、64 MiB 上限。
- `packages/atlas-preview/input.ts`：profile / MIME / 体积 / 文件头 / 尺寸校验。
- `packages/atlas-preview/sha256.ts`：Web Crypto 优先、局域网非安全 HTTP 下可回退的 SHA-256。
- `packages/atlas-tools/inspect.ts`：完整 RGBA 的逐格结构检查。

## 公开接口

```ts
import type { AtlasInspection, AtlasProfile } from '../target-chatgpt/contract';

type CharacterInput =
  | { kind: 'vrm'; blob: Blob; name?: string }
  | { kind: 'sprite'; blob: Blob; profile: AtlasProfile; name?: string };

interface CharacterSummary {
  id: string;
  kind: 'vrm' | 'sprite';
  name: string;
  sha256: string;
  encodedBytes: number;
  createdAt: string;      // ISO 8601
  profile?: AtlasProfile; // 仅 sprite
}

interface CharacterAsset {
  summary: CharacterSummary;
  blob: Blob;
}

interface CharacterLibrary {
  list(): Promise<CharacterSummary[]>;
  get(id: string): Promise<CharacterAsset | null>;
  add(input: CharacterInput, signal?: AbortSignal): Promise<CharacterSummary>;
  getActive(): Promise<CharacterAsset | null>;
  activate(id: string): Promise<void>;
  rename(id: string, name: string): Promise<void>;
  remove(id: string): Promise<void>;
  migrateLegacyVrm(buffer: ArrayBuffer): Promise<CharacterSummary>;
  close(): void;
}

function createCharacterLibrary(options?: {
  databaseName?: string;
  limits?: Partial<{ maxEntries: number; maxBytes: number }>; // 仅测试/嵌入钩子
}): CharacterLibrary;
```

常量：

| 常量 | 值 | 含义 |
| --- | ---: | --- |
| `CHARACTER_LIBRARY_DEFAULT_DATABASE` | `oigptpet-library` | 缺省数据库名 |
| `CHARACTER_LIBRARY_DATABASE_VERSION` | `1` | schema 版本 |
| `CHARACTER_LIBRARY_MAX_ENTRIES` | `12` | 条目上限 |
| `CHARACTER_LIBRARY_MAX_BYTES` | `268435456` | 原始文件合计上限（256 MiB） |
| `CHARACTER_LIBRARY_MAX_NAME_LENGTH` | `80` | 名称最大字符数（Unicode code point） |

`options.limits` 会逐项向生产上限收敛（只能调小，不能突破 12 / 256 MiB），生产调用应省略。`databaseName` 会去除首尾空白；空字符串、非字符串或 `oigptpet` 会以 `invalid-input` 拒绝，不会打开旧库。

## 身份、哈希与名称

- 身份完全由实际字节决定：
  - VRM：`vrm:<sha256>`
  - 精灵图：`sprite:<v1|v2>:<sha256>`
- `sha256` 小写十六进制，来自入库字节；不接受调用方提供哈希或“已验证”标记。同一内容、同一 profile 重复导入返回已有条目。
- 返回的 Blob 字节与入库字节一致。IndexedDB 读取会返回新的 Blob 对象，不要求对象引用相同。
- `encodedBytes` 等于 Blob 的编码后字节数；模块不重新编码，也不把源 VRM 转成精灵图。
- 名称去除首尾空白后必须为 1–80 个 Unicode code point。显式名称超限直接拒绝，不截断。
- 缺省名称：VRM 取静态元数据 `name`（截断到 80 个 code point），为空时用 `本地角色`；精灵图用 `精灵图`。名称从不取自 `File.name`、本机路径或 URL。
- `list()` 只读取摘要，不读取 Blob；顺序固定为 `createdAt` 升序，相同时间按 `id` 升序。本模块不提供分页或自定义排序。

## 输入校验

### VRM

- 非空、≤ 64 MiB；GLB magic/version/声明长度一致；JSON 块有效。
- 必须是 VRM 1.x（`VRMC_vrm.specVersion` 以 `1.` 开头）。
- `buffers` / `images` 不能含任何 `uri`，即纹理与数据全部内嵌，不允许外部文件或网络地址。
- 节点数 ≤ 5000。
- 以上复用 `inspectVrmFile`，错误映射为 `invalid-input`。

静态检查不解析网格、材质、骨骼、动画或渲染兼容性；导入成功不代表模型能渲染、显示正确或通过目标平台验收。

### 精灵图

- profile 必须是 `v1` 或 `v2`；Blob 必须带 `image/png` 或 `image/webp` MIME。
- 编码字节 ≤ 20 MiB；按真实文件头识别 PNG/WebP，并与 MIME 一致。
- 文件头尺寸必须等于 v1 的 1536×1872 或 v2 的 1536×2288。
- `createImageBitmap` 解码后再核对实际尺寸；读取一次完整 RGBA，调用 `inspectAtlas` 检查空帧、未使用格污染和不透明背景。
- 任何失败都不入库；临时 ImageBitmap 在 `finally` 中关闭，取消时迟到的 Bitmap 也会关闭。

结构检查不判断动作语义、角色一致性或视线质量，也不能替代目标平台官方预检。扩展名、MIME 或 UI 选择都不作为校验依据。

## 数据库结构

数据库默认名 `oigptpet-library`，版本 1；object store：

| store | keyPath / key | 值 |
| --- | --- | --- |
| `characters` | `id` | `CharacterSummary`（不含 Blob） |
| `assets` | `id` | `{ id: string; blob: Blob }`，原始编码字节 |
| `meta` | 固定 key `active` | `{ id: string }`；无当前角色时不存在该记录 |

- 条目与 Blob 分 store 保存，`list()` 不读取 Blob。
- 写入的 Blob 是调用方提供的原始编码文件；MIME 沿用提供方（迁移时为 `model/gltf-binary`）。MIME 不参与身份。
- `get` / `getActive` 会检查摘要记录、Blob 存在且 `blob.size === encodedBytes`；不在读取路径重算全量摘要，因此同长度损坏只会在 `activate` 时被拒绝。
- 版本升级只创建缺失的 store，不删除已有数据。`getActive` 遇到指向已不存在摘要的陈旧指针会返回 `null`。

## 原子性、并发与限制

- 哈希、图集解码和结构检查全部在事务外完成，避免事务因异步等待失效。
- 条目上限与字节上限的检查、摘要写入、Blob 写入（以及迁移时的首次 active 设置）在同一个 `readwrite` 事务内完成。检查的是所有现有摘要的 `encodedBytes` 之和；`total + new === maxBytes` 允许，超出才拒绝。
- 重复导入/重复迁移在事务内先查已有条目；存在则只复核 Blob 存在且大小一致，返回已有摘要，不修改名称、时间或 active，也不新增字节。
- 多实例（多个窗口或多个 `createCharacterLibrary`）不使用模块内队列。IndexedDB 对冲突的 `readwrite` 事务串行化，因此计数/容量检查不会因并发突破上限，重复导入也会收敛为一条。
- 写成功以事务 `oncomplete` 为准，不以单个 request 成功为准。动作内部抛错会 `abort()` 事务；`onabort` 报告失败，已写入内容回滚。
- `QuotaExceededError` 映射为 `quota`；其他事务/打开失败映射为 `storage`。
- `add` 只入库，不切换当前角色。选择必须由调用方在渲染器成功加载后调用 `activate`。

## 操作语义

### `add`

1. 校验输入类型、名称、VRM 或图集。
2. 读取实际字节并计算 SHA-256、生成稳定 ID。
3. 在 `characters` / `assets` 事务内：已有同 ID 条目则返回它；否则检查数量与字节上限后写入摘要和 Blob。
4. 不修改 active。

取消、校验失败、上限失败都不产生半条记录，也不改变 active。

### `list` / `get`

- `list()` 返回全部摘要的副本，按固定顺序排序；不返回 Blob。
- `get(id)` 不存在返回 `null`；摘要存在但 Blob 缺失或大小不符抛 `incomplete-asset`。

### `activate` / `getActive`

`activate(id)`：

1. 读取摘要和 Blob；不存在抛 `not-found`。
2. 对实际读取的 Blob 字节重算 SHA-256，并与摘要的 `sha256` / `encodedBytes` 比较；不一致抛 `incomplete-asset`，active 不变。
3. 在 `readwrite` 事务内复核条目仍存在、Blob 仍在、大小一致且 kind/sha256/bytes/profile 未被其他实例改动；不一致抛 `not-found` / `incomplete-asset` / `conflict`。
4. 最后写入 `meta.active`。成功返回代表 active 指针已切换，**不代表画面已经加载或显示成功**。

失败（包括摘要不符、条目被并发删除、事务失败）保留旧 active。调用方应先让渲染器成功加载同一 Blob，再调用 `activate`；渲染失败时不要切换。

`getActive()` 返回 active 指向的摘要和 Blob；没有 active（或指针陈旧）返回 `null`；Blob 缺失或大小不符抛 `incomplete-asset`。

### `rename`

去除首尾空白并校验 1–80 个 code point（否则 `invalid-name`）；条目不存在抛 `not-found`。只改 `characters` 中的名称，不触碰 Blob、时间、ID 或 active。重复导入不会覆盖用户改名。

### `remove`

- 删除非当前条目：同一事务内删除摘要和 Blob。
- 删除当前条目：抛 `active-character`，要求先 `activate` 其他条目。
- 删除不存在的 ID：幂等成功。
- 不修改用户原文件、旧数据库或其他条目。

### `migrateLegacyVrm(buffer)`

由 Codex 从旧 Electron `current.vrm` 或旧 IndexedDB 读取字节后调用；模块不自行读取旧位置，也不打开旧 `oigptpet` 数据库。

- 输入必须是 `ArrayBuffer`；按普通 VRM 完整校验、计算 SHA-256、生成稳定 ID。
- 在一个 `readwrite` 事务内完成：若已有同 ID 条目则复用（保留名称、创建时间），否则检查上限并写入摘要与 Blob；随后仅当 `meta.active` 不存在时，把 active 指向该条目。插入与首次选中同事务提交。
- 重复调用不重复创建，不覆盖已有名称或 active。
- 旧模型损坏、超限、配额或事务失败时，旧数据与新库均保持不变；修复输入或空间后可重试。调用方不应在迁移成功前删除旧数据。

## 取消、关闭与打开失败

### AbortSignal

- `add` 的校验、读取、哈希、解码和结构检查阶段都会检查 signal；已中止的信号立即以 `AbortError` 结束，文件不入库。
- 解码阶段取消会立即 reject，不等待底层解码；迟到 Bitmap 会被关闭。
- 事务创建前再次检查 signal。事务进行中收到 abort 时会尝试 `tx.abort()`：
  - 中止成功：事务回滚，Promise 以 `AbortError` 结束。
  - 事务已提交、`abort()` 无效：返回已提交的结果，不把成功伪造成取消。
- `migrateLegacyVrm` 不接受 signal；需要取消时由调用方放弃等待，但迁移本身会按事务原子完成或失败。

### `close()`、versionchange 与打开失败

- `close()` 幂等：关闭连接并永久标记实例已关闭；之后任何操作以 `closed` 拒绝。已在进行中的事务可能继续完成，其 Promise 按实际结果返回；关闭发生在校验/解码阶段时，后续事务入口会以 `closed` 拒绝且不入库。
- 打开中的请求若在 `close()` 后成功，会立即关闭连接并以 `closed` 拒绝，不悬挂 Promise。
- 其他连接触发 `versionchange` 时，本实例关闭连接并标记 `closed`，不删除任何数据；需要继续使用时创建新实例。
- 打开被 `blocked` 时以 `blocked` 拒绝；当阻塞连接关闭后，底层请求若仍成功会被主动关闭，不会误用。瞬时打开失败会清除缓存的开库 Promise，同一实例后续调用可重试。
- 数据库版本高于 1（例如其他程序升级过）时，打开失败映射为 `storage`。

## 错误码

| code | 场景 |
| --- | --- |
| `invalid-input` | 输入类型/kind/profile 错误；VRM 静态检查或 64 MiB 失败；图集 MIME/格式/尺寸/解码/结构失败；迁移参数不是 `ArrayBuffer` |
| `invalid-name` | 名称非字符串、空白或超过 80 code point |
| `entry-limit` | 新条目会超过条目上限 |
| `byte-limit` | 新条目会使原始字节合计超过上限 |
| `not-found` | `activate` / `rename` 的目标不存在，或事务内发现已被并发删除 |
| `active-character` | 试图删除当前选中的条目 |
| `incomplete-asset` | Blob 缺失、大小不符，或实际摘要与记录不一致 |
| `conflict` | `activate` 事务内发现摘要内容与校验时不一致 |
| `storage` | IndexedDB 打开/事务失败、版本不匹配或其他存储错误 |
| `quota` | 浏览器存储空间/配额不足 |
| `blocked` | 打开数据库被其他连接阻塞 |
| `closed` | 实例已 `close()` 或收到 `versionchange` |

外部 `AbortSignal` 取消失败以 `DOMException`（`name === 'AbortError'`）拒绝，不使用上表错误码。图集结构失败时 `CharacterLibraryError.inspection` 携带完整 `AtlasInspection`。

## Codex 接入示例

以下只是调用顺序示意；界面、窗口同步、Electron IPC/磁盘和渲染器由 Codex 实现。

```ts
import {
  CharacterLibraryError,
  createCharacterLibrary,
} from '../packages/character-library';

const library = createCharacterLibrary(); // 生产使用默认数据库

async function importCharacter(file: File, kind: 'vrm' | 'sprite', profile?: 'v1' | 'v2') {
  const controller = new AbortController(); // 由 UI 的取消按钮触发
  try {
    const input = kind === 'vrm'
      ? { kind: 'vrm' as const, blob: file }
      : { kind: 'sprite' as const, blob: file, profile: profile! };
    const summary = await library.add(input, controller.signal);
    // add 不切换当前角色；刷新列表即可。
    return summary;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return null;
    if (error instanceof CharacterLibraryError) {
      // UI 根据 error.code 展示；图集结构失败时读取 error.inspection.errors。
    }
    throw error;
  }
}

// 先让渲染器成功加载，再切库内 active。
async function selectCharacter(id: string) {
  const asset = await library.get(id);
  if (!asset) throw new Error('角色不存在');
  await loadIntoRenderer(asset); // Codex：VRM 或 SpriteStage 的实际加载；失败则抛出
  await library.activate(id);    // 只写 active 指针，不代表画面已显示
}

// 启动时恢复 active；渲染失败应保留旧画面/回退，不要调用 activate。
const active = await library.getActive();
if (active) {
  await loadIntoRenderer(active);
}

// 旧数据迁移：Codex 自行读取旧 Electron current.vrm 或旧 IndexedDB 字节。
const legacyBytes = await readLegacyVrmBytesOnce(); // 返回 ArrayBuffer | null
if (legacyBytes) {
  await library.migrateLegacyVrm(legacyBytes);
  // 成功后再由 Codex 决定是否清理旧位置；失败时不要删除旧数据。
}

async function deleteCharacter(id: string) {
  try {
    await library.remove(id);
  } catch (error) {
    if (error instanceof CharacterLibraryError && error.code === 'active-character') {
      // UI 提示先切换到其他角色。
      return;
    }
    throw error;
  }
}
```

接入注意：

- `profile` 必须由用户明确选择或由可信元数据提供，不能从扩展名推断；v1/v2 图集尺寸不同，校验会拒绝不匹配。
- 列表只含摘要；预览需要时再对单个条目调用 `get`，避免一次读出全部 Blob。
- 每个窗口各自创建实例。IndexedDB 事务保持一致，但本模块不广播变更；Codex 需通过 IPC、窗口消息或自建事件同步列表与 active 的 UI 状态。
- `activate` 成功只代表库内指针写入。渲染器加载失败、窗口刷新和重启恢复都需 Codex 额外处理；模块不提供渲染回退。
- Electron 主进程/多窗口下的 Blob 读取、旧文件备份和磁盘适配不在本模块范围。

## 验证

```bash
npx tsc --noEmit
npm test
node scripts/character-library-smoke.mjs
```

单元测试使用独立的内存 IndexedDB 子集，覆盖输入/身份/名称/上限、重复导入、选中/移除约束、迁移、取消、关闭、事务失败与并发状态。独立 smoke 使用真实 Chromium IndexedDB、随机端口 Vite、临时用户目录和独立数据库名，覆盖真实 VRM、真实 v1/v2 PNG/WebP、关闭重开与 Electron 重启、迁移、上限、双实例并发、删除/激活竞争、同长度损坏、取消和关闭边界。所有探针、截图与 `result.json` 写入忽略的 `artifacts/character-library/`。

已知边界：本模块不做渲染或语义检查、不保证平台验收、不做跨窗口通知、不直接读取旧数据、不在 `close()` 时强行回滚已提交事务；容量测试使用注入的小上限而非写满磁盘。

## 0.4.0 原子导入并选中

`addAndActivate(input, signal?, beforeCommit?)` 在事务外完成源文件检查和摘要，随后将条目、原始 Blob 与 active 指针放入同一 readwrite 事务。任何写入失败整体回滚；重复条目保留原名称和创建时间，并使用此次验证的精确原始字节。原有 `add` 仍只入库。

可选同步回调 `beforeCommit` 在校验成功、写事务前调用，宿主在此锁定取消和候选画布，以免事务已经提交但完成通知尚未返回时误报取消。校验期间取消不写入；事务提交后的结果有效，不能声称撤销。主程序只在原子调用成功后替换画面。
