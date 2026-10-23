# 角色备份容器 `.oipet`

实现日期：2026-10-23。`packages/character-package` 是浏览器与 Electron renderer 共用的单角色备份容器模块，负责把角色原始文件编码为 `.oipet`，以及从 `.oipet` 严格解码出可交给角色库的 `CharacterInput`。它不依赖 Node、Electron、文件系统、网络、渲染器或播放循环，只使用 Blob、TextEncoder/TextDecoder、AbortSignal 和 `packages/atlas-preview/sha256.ts`。

容器校验不等于源文件可渲染：解码通过只证明容器结构、声明和摘要一致；VRM 解析、图集结构检查、入库、激活和画面替换仍由现有角色库与渲染器完成。解码不会自动入库、激活、下载、创建 Object URL/Bitmap 或写入持久化记录。

## 文件

```text
packages/character-package/contract.ts    常量、清单类型、错误类型与字段顺序
packages/character-package/index.ts       encodeCharacterPackage / decodeCharacterPackage
tests/character-package.test.ts           21 项单元测试
tests/fixtures/character-package/         真实 IndexedDB 与取消场景 fixture
scripts/character-package-smoke.mjs       独立 Playwright/Electron smoke
docs/CHARACTER_PACKAGE.md                 本文件
```

## 公开接口

```ts
import type { CharacterAsset, CharacterInput } from '../character-library';

export interface CharacterPackageResult {
  blob: Blob;            // 完整容器，type = application/octet-stream
  sha256: string;        // 完整容器的实际 SHA-256，小写十六进制
  encodedBytes: number;  // 完整容器实际字节数
}

export interface DecodedCharacterPackage {
  input: CharacterInput; // 带清单中的 name；sprite 另带 profile
  assetSha256: string;   // payload 实际摘要
  packageSha256: string; // 完整容器实际摘要
  encodedBytes: number;  // 完整容器实际字节数
}

export function encodeCharacterPackage(
  asset: CharacterAsset,
  signal?: AbortSignal,
): Promise<CharacterPackageResult>;

export function decodeCharacterPackage(
  blob: Blob,
  signal?: AbortSignal,
): Promise<DecodedCharacterPackage>;
```

`contract.ts` 另导出：

- 常量：`CHARACTER_PACKAGE_MAGIC`、`CHARACTER_PACKAGE_HEADER_BYTES`、`CHARACTER_PACKAGE_FORMAT`、`CHARACTER_PACKAGE_SCHEMA_VERSION`、名称/清单/payload/整包上限、MIME 常量。
- 类型：`CharacterPackageManifest`、`VrmPackageManifest`、`SpritePackageManifest`、`CharacterPackageResult`、`DecodedCharacterPackage`、`CharacterPackageErrorCode`。
- 类：`CharacterPackageError`，带稳定 `code` 和可选 `cause`。
- 冻结契约：`CHARACTER_PACKAGE_CONTRACT`。
- 字段顺序：`VRM_MANIFEST_FIELD_ORDER`、`SPRITE_MANIFEST_FIELD_ORDER`。

核心接口自 D20 通过后冻结；本阶段没有改变签名。确需扩展时应新增版本，不在 v1 内做宽松兼容。

## 二进制格式 v1

```text
偏移        长度                 内容
0           8                    ASCII "OIPET001"
8           4                    小端 uint32：UTF-8 清单字节数
12          manifestLength        UTF-8 JSON 清单
12 + N      encodedBytes          唯一一个原始资产 payload
```

- 清单长度 1–65,536 字节。
- payload 非空；整个容器必须恰好等于 `12 + manifestLength + encodedBytes`，截断或尾随字节一律拒绝。
- 整个容器上限 `12 + 65,536 + 64 MiB = 67,174,412` 字节。
- 不保存目录路径、账户、密码、执行脚本、自动下载 URL、渲染数据、作者/许可声明或整库信息；只保存单个角色原始文件、名称、类型、必要规格、MIME、字节数和摘要。

### 清单字段

固定字段顺序（编码时按此顺序写入；字段值类型严格）：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `format` | 字符串 | 固定 `oigptpet-character` |
| `schemaVersion` | 整数 | 固定 `1`；其他值拒绝 |
| `name` | 字符串 | trim 后 1–80 个 Unicode code point |
| `kind` | `'vrm' \| 'sprite'` | 源类型 |
| `mime` | 字符串 | VRM 固定 `model/gltf-binary`；sprite 为 `image/png` 或 `image/webp` |
| `encodedBytes` | 正整数 | 仅 payload 字节数，必须为 safe integer |
| `sha256` | 64 位小写十六进制 | 仅 payload 的实际 SHA-256 |
| `profile` | `'v1' \| 'v2'` | 仅 sprite 必需；VRM 禁止携带 |

VRM 清单示例：

```json
{"format":"oigptpet-character","schemaVersion":1,"name":"搭档","kind":"vrm","mime":"model/gltf-binary","encodedBytes":10776032,"sha256":"12c2b97e95e700783a6a550dc0eee2d7880aeedccef9ae67bc4c5a2f0f2631a2"}
```

sprite 清单在末尾增加 `profile`。`JSON.stringify` 按上述插入顺序输出；解码不依赖字段顺序，但拒绝未知字段、错误类型、错误 MIME、错误 profile 和未知版本。

## 边界与校验

### 名称与 MIME

- 名称先 `trim`，再按 Unicode code point 计数，必须为 1–80；只含首尾空白的名称拒绝。
- VRM 的 Blob MIME 可以是空或任意值：编码时清单规范化为 `model/gltf-binary`，payload 字节不变。
- sprite 的 Blob MIME 按 `;` 前的基础类型小写比较，只接受 `image/png` / `image/webp`；解码后的 Blob 使用清单 MIME。
- 不接受扩展名推断；`.oipet` 内 manifest 是唯一类型来源。

### 大小

| 项 | 上限 |
| --- | ---: |
| 名称 | 80 code points |
| 清单 | 65,536 字节 |
| VRM payload | 64 MiB（67,108,864 字节） |
| sprite payload | 20 MiB（20,971,520 字节） |
| 完整容器 | 67,174,412 字节 |

读取完整 Blob 前先检查容器上限；读取清单前检查头、magic、清单长度和剩余边界；解析清单后按 `kind` 施加更小的 payload 上限。所有整数必须是 safe integer；负数、NaN、Infinity、溢出声明和声明大小与实际不一致都拒绝。

### 摘要

- `sha256` 必须为 64 位小写十六进制，来自实际 payload 字节。
- 编码时复核 `asset.summary.encodedBytes === blob.size`、`asset.summary.sha256 === sha256(payload)`；矛盾拒绝。
- 解码时重新计算 payload 摘要并比较清单，再计算完整容器摘要；任一不符拒绝。
- 复用 `packages/atlas-preview/sha256.ts`：优先 Web Crypto，缺少/失败时使用可分块让出事件循环的纯 JS 回退。

### 错误码

`CharacterPackageError.code` 为以下之一，消息为可读中文；取消使用 `DOMException` 的 `AbortError`，不与格式错误混淆。

```text
invalid-input
invalid-container
invalid-manifest
unsupported-version
invalid-name
invalid-kind
invalid-profile
invalid-mime
invalid-size
too-large
hash-mismatch
```

## 编码流程

`encodeCharacterPackage(asset, signal)`：

1. 检查 signal；校验 `asset.summary` 与 `asset.blob` 形状。
2. 检查 Blob 大小为正 safe integer，kind 合法，payload 不超过对应上限。
3. 校验 summary 的 `encodedBytes`、`sha256`、`name`、`profile` 与类型一致；sprite 校验 Blob MIME。
4. 读取 `blob.arrayBuffer()`，核对实际长度，重新计算 payload 摘要并与 summary 比较。
5. 按固定字段顺序构造清单，写入 magic、清单长度和 payload。
6. 计算完整容器摘要，返回 `Blob`（`application/octet-stream`）和实际大小/摘要。

编码不会重新编码 PNG/WebP，也不会转换 VRM；payload 是原始字节。清单名称使用 trim 后的值；VRM 的 Blob MIME 被规范化，但 payload 不变。

## 解码流程

`decodeCharacterPackage(blob, signal)`：

1. 检查 signal；校验 Blob 形状、正大小和整包上限。
2. 读取 12 字节头，检查 magic、清单长度和是否至少有一个 payload 字节。
3. 读取清单，严格 UTF-8 解码和 JSON 解析；校验 format、schemaVersion、kind、profile、字段集合、名称、MIME、encodedBytes、sha256。
4. 按 kind 检查 payload 上限；按清单计算期望总大小，必须等于 Blob 实际大小（拒绝截断和尾随）。
5. 读取完整容器，定位 payload，重新计算 payload 摘要和完整容器摘要。
6. 返回带名称（sprite 另带 profile、清单 MIME）的 `CharacterInput` 及两个摘要。

解码不检查 payload 是否真能作为 VRM/图集渲染；调用方必须把 `input` 交给角色库和渲染器再次验证。典型调用：

```ts
const decoded = await decodeCharacterPackage(file, signal);
const added = await library.add(decoded.input, signal);
await library.activate(added.id);
// 再由 CompanionStage.prepare(...).commit() 替换画面
```

上面的 `add`/`activate` 是示意，实际主程序使用候选加载 → 入库 → 激活 → 替换画面的顺序。入库和激活的原子性由调用方负责；模块不提供事务回滚。D22 复核发现当前主程序在“add 已提交、activate 失败”的路径会留下未激活条目，属于主程序集成边界，详见 `DEEPSEEK_REVIEW_04.md`。

## 取消

- 每个公开函数接受可选 `AbortSignal`；已在耗时步骤前后检查。
- 取消时抛出 `DOMException`，`name === 'AbortError'`。
- 解码在读取头、清单、完整容器和计算摘要前后检查取消；编码在读取 payload、计算摘要和返回前检查。
- 取消不会创建 Object URL、Bitmap 或持久化记录；已返回的结果不受后续 abort 影响。
- 调用方仍需处理自己的持久化取消语义；模块不能撤销调用方已经完成的 `library.add`。

## 集成边界

- 浏览器：主程序从 `#package-file` 选择 `.oipet`，先解码，再把 `input` 交给现有 `load`；备份时用当前 active 条目编码，并通过 Blob `<a download>` 下载为 `OiGptPet-character.oipet`。
- 桌面：渲染器把编码后的字节、整包摘要和一次性操作 ID 交给 `petDesktop.saveCharacterPackage`；主进程校验发送方、大小、magic、清单长度和整包摘要，写临时文件后原子 rename。取消、窗口关闭和迟到结果由主进程与 renderer 的 package job 共同处理。
- 容器模块不读取 `File.name`、本机路径、旧 `oigptpet` 数据库或 `current.vrm`；名称只来自角色库 summary 或清单。
- 备份文件包含用户角色的原始副本；由用户选择保存位置，测试产物只放忽略目录。

## 测试与证据

- `npx vitest run tests/character-package.test.ts`：21 项通过，覆盖头、字段顺序、长度、UTF-8/JSON、版本/类型/名称/profile/MIME、超限/截断/尾随、摘要不符、取消和实际字节保留；真实输入为 demo VRM 与 v1 PNG。
- `node scripts/character-package-smoke.mjs`：在独立 Vite + Electron fixture 中用真实 VRM、v1/v2 PNG 和生成 WebP 完成 encode → decode → 真实 IndexedDB `add`，并验证取消与错误码；结果见 `artifacts/character-package/run-01/result.json`。
- D21 主界面验收在无 `petDesktop` 的 Chromium 页面完成 4 种角色备份/干净 profile 恢复、重复别名保留、错误文件回退和 20 次切换；见 `docs/DEEPSEEK_DELIVERY_04.md` 与 `artifacts/web-package/run-20261023034826/result.json`。
