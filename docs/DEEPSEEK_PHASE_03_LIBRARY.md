# 给 DeepSeek：阶段三角色库与旧数据迁移（D14–D16）

日期：2026-10-23。沿用共享工作区 `E:\GitWorkSpace\OiGptPet`、分支 `codex/desktop-prototype`；不切分支、不另建 worktree。

D11–D13 的交付已收到，独立验证结果见 `DEEPSEEK_DELIVERY_03.md`，主程序集成仍待 Codex 验收。本轮请直接开发以下独立模块。Codex 按用户要求暂停主程序功能开发，后续负责界面、Electron 和两种渲染器接线。

后续用户已授权 Codex 恢复并负责统一提交到 GitHub。共同对齐点为：设置、角色库迁移/管理、两种桌宠切换、失败回退与重启恢复通过主程序集成验证。你完成 D14–D16 后停止编辑并交付；Codex 汇总验收后提交、推送，再暂停。你仍不自行提交/推送。前述暂停记录为分工时状态，现以本条为准。

## 文件所有权

本轮仅新增/修改：

```text
packages/character-library/**
tests/character-library.test.ts
tests/fixtures/character-library/**
scripts/character-library-smoke.mjs
docs/CHARACTER_LIBRARY.md
docs/DEEPSEEK_DELIVERY_03_LIBRARY.md
```

不要改 `src/**`、`electron/**`、现有包、根配置/package/lock、主 smoke、打包脚本或其他交付说明。D11–D13 渲染器暂时冻结，发现问题记录给 Codex。无需增加依赖，不提交、不推送，不运行主 smoke，不访问主用户数据。不使用 Fred；角色源文件与产物仍只放忽略的 artifacts 目录。

## D14：本地角色目录与稳定接口

新增 `packages/character-library/index.ts`，浏览器和 Electron renderer 均可使用，无 Node/Electron、网络、全局播放循环或 UI 依赖。使用独立 IndexedDB 数据库，默认名 `oigptpet-library`、版本 1，可注入数据库名供测试隔离。禁止打开、升级或删除旧的 `oigptpet` 数据库。

公开接口按以下约定实现；可增加导出类型和错误码，但不要自行改变方法语义：

```ts
type CharacterInput =
  | { kind: 'vrm'; blob: Blob; name?: string }
  | { kind: 'sprite'; blob: Blob; profile: AtlasProfile; name?: string };

interface CharacterSummary {
  id: string;
  kind: 'vrm' | 'sprite';
  name: string;
  sha256: string;
  encodedBytes: number;
  createdAt: string;
  profile?: AtlasProfile; // 仅 sprite
}
interface CharacterAsset { summary: CharacterSummary; blob: Blob }

// createCharacterLibrary(options?: { databaseName?: string }): CharacterLibrary
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
```

- 存原始编码 Blob，不重新编码、不把源 VRM 转成精灵图。返回的 Blob 字节与入库字节一致；IndexedDB 返回新对象是正常的，不要求对象引用相同。
- SHA-256 来自实际字节，复用现有摘要函数（包含局域网非安全 HTTP 场景），不接受调用者提供哈希或“已验证”标记。身份按 kind/profile/hash 确定；相同内容重复导入返回已有条目，不改原名、创建时间或当前选中项。
- VRM 复用 `character-core/vrm-file.ts` 的静态检查和 64 MiB 上限。精灵图复用 atlas 输入、解码和结构检查，PNG/WebP <=20 MiB，v1/v2 尺寸正确，释放临时 Bitmap。不要用扩展名或 MIME 代替检查。静态检查不代表模型渲染或平台验收成功。
- 库最多 12 个条目、原始文件合计 256 MiB；上限检查与插入在同一 readwrite 事务内，避免多个实例并发突破限制。哈希/解码在事务外完成，避免事务因异步等待失活。
- 名称去除首尾空白，1–80 个字符；缺省可取模型静态名称或“本地角色/精灵图”，不得存本机绝对路径。列表只含摘要，不读取/返回所有 Blob；顺序固定并写入文档。
- `add` 只入库，不自动切换。取消或验证失败不产生半条记录，不改变 active。

## D15：选中、删除与可重复迁移

- `activate` 只允许存在且内容完整的条目；校验实际字节摘要后再更新 active，事务内复核条目未被其他实例删除。失败保留旧 active。实际 renderer 加载由 Codex 先完成；库激活不等于画面已加载。
- `remove` 允许删除非当前条目；当前条目直接拒绝，提示先切换。删除条目不触碰用户原文件、旧数据库或其他条目。删除缺失条目可幂等成功；重命名/选中缺失条目应明确报错。
- `migrateLegacyVrm` 由 Codex 从旧 Electron `current.vrm` 或旧 IndexedDB 读取字节后调用；模块不自行读取旧位置。合法旧模型入库，且仅在新库尚无 active 时设为当前。重复调用不重复创建，不覆盖用户已有名称或 active；入库与首次设 active 必须原子完成。
- 旧模型损坏、超限、写入失败/配额失败时，保持旧数据与已有库不变，报告可理解的错误。不得先删除旧数据再尝试迁移。
- 以事务完成事件作为写成功依据，不能在单个 request 成功时提前报告成功；失败不污染缓存，后续操作可重试。跨实例操作保持一致，避免只靠模块内队列实现原子性。
- 正确处理打开失败、blocked/versionchange、关闭时未完成操作及关闭后调用；不悬挂 Promise、不删除其他页面的数据。明确取消与 close 的提交边界，已提交的事务不冒充已撤销。

## D16：独立验证与交付

- 单测覆盖输入、稳定身份、名称/上限、重复导入、选中/移除约束；重点验证失败后的数据状态，避免只断言内部函数调用。
- 独立浏览器 fixture/smoke 使用真实 IndexedDB，随机端口、临时用户目录、独立数据库名；可沿用 renderer-sprite smoke 的启动方式。不要安装 fake-indexeddb 或修改根依赖。
- 实际验证：关闭重开后 Blob/哈希/名称/active 保留；VRM 与 v1/v2 PNG/WebP；重复迁移；已有 active 不被迁移覆盖；无效输入/取消不入库；事务 abort 后状态不变且可重试；两实例同时导入去重、计数/容量边界、删除与激活竞争。不要通过写满机器磁盘测试配额；容量边界可用受控测试数据/可注入限制验证，但需说明与默认生产限制的关系。
- 真实 VRM 可用本地 AvatarSample_B；真实图集用 `artifacts/animation-fixes/run-04/atlas-v1.png`、`atlas-v2.png`。避免在 smoke 中写入全部下载模型。所有探针、截图和结果写入新的 `artifacts/character-library/` 子目录，不改旧证据。
- 运行 `npx tsc --noEmit`、`npm test`、`node scripts/character-library-smoke.mjs`。共享区其他范围失败时记录具体错误，不抢改主程序。
- `docs/CHARACTER_LIBRARY.md` 写 API、数据库结构、迁移、原子性、限制、失败/取消约定及 Codex 接入示例。`docs/DEEPSEEK_DELIVERY_03_LIBRARY.md` 写实际文件、命令、结果、输入哈希及未测项。

完成后停止编辑，交 Codex 集成与统一提交。界面、窗口同步、Electron IPC/磁盘适配、渲染失败回退和实际重启恢复由 Codex 承担；不要把本模块完成写成这些功能已完成。
