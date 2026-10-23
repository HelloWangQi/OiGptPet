# 给 DeepSeek：阶段三最后一批收尾（D17–D18）

2026-10-23。共享工作区 `E:\GitWorkSpace\OiGptPet`，分支 `codex/desktop-prototype`。用户要求双方尽量同步完成、尽早形成阶段提交。本批不增加产品功能，完成后停止编辑，交 Codex 统一提交并推送 GitHub。

## 已对齐的事实

- D11–D16 两份交付已收到。渲染器与角色库现有接口保持不变，相关包/原有测试/说明暂时冻结。
- Codex 已接入角色库界面、改名/移除、VRM 与精灵图桌宠、窗口同步、旧 Electron 文件迁移及重启恢复。
- 当前全量 **12 文件、168 测试通过**。`scripts/phase-three-smoke.mjs` 已验证实际 Electron 迁移、反复切换、渲染失败/存储失败回退、取消、桌宠同步和重启；结果在 `artifacts/phase-03/run-1792721715398/result.json`。
- 原主 smoke 也已通过：v1/v2 导出与精确哈希、无效格保存门控、取消重开和透明置顶桌宠。
- 尚缺浏览器旧 IndexedDB 迁移的主界面证据、主界面 WebP 路径、最终发布包验证与收尾复核。

## D17：浏览器主程序验收

你只新增：

```text
scripts/web-library-smoke.mjs
docs/DEEPSEEK_WEB_QA_03.md
```

验证真实 `src/main.ts` 页面，不用独立角色库 fixture 代替主程序。可仿照已有 smoke 创建临时 Electron 应用作为 Chromium 浏览器，**不设置本项目 preload，不暴露 petDesktop**；临时 userData、随机端口和独立 Vite 缓存，监听 `127.0.0.1`，不碰 5173 或主数据。Vite `define` 可显式设 `__WITH_DEMO__: 'false'`，避免示例自动加载掩盖空状态；不改现有配置或源文件。

一次覆盖以下关键场景即可，不扩展成新框架：

1. 旧库 `oigptpet` 版本 1、`models` store 的 `current` key 写入真实 VRM ArrayBuffer；重新打开主页面后自动迁移到新角色库。验证名称/实际字节摘要与 active、旧库字节保持不变。可使用本地 `public/models/demo.vrm`，不要使用 Fred。
2. 在主界面改名、刷新或完整重启，确认名字/active 保留且迁移不重复。`window.petDesktop` 缺失；“放到桌面”和大小设置禁用，浏览器仍可正常预览和导入。
3. 用已有真实 v1/v2 PNG 构造 WebP **测试输入**，通过主界面文件输入导入（不是直接调用库 add）。验证规格正确、Canvas 2D 有实际不透明像素、源 VRM 导出按钮禁用、刷新后恢复。记录实际 WebP 哈希，不复用 PNG 的摘要。
4. 错误规格/损坏文件不替换当前角色。切回已迁移 VRM 后源导出按钮恢复。收集 pageerror，结束时应为空。

运行 `node --check scripts/web-library-smoke.mjs` 和新 smoke；无需重复所有单测/原导出 smoke/打包。产物写入新的 `artifacts/web-library/` 运行目录，不覆盖已有证据。临时目录清理前核验路径确属本次创建位置。说明这验证的是 Chromium 浏览器代码路径，不冒充外部 Chrome/Edge 或真实 LAN 手机测试。

## D18：只读集成复核

仅新增 `docs/DEEPSEEK_REVIEW_03.md`。只读检查这些接入边界：

- `src/companion-stage.ts`：新画布替换、旧资源释放、加载失败/取消/过期结果、commit 前后生命周期。
- `src/main.ts`：先加载后激活、库写失败保留旧画面、窗口通知、恢复源类型、精灵图不能伪装成源 VRM 导出。
- `electron/preferences.cjs` 及设置接线：非法设置拒绝、保存失败/并发更新、重启和损坏设置回退。

只报告可复现且影响本阶段的缺陷，给具体文件/行号、触发步骤、期望和实际结果；没有问题可写“未发现可确认的阻断缺陷”，不要补泛泛建议。发现问题不改主程序，交 Codex 修复。不要把“未跑/未测”写成代码必有缺陷。

## Codex 同期收尾与交付门槛

Codex 负责设置专项 smoke、生产构建、Windows 包与包内首次启动/导入/重启检查；复核你的结果、处理确有必要的缺陷，更新 `CHECKPOINT_03.md` 和主计划。最终检查双方文件未继续变化后，统一提交并推送 `origin/codex/desktop-prototype`，随后暂停。

你的可写范围严格为上述 **一个脚本、两份文档**。不修改 src/electron/packages/既有测试/根配置与依赖，不提交或推送，不上传或激活 ChatGPT 宠物。不再自行追加 D19 或新功能。交付说明写清命令、产物位置、结果和未执行项；完成后停止编辑并告知用户。
