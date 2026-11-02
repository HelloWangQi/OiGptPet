# 给 DeepSeek：阶段四单角色备份与恢复（D19–D22）

2026-10-23。共享目录 `E:\GitWorkSpace\OiGptPet`、分支 `codex/desktop-prototype`，基线 `e8069ba`。先读 `PHASE_04.md`。本文件是下一阶段任务，可按两轮执行，不等待每项完成后再由用户分配零碎新活。

## 共同终点与所有权

交付一个 `.oipet` 文件，可在新的浏览器或桌面数据目录恢复同一角色、名称及图集规格；Codex 接界面、Electron、候选渲染器与角色库，你负责独立容器模块和浏览器验收。只做单个角色，不做整库、云同步或 ChatGPT 上传。

仅新增/修改以下范围：

```text
packages/character-package/**
tests/character-package.test.ts
tests/fixtures/character-package/**
scripts/character-package-smoke.mjs
scripts/web-package-smoke.mjs
docs/CHARACTER_PACKAGE.md
docs/DEEPSEEK_DELIVERY_04.md
docs/DEEPSEEK_REVIEW_04.md
```

其他文件只读；尤其不要改 src、electron、character-library、已有 renderer/atlas 包、根配置/依赖、旧 smoke 和阶段三说明。不增加依赖，不提交/推送，不上传角色，不碰 5173 或主用户数据。Fred 不用于测试；源模型、图集和 `.oipet` 产物只放忽略目录。

## 第一轮 D19：固定格式和 API

从 `packages/character-package/index.ts` 导出：

```ts
import type { CharacterInput, CharacterAsset } from '../character-library';

export interface CharacterPackageResult {
  blob: Blob;           // 完整容器
  sha256: string;       // 完整容器实际摘要
  encodedBytes: number; // 完整容器实际大小
}
export interface DecodedCharacterPackage {
  input: CharacterInput; // 带名称，恢复交给现有角色库再验证
  assetSha256: string;
  packageSha256: string;
  encodedBytes: number;  // 完整容器大小
}
export function encodeCharacterPackage(asset: CharacterAsset, signal?: AbortSignal): Promise<CharacterPackageResult>;
export function decodeCharacterPackage(blob: Blob, signal?: AbortSignal): Promise<DecodedCharacterPackage>;
```

API 不依赖 DOM/Electron、渲染器、文件系统、网络或内部循环；可复用现有摘要函数。通过容器检查不等于源 VRM/图集已可渲染；解码不自动入库、激活或下载。由 Codex 调用现有库和 renderer 完成源内容验证。

固定二进制容器版本 1：

1. 前 8 字节 ASCII `OIPET001`。
2. 接下来 4 字节为小端 uint32 的 UTF-8 清单长度。
3. 清单长度 1–65,536 字节，后面紧跟唯一一个原始资产 payload，不允许尾随字节。
4. 清单 JSON 固定字段：`format: 'oigptpet-character'`、`schemaVersion: 1`、`name`、`kind: 'vrm'|'sprite'`、`mime`、`encodedBytes`（仅 payload）、`sha256`（仅 payload），以及 sprite 必需的 `profile: 'v1'|'v2'`。VRM 不携带 profile。未知 schemaVersion、非法/未知字段或错误类型拒绝，不做宽松猜测。字段顺序编码时固定并写入契约。
5. 名称按现有规则 trim 后 1–80 字符；mime 对 VRM 固定 `model/gltf-binary`，对 sprite 为 `image/png` 或 `image/webp`。编码 VRM 可规范化 Blob MIME，但 payload 字节不变；解码 Blob 使用清单 MIME。
6. payload 为非空、大小精确的原始数据：VRM ≤64 MiB，sprite ≤20 MiB。整个文件最大 `12 + 65,536 + 64 MiB`。读取完整 Blob 前先限制体积，读取 manifest 前检查头/边界，之后按 kind 施加更小的资产上限。整数必须为 safe integer，不接受负数、NaN、无穷或溢出声明。
7. 摘要小写十六进制 64 位，必须来自实际 payload 字节；编码时复核条目摘要和大小，矛盾拒绝。解码重新计算后比较，完整容器另算摘要。兼容现有局域网摘要回退，不信任扩展名。

不要加入目录路径、账户、密码、执行脚本、自动下载 URL 或渲染数据。容器只保存上述信息与原文件；VRM 作者/许可信息继续由源文件静态检查读取，sprite 的外部说明由用户自行保管，不虚构作者或再分发权限。

取消遵循已有摘要函数约定：耗时步骤前后检查 signal，取消拒绝 AbortError，模块不创建 Object URL、Bitmap 或持久化记录。导出错误码与可理解消息；格式错误与用户取消区分。实现前在 `contract.ts` 和模块文档写清大小/边界常量，Codex 可按本签名同步接线；确需变更接口先报告。

## 第一轮 D20：独立验证

- 覆盖头、长度、UTF-8/JSON、字段/版本/类型、名称/profile/MIME、溢出/超限/截断/尾随、摘要不符、取消和实际字节保留；重点断言解码结果与原始资产，不写只复制实现公式的测试。
- 独立 fixture/smoke 使用随机端口、独立缓存和临时 profile；不触碰主应用数据。用真实 VRM、真实 v1/v2 PNG 与生成的 WebP 做 encode → decode → 原库 add 的验证；原库仍须做源文件检查。
- 测试输入可用 `public/models/demo.vrm`、已有 run-04 两份 PNG；WebP 由测试编码生成并记录新哈希。所有输出放新的 `artifacts/character-package/` 运行目录，不覆盖旧证据。
- 运行 `npx tsc --noEmit`、针对新模块的 vitest 和独立 smoke；共享主程序未接完导致的其他范围错误记录，不抢改。

第一轮交付时在 `DEEPSEEK_DELIVERY_04.md` 标记接口/独立验证完成，冻结核心 API，再直接进入第二轮。不要把核心交付称为用户流程已完成。

## 第二轮 D21：真实浏览器恢复与重复切换

等 Codex 的备份按钮/导入入口可用后执行；主界面选择器以 Codex 接线记录为准，不自行增加调试全局对象。

- 在不暴露 petDesktop 的 Chromium 页面测试真实主程序。用 profile A 通过 UI 导入、改名并备份角色；捕获实际下载文件。profile B 用干净用户目录从 UI 恢复，验证名称、规格、原始字节摘要和画面；刷新后仍能恢复。
- 覆盖 VRM 和两种规格图集，包含实际 WebP；同包重复恢复不增加条目，已有别名保留。错误文件或错误源类型不替换当前角色；恢复精灵图后禁用源 VRM 导出，切回 VRM 后恢复导出。
- 用真实角色通过 UI 合计切换 20 次，记录源类型、耗时、pageerror 和内存/资源探针的测量条件。没有可靠内存接口时明确未测，不用短时间样本宣称长期无泄漏。
- 不要求等待一小时 soak；也不将本轮测试等同于外部 Chrome/Edge、手机或多屏/DPI 通过。
- 新脚本仅负责浏览器路径，不运行主 smoke、打包或发布。产物写新 `artifacts/web-package/` 子目录。

## 第二轮 D22：只读复核与最终交付

复核新容器入口、桌面保存 IPC、候选加载/存储失败/取消/关闭、跨窗口旧结果和重复恢复。发现问题只写具体路径/行号、复现、实际/期望和影响，交 Codex；不要改其文件。主程序尚未准备好时可先检查已落盘部分，等接口可用补完 D21。

`CHARACTER_PACKAGE.md` 写 API、格式与边界；`DEEPSEEK_DELIVERY_04.md` 汇总两个轮次的实际命令、文件、输入/容器哈希、产物和未执行项；`DEEPSEEK_REVIEW_04.md` 写可确认缺陷或无阻断结论。

两轮完成后停止编辑，等 Codex 汇总、必要修复、Windows 包和阶段提交，不另行扩展任务。Codex 也以同一检查点收尾，不把下一阶段功能继续加到本阶段。
