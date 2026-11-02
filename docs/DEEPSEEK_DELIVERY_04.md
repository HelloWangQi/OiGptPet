# DeepSeek 阶段四交付说明（D19–D22）

交付日期：2026-10-23。工作区 `E:\GitWorkSpace\OiGptPet`，分支 `codex/desktop-prototype`，基线 `e8069ba`。本阶段交付单角色 `.oipet` 容器、独立验证、真实浏览器主程序验收和只读集成复核；未提交、未推送，未上传角色，未碰 `5173` 或主用户数据。

核心 API 在 D20 后冻结：`encodeCharacterPackage(asset, signal?)` / `decodeCharacterPackage(blob, signal?)` 及 `contract.ts` 中的 v1 格式、上限和错误码。D21 没有修改容器接口；D22 只发现主程序集成路径上的一个非阻断“半条写入”缺陷，未修改其文件，交 Codex 修复。

## 文件清单

仅新增本阶段允许范围内的文件；未修改 `src/**`、`electron/**`、`packages/character-library/**`、既有 renderer/atlas 包、根配置/依赖、旧 smoke 或阶段三说明。

```text
packages/character-package/contract.ts            140 行  常量、清单类型、错误、字段顺序
packages/character-package/index.ts               483 行  encode/decode 实现
tests/character-package.test.ts                   470 行  21 项单元测试
tests/fixtures/character-package/index.html        18 行  fixture 入口
tests/fixtures/character-package/main.ts          606 行  IndexedDB/取消/容器 fixture
scripts/character-package-smoke.mjs               627 行  独立容器 smoke
scripts/web-package-smoke.mjs                    1040 行  真实主程序浏览器 smoke
docs/CHARACTER_PACKAGE.md                         新增     API、格式、边界、集成与取消
docs/DEEPSEEK_DELIVERY_04.md                      本文件
docs/DEEPSEEK_REVIEW_04.md                        新增     D22 只读复核
```

D22 的故障注入复现脚本与证据只放在忽略目录 `artifacts/web-package/`，不属于交付源码。

## 第一轮：D19 容器与 API

- 实现固定二进制 v1：`OIPET001` + 小端清单长度 + UTF-8 JSON 清单 + 唯一原始 payload；无目录、路径、账户、脚本或自动下载 URL。
- 字段顺序固定为 `format, schemaVersion, name, kind, mime, encodedBytes, sha256`，sprite 末尾增加 `profile`；VRM 禁止 `profile`。
- 名称 trim 后 1–80 code points；清单 1–65,536 字节；VRM payload ≤64 MiB，sprite ≤20 MiB；整包 ≤67,174,412 字节。
- 编码复核 summary 的大小/摘要/kind/profile/MIME，读取 payload 后重新计算摘要；字节原样写入，不重新编码 PNG/WebP，不转换 VRM。
- 解码先检查头/边界/总大小，再严格解析清单，最后按 kind 限制 payload 并复算 payload 与完整容器摘要；不做宽松猜测。
- 解码不自动入库、激活、下载、创建 Object URL/Bitmap；容器通过不代表源文件可渲染。
- 取消统一为 `AbortError`；耗时步骤前后检查 signal；格式错误使用 `CharacterPackageError.code`。

## 第一轮：D20 独立验证

### 单元测试

```bash
npx vitest run tests/character-package.test.ts
```

结果：**21/21 通过**，测试耗时 1,828 ms，总耗时 2.38 s。覆盖头、字段顺序、清单/UTF-8/JSON、名称、版本、kind/profile/MIME、超限、截断、尾随、摘要不符、取消和实际字节保留。单元测试的真实输入为 `public/models/demo.vrm` 与 run-04 的 v1 PNG；v2 PNG 与生成 WebP 在独立 smoke 中验证。

### 独立 smoke

```bash
node scripts/character-package-smoke.mjs
```

结果：通过，退出码 0；`targetEntries = 4`，`errors.page = []`，`errors.console = []`。真实 VRM、v1 PNG、v2 PNG 和生成 WebP 均完成 encode → decode → 真实 IndexedDB `add`；解码 input 与原始资产逐字节一致。产物写在 `artifacts/character-package/run-01/`（`result.json`、`generated-atlas.webp`、`character-package.png`），未覆盖旧证据。

### 输入与容器哈希（最终重跑）

| 输入 | 字节 | SHA-256 |
| --- | ---: | --- |
| `artifacts/model-library/2026-10-22/AvatarSample_B.vrm` | 21,047,556 | `ffbd8c92a9e67c0a948f69c7a2eec91e5c282c9ae70e9184309fc164d74cbc27` |
| `artifacts/animation-fixes/run-04/atlas-v1.png` | 293,190 | `05ac930c71c9a8f5308c2fc4c5aedcffaec99b865cbdc5a36b1c4ade1156e8f6` |
| `artifacts/animation-fixes/run-04/atlas-v2.png` | 370,954 | `84604125009381796d748388ab5b934dd9faac581b8cd8a00fd4417b4b3acada` |
| 生成 WebP | 630,984 | `c678283924c8594d117eb234950a1f570eecd18acc4a7b83fa6a73ab33a84817` |

| 容器 | 清单字节 | 容器字节 | 容器 SHA-256 |
| --- | ---: | ---: | --- |
| VRM | 213 | 21,047,781 | `aecdee82a9b1768eaf234a88de6fa6bc8694f8aa2ccd8189e3064ccd10a7619c` |
| v1 PNG | 216 | 293,418 | `8b1303c1b109d0f8e8a2eda1e6537337ce54fb88395162e61555c640f1b95e78` |
| v2 PNG | 216 | 371,182 | `6738b713b9a69353ef772b5be7c90eb41b405c91fa3016cf1bca2430cf000846` |
| WebP | 222 | 631,218 | `e6af4dcfbe6958c00e5e7000994813b72df82a5015147e1c3bea0e977aafbf21` |

## 第二轮：D21 浏览器主程序验收

### 实际命令与结果

```bash
node scripts/web-package-smoke.mjs
```

结果：通过，退出码 0；输出目录 `artifacts/web-package/run-20261023034826/`；总耗时 74,322 ms。

- 在临时 Electron Chromium 窗口中加载真实 `src/main.ts`，无 preload、无 `petDesktop`（`typeof window.petDesktop === 'undefined'`），`open-pet` 不可用。
- Playwright 使用 `acceptDownloads: 'accept'` 捕获真实 Blob `<a download>` 文件；不经过原生保存对话框。这个替代路径不代表外部 Chrome/Edge 或真实 LAN/手机。
- profile A：真实 UI 导入 demo VRM、v1 PNG、v2 PNG、生成 WebP，分别改名为“备份原名”“浏览器图集 V1”“浏览器图集 V2”“浏览器图集 WebP”，并通过 `#backup-character` 备份；4 个下载均完成，`download.failure === null`。
- profile B：干净用户目录，通过 `#package-file` 恢复 4 个包；名称、kind/profile、IndexedDB 原始字节摘要、画布不透明像素均核对通过。
- 重复恢复：VRM 包恢复后条目数仍为 1，保留本地别名（A 为“A 本地别名”，B 为“B 本地别名”），不增加条目。
- 无效恢复：截断包、错误 magic 文件、错误源类型均返回错误状态，当前角色和条目集合不变。
- 导出门控：WebP 精灵图时 `#export-button` 禁用，title 为“精灵图可直接播放；导出新动作需要源 VRM。”；切回 VRM 后启用且 title 为空。
- 20 次真实 UI 切换，序列为 `v1, vrm, v2, webp` 重复 5 次；记录每次源类型/耗时和资源样本。`pageErrors = []`，`consoleErrors = []`。
- 刷新后 active 仍为 WebP（`sprite:v2:c678...`），4 个条目/4 行，格式徽标 `SPRITE v2`，导出仍禁用。

### 输入与备份容器

| 输入 | 字节 | SHA-256 |
| --- | ---: | --- |
| `public/models/demo.vrm` | 10,776,032 | `12c2b97e95e700783a6a550dc0eee2d7880aeedccef9ae67bc4c5a2f0f2631a2` |
| `artifacts/animation-fixes/run-04/atlas-v1.png` | 293,190 | `05ac930c71c9a8f5308c2fc4c5aedcffaec99b865cbdc5a36b1c4ade1156e8f6` |
| `artifacts/animation-fixes/run-04/atlas-v2.png` | 370,954 | `84604125009381796d748388ab5b934dd9faac581b8cd8a00fd4417b4b3acada` |
| 生成 WebP（v2，1536×2288） | 630,984 | `c678283924c8594d117eb234950a1f570eecd18acc4a7b83fa6a73ab33a84817` |

| 备份 | 容器字节 | 容器 SHA-256 | 清单字节 |
| --- | ---: | --- | ---: |
| `companion-vrm.oipet` | 10,776,255 | `1feb6575e469e1a1e2c38e63874bdaa214ab93312ed424a2e0fabb99aa96ac7b` | 211 |
| `companion-v1.oipet` | 293,427 | `3c4993ba92edae818d361ca470f1ad2931441295230fb210c601b5f879d61478` | 225 |
| `companion-v2.oipet` | 371,191 | `9b7c46df1ebf3e36161ca93c7de9c2c5582f3d54d1834980aeb14f9bd3aec5d7` | 225 |
| `companion-webp.oipet` | 631,224 | `aad23b40ccbac843384cc6141b2d7634c9b4a740e78714359873bc191c5c56e2` | 228 |

### 20 次切换测量

| 源类型 | 次数 | 总耗时 | 平均 | 单次最大 |
| --- | ---: | ---: | ---: | ---: |
| v1 PNG | 5 | 1,329 ms | 266 ms | 343 ms |
| VRM | 5 | 4,713 ms | 943 ms | 1,060 ms |
| v2 PNG | 5 | 13,413 ms | 2,683 ms | 2,975 ms |
| v2 WebP | 5 | 1,875 ms | 375 ms | 483 ms |

这是单台 Windows 10 x64、Electron 45 / Chromium 156、软件渲染、临时 profile 的一次运行；耗时包含模型加载和 IPC，不是跨硬件保证，也不是长期内存泄漏证明。资源样本只跨 20 次选择，见 `result.json` 的 `resources` 和 `switches.stats`。

### 产物

```text
artifacts/web-package/run-20261023034826/
  companion-vrm.oipet / companion-v1.oipet / companion-v2.oipet / companion-webp.oipet
  invalid-truncated.oipet / invalid-wrong-file.oipet / invalid-wrong-source.oipet
  atlas-v2.webp
  profile-a-empty.png / profile-a-imports.png / profile-b-restored.png
  profile-b-after-switches.png / profile-b-after-refresh.png
  result.json
```

## 第二轮：D22 只读复核

复核新容器入口、桌面保存 IPC、候选加载/存储失败/取消/关闭、跨窗口旧结果和重复恢复。容器与 IPC 未发现可确认的阻断缺陷；发现 **1 个非阻断、可复现的数据一致性缺陷**：恢复流程先执行 `library.add`（独立事务），随后才 `library.activate`；若激活失败，或取消落在“add 已提交、add promise 尚未返回”的窄窗口，库内会留下未激活条目。当前角色、active 指针和画面仍保持原角色。

复现证据（故障注入，不改主程序文件）：

```text
artifacts/web-package/half-write/result.json
artifacts/web-package/half-write/half-write.png
artifacts/web-package/half-write/cancel-result.json
artifacts/web-package/half-write/cancel-half-write.png
```

详细路径/行号、复现步骤、期望/实际和影响见 `docs/DEEPSEEK_REVIEW_04.md`。修复方向是仅在本次确实新增条目时，对激活/提交失败做回滚，或提供原子的新增并激活接口；不得误删既有重复条目。

## 最终校验

在本机仓库根目录最后执行：

```bash
npx tsc --noEmit
npx vitest run tests/character-package.test.ts
```

- `npx tsc --noEmit`：通过，退出码 0，无诊断输出。
- `npx vitest run tests/character-package.test.ts`：21/21 通过，1,828 ms。
- `node scripts/character-package-smoke.mjs`：最后重跑通过；输入/容器哈希与上表一致。
- `node scripts/web-package-smoke.mjs`：通过，证据为 `artifacts/web-package/run-20261023034826/result.json`。

## 未执行项与边界

- 未在外部 Chrome/Edge、真实 LAN、手机或多屏/不同 DPI 上验收；D21 的临时 Electron Chromium 与 Playwright 下载替代路径不等同于这些环境。
- 未做一小时 soak、能耗、低端设备或长期内存泄漏证明；D21 只记录 20 次选择的短样本。
- 未运行主 `scripts/smoke.mjs`、`scripts/phase-four-smoke.mjs`、打包/发布脚本或生产 Windows 包；这些由 Codex 收尾。Codex 的桌面原生保存/重启证据见 `artifacts/phase-04/run-1792725777693/result.json`，本轮未重跑。
- 未做 ChatGPT 官方预检、上传、安装或替换用户宠物；容器结构通过不能替代平台验收。
- D22 缺陷未由 DeepSeek 修复，按所有权交 Codex；未修改 `src/**`、`electron/**`、`packages/character-library/**`。未提交、未推送。
- 未使用 Fred 或 Shiro；测试输入只来自 `public/models/demo.vrm`、既有 run-04 图集、model-library 的 AvatarSample_B 和生成 WebP；备份/截图/`.oipet` 只在忽略的 `artifacts/`。
