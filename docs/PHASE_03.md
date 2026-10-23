# 阶段 03：日常设置、角色管理与精灵图桌宠

日期：2026-10-23。基线 `402bbf8`，分支 `codex/desktop-prototype`，共享目录 `E:\GitWorkSpace\OiGptPet`。

用户授权 Codex 与外部 DeepSeek 继续分工开发。DeepSeek 仍由用户转交任务，不在本会话另建或假冒 DeepSeek 代理。上一阶段已推送；本阶段按文件所有权协作，阶段结束统一验证、提交并暂停。

额度约束：用户要求至少保留 20% 账号额度。Codex 已查询起始状态为 5 小时窗口剩余 88%、周额度剩余 98%；按开发批次复查，接近 25% 时优先保存并停止新增工作，为收尾留余量，不启动预计会耗尽余量的大批量验证。外部 DeepSeek 的账号额度需其自行核对，不能由 Codex 的读数推断。

## 目标与顺序

让已有原型更适合日常使用：可设置桌宠大小和性能模式，可保存与切换多个本地角色，并增加 PNG/WebP 精灵图桌宠路径。保持 VRM 导出和本地检查可用。

1. Codex 先实现设置持久化、窗口同步和绘制频率控制；DeepSeek 同时实现无宿主依赖的精灵图渲染器。
2. DeepSeek 实现独立角色库与旧数据迁移接口；Codex 负责旧数据读取、切换界面、Electron 接线及渲染失败回退，保留原有单模型用户数据。
3. DeepSeek 交付后由 Codex 接入精灵图导入、运行模式选择、桌宠互动和数据保存。
4. 运行针对设置、迁移、切换、导出、精灵图播放和发布包的检查；记录实际性能和未测硬件场景。

本阶段不自动上传角色或安装 ChatGPT 宠物，不把目标平台验收写为已完成；对话、语音与 Live2D 留待后续。Fred 不纳入候选或测试；所有本地源模型、精灵图和产物不提交、不进入默认发布包。

## 文件所有权

| 负责人 | 可修改范围 | 任务 |
| --- | --- | --- |
| Codex | `src/**`、`electron/**`、根配置/依赖版本、README、`docs/PHASE_03.md`、`docs/CHECKPOINT_03.md`、`docs/DEEPSEEK_PHASE_03.md` | 主程序设置、性能调度、角色管理、IPC、持久化迁移、渲染器接线 |
| Codex | `tests/desktop-preferences.test.*`、`tests/frame-pacer.test.ts`、`tests/model-library.test.*`、`scripts/smoke.mjs`、`scripts/release-smoke.mjs`、`scripts/package.mjs`、`scripts/distribution.mjs` | 主集成与发布回归 |
| DeepSeek | `packages/renderer-sprite/**`、`tests/renderer-sprite.test.ts`、`tests/fixtures/renderer-sprite/**`、`scripts/renderer-sprite-smoke.mjs`、`docs/RENDERER_SPRITE.md`、`docs/DEEPSEEK_DELIVERY_03.md` | 独立播放引擎、透明命中、测试与真实图集验证 |
| DeepSeek | `packages/character-library/**`、`tests/character-library.test.ts`、`tests/fixtures/character-library/**`、`scripts/character-library-smoke.mjs`、`docs/CHARACTER_LIBRARY.md`、`docs/DEEPSEEK_DELIVERY_03_LIBRARY.md` | D14–D16：独立 IndexedDB 角色目录、字节迁移接口、原子性和独立验证 |
| DeepSeek | `scripts/web-library-smoke.mjs`、`docs/DEEPSEEK_WEB_QA_03.md`、`docs/DEEPSEEK_REVIEW_03.md` | D17–D18：最后一批，仅浏览器主程序验证与只读集成复核 |

`docs/DEEPSEEK_PHASE_03_LIBRARY.md` 由 Codex 维护。角色库使用独立数据库；DeepSeek 不修改旧 `src/model-store.ts` 或 Electron 存储，Codex 后续负责适配，避免双方竞争持久化入口。

`packages/target-chatgpt/contract.ts`、`atlas-tools`、`atlas-preview`、`character-core`、`renderer-vrm` 和 `pet-exporter` 的现有契约冻结。确有阻断问题时报告具体文件、复现和建议，由 Codex 协调修复；双方不抢改文件、不格式化全仓库。DeepSeek 不更新根 package/lock、运行主 smoke、打包、提交或推送。

## Codex 任务

- **C1 设置与性能**：工坊提供小/标准/大三档桌宠大小和画质/均衡/省电三种性能模式；设置重启保留、窗口间同步，损坏设置回退默认值。性能模式限定绘制上限、闲置绘制频率及像素倍率，隐藏时不绘制，恢复时不跳过大量动画时间。实际能耗改善须以测量为准。
- **C2 角色管理**：从“一个 current 模型”升级为本地角色目录，支持命名、选中、切回、移除目录项和失败回退。旧版本 current.vrm/IndexedDB 数据有明确迁移；删除目录项不删除用户原文件。用稳定身份和受控路径保存，不将角色信息或目录暴露到局域网主机。
- **C3 精灵图接线**：按下面稳定接口加载图集；主程序持有唯一动画调度器，切换模式释放旧 VRM/WebGL 或 Bitmap，导出按钮按源类型适配。精灵图资源以原 Blob 保存和复核，不伪装成源 VRM。
- **C4 联调与检查点**：两种桌宠模式的拖动、穿透、恢复、缩放、重启恢复；失败导入、反复切换与取消；默认包仍无模型；明确哪些长时间、多屏/DPI 和目标平台项目尚未测试。

## DeepSeek 任务

可直接转发 [DeepSeek 阶段三任务](DEEPSEEK_PHASE_03.md)。D11–D13 先独立完成，不等待 Codex UI，也不代做主程序集成。

2026-10-23 最终对齐：D11–D18 全部交付，用户确认 DeepSeek 完成。Codex 接线与回归通过，并修复 D18 的画布尺寸继承问题，最终 169 项测试通过。双方停止新增产品功能，按 [检查点](CHECKPOINT_03.md) 统一提交、推送，并执行用户追加的三个版本 GitHub Release 发布；完成后暂停。DeepSeek 原始复核保留修复前证据，修复后浏览器布局结果见检查点。

## 验收与暂停条件

用户已授权 Codex 继续开发并在双方对齐后统一提交、推送 GitHub。当前共同检查点固定为：**设置持久化 + 角色库迁移/管理 + VRM/精灵图桌宠切换 + 失败回退 + 重启恢复**。DeepSeek 完成 D14–D16 后停止修改其文件并交付，Codex 验收接口、接线、运行独立及主程序/发布包验证，再整理阶段提交并推送 `origin/codex/desktop-prototype`；推送完成后暂停，不扩展到对话/语音等新阶段。若交付尚未到齐，不将未验证部分提交为完成。

- [x] 设置可操作、保存及跨窗口同步；无效输入被拒绝，重启/损坏文件有合理行为。
- [x] 绘制节流、闲置/隐藏/恢复的单测和实际省电绘制探针通过；不将帧率上限称为实测耗电改善。
- [x] 当前模型数据可迁移为角色目录，多个角色可切换，失败不覆盖当前可用角色。
- [x] 有效 v1/v2 PNG/WebP 可加载并用于桌宠渲染路径；无效结构/超限文件被拒绝。
- [x] 精灵图按完整单格显示，跳跃位移保留，v2 视线可切换；透明位置命中正确。
- [x] 专项覆盖反复导入、切换、关闭、取消及过期结果；组件资源探针计数平衡，长期稳定性另行验证。
- [x] 既有 85 项回归、新增测试、主 smoke、生产构建与发布包检查通过。
- [x] 角色、许可和本地结构检查与 ChatGPT 官方接受状态保持区分。

本阶段以 `docs/CHECKPOINT_03.md` 为实际交付和缺项记录；未交付的勾选项不因任务已分配而视为完成。
