# 阶段 02：模型版本与许可核对记录

核对日期：2026-10-22。本文只记录可复核的事实和当前阻塞，不把“看过资料”写成“已加载”，也不把“本地结构检查通过”写成“目标平台预检或安装通过”。

状态含义：

- **资料确认**：已读取权利方/官方发布页，记录了版本、来源和条件。
- **文件已取得**：本机存在实际文件，并已计算内容哈希。
- **程序已加载**：应用实际读取并渲染了该文件。
- **最终图集已导出并验证**：从该模型导出的最终编码图集已用 `inspectAtlas` 检查，并在预览中逐帧核对。

## 状态总表

| 模型 | 资料确认 | 文件已取得 | 程序已加载 | 最终图集已导出并验证 |
| --- | --- | --- | --- | --- |
| `VRM1_Constraint_Twist_Sample`（首个回归模型） | 是 | 是 | 是（阶段 01 记录） | 是（阶段 01 记录） |
| AvatarSample_A 的 VRM 1.0 导出版（第二模型） | 是 | 否 | 否 | 否 |
| AvatarSample_B（最终改用的第二模型） | 是 | 是 | 是（最终独立渲染） | v1/v2 结构与静态图已检查，连续播放人工验收未做 |

原计划 AvatarSample_A 仍未取得；最终集成改用 pixiv 官方 ChatVRM 仓库发布的 AvatarSample_B VRM 1.0，已完成实际加载、v1/v2 编码导出及检查，见下方最新补充。后续关于 AvatarSample_A 的获取阻塞仍按原记录保留，不应解读为 AvatarSample_B 也未取得。

## 最终集成补充：AvatarSample_B 与本地模型选择

用户要求下载免费模型后，Codex 从 pixiv 官方仓库取得真正不同的角色 AvatarSample_B，没有改名或转换首个回归模型。

| 项目 | 实际结果 |
| --- | --- |
| 文件 | `artifacts/model-library/2026-10-22/AvatarSample_B.vrm`，21,047,556 字节，本地文件不提交 |
| 官方来源 | https://github.com/pixiv/ChatVRM/blob/main/public/AvatarSample_B.vrm |
| 源 SHA-256 | `ffbd8c92a9e67c0a948f69c7a2eec91e5c282c9ae70e9184309fc164d74cbc27` |
| 文件元数据 | VRM 1.0，模型名 AvatarSample_B，版本 1.1，作者 VRoid Project，版权 pixiv Inc. |
| 原始许可 | VRM Public License 1.0 与 [VRoid 样例条件](https://vroid.pixiv.help/hc/en-us/articles/4402394424089-VRoidPreset-A-Z)，不是 CC0 |
| 元数据权限 | everyone、commercialUsage corporation、creditNotation unnecessary、allowRedistribution true、allowModificationRedistribution；其他条件见随文件保存的完整元数据 |
| v1 | 1536×1872，57 帧，410,431 字节，结构通过；SHA-256 `1a1bea9991a1c768eb2fd37c2dc90238aeffadc54605a781245dca1c075acd6d` |
| v2 | 1536×2288，73 帧，508,300 字节，结构通过；SHA-256 `f0dd39009dca66b06b89a19169c72b962f2635050b0f91904842c72515728994` |
| 重复/取消/释放 | v2 两次哈希一致；第 3 格取消抛出 AbortError；最终 4 个 WebGL context 全部释放，live=0；无 page/console error |
| 静态检查 | 已看完整图集、十六方向头部、失落与工作联系表；未见单格裁切，跳跃底边 188/178/167/178/188，视线顺序可辨；手臂在本模型上更接近胸前，失落掩面/工作托腮语义弱于首模，保留模型适配 warning |

实际命令：

```powershell
node scripts/animation-render-smoke.mjs --model artifacts/model-library/2026-10-22/AvatarSample_B.vrm --out-dir artifacts/animation-fixes/avatar-b-checkpoint-02
node scripts/atlas-visual-qa.mjs --file artifacts/animation-fixes/avatar-b-checkpoint-02/atlas-v2.png --profile v2 --out-dir artifacts/animation-fixes/avatar-b-checkpoint-02/qa-v2
```

结果保存在上述独立产物目录的 `manifest.json`，不进入 Git。至此首模和 AvatarSample_B 均已通过真实加载、导出和结构检查；本地自动化与静态查看仍不能替代人工连续播放或目标平台官方预检。

另外下载的 Vita、Seed-san 与用户下载的两款 Pyurin 熊少女已通过本地文件检查，但未做完整运行/导出回归。熊少女文件内要求署名，禁止源模型再分发及修改；仅留本机。用户明确排除 Fred，未用于展示或测试，也不提交；Shiro 未下载。所有源 VRM 及模型预览、来源 JSON 均在 Git 忽略目录中，不进入发布包。

## 1. 首个回归模型：VRM1_Constraint_Twist_Sample

本阶段复核了本机文件的只读信息和内容哈希；没有重新运行主应用冒烟测试。

| 项目 | 值 |
| --- | --- |
| 本机文件 | `public/models/demo.vrm`（本地开发文件，未提交 Git） |
| 文件大小 | 10,776,032 字节 |
| SHA-256 | `12c2b97e95e700783a6a550dc0eee2d7880aeedccef9ae67bc4c5a2f0f2631a2` |
| glTF 资产版本 | `2.0` |
| VRM 规范 | `VRMC_vrm.specVersion = "1.0"` |
| 模型元数据版本 | `meta.version = "v1.0.1"` |
| 模型名 | `VRM1_Constraint_Twist_Sample` |
| 作者 | `pixiv Inc.` |
| 原始来源 | https://github.com/pixiv/three-vrm/tree/dev/packages/three-vrm/examples/models |
| 下载脚本固定地址 | https://raw.githubusercontent.com/pixiv/three-vrm/dev/packages/three-vrm/examples/models/VRM1_Constraint_Twist_Sample.vrm |
| 原始许可 | VRM Public License 1.0，https://vrm.dev/licenses/1.0/ |
| 模型内元数据 | `allowRedistribution: true`；`avatarPermission: everyone`；`commercialUsage: corporation`；`creditNotation: unnecessary`；`modification: allowModificationRedistribution`；`(c) 2022 pixiv Inc.` |
| 取得方式 | `npm run demo:fetch`；脚本校验固定 SHA-256 后写入本机，不自动上传 |
| 来源/许可副本 | `public/models/demo-source.json`、`public/models/README.md` |

阶段 01 的真实运行结果记录在 `docs/CHECKPOINT_01.md`：

- 示例角色成功加载，九类动作按钮可切换；
- 实际导出 v2 PNG 图集 1536×2288，73 个有效格、15 个透明空格；
- 跳跃脚底像素位置 188 / 178 / 167 / 178 / 188，验证离地与回落；
- 该结果只是本地结构与渲染检查，不包含目标平台官方预检或安装。

本阶段复核命令（只读）：

```bash
node -e "const fs=require('fs'),c=require('crypto');const b=fs.readFileSync('public/models/demo.vrm');const n=b.readUInt32LE(12);const j=JSON.parse(b.subarray(20,20+n).toString('utf8'));console.log(c.createHash('sha256').update(b).digest('hex'));console.log(j.extensions.VRMC_vrm.specVersion,j.extensions.VRMC_vrm.meta.name,j.extensions.VRMC_vrm.meta.authors)"
```

结果与上表一致。该命令不修改文件。

## 2. 第二模型：AvatarSample_A 的 VRM 1.0 导出版

### 2.1 已确认的资料

| 项目 | 值 |
| --- | --- |
| 角色/权利方 | AvatarSample_A / VRoid Project（pixiv 株式会社） |
| 官方条件页 | https://vroid.pixiv.help/hc/ja/articles/4402394424089 （最终更新 2024-12-26） |
| VRoid Hub 模型页 | https://hub.vroid.com/en/characters/2843975675147313744/models/5644550979324015604 |
| Hub 提供格式 | **VRM 0.0**（页面标注 `Format: VRM 0.0`） |
| VRoid Studio 内样例 | AvatarSample_A 是 VRoid Studio 附带的样例模型之一，可从模型选择界面的 “Sample Models” 下载并打开 |
| VRM 1.0 导出途径 | 官方 VRoid Studio 自 v1.20.2（2023-03-08）起恢复 VRM 1.0 导出；导出设置中可选择 `VRM 1.0` |
| 当前加载器限制 | `packages/character-core/vrm-file.ts` 只接受 `VRMC_vrm.specVersion` 以 `1.` 开头的模型；VRM 0.0 会明确拒绝 |
| 原始许可 | 不是 CC0；`.vroid` 与导出的 VRM 均可免费用于营利/非营利及商业活动；无需署名 |
| 再分发 | Hub 模型页标注 `Redistribution: Allow`；官方条件禁止无正当理由的有偿再分发，禁止把 VRM 许可的再分发/改変范围设为 CC0 |
| 渲染产物 | 官方允许使用样例拍摄的视频/图片制作作品，也允许编辑纹理/参数制作原创角色；本地导出精灵图属于制作图像作品 |
| 目标平台 | 官方条件不替代 ChatGPT/目标平台的上传与使用条款；本阶段未做平台预检或安装 |

官方取得/导出步骤（需要在有 VRoid Studio 的本机执行）：

1. 安装官方 VRoid Studio（VRM 1.0 导出需 v1.20.2 或更高；本记录未在本机安装或核对实际版本）。同意 VRoid Studio 的利用条款。
2. 启动 VRoid Studio，在模型选择界面进入 “Sample Models”，下载 **AvatarSample_A**；下载完成后点击打开。
3. 从右上角导出图标进入 “Export VRM”，按回归需要保留默认的模型简化设置。
4. 在导出设置中把格式选为 **VRM 1.0**；填写必填的 Avatar name 与 creator。保持角色身份可追溯，不改名、不伪装成第二份原创模型。
5. 导出到本机非仓库目录，计算 SHA-256 和文件大小，并读取嵌入的 `VRMC_vrm.specVersion`、`meta.name`、`meta.authors`、`meta.licenseUrl`。
6. 通过应用的本地导入功能加载该文件；加载成功后导出 v2 图集，使用 `inspectAtlas` 和预览组件检查最终 PNG，记录结果。

注意：官方帮助明确说明 VRoid Studio **不能直接导入/编辑 VRM 文件**。因此不能用 Hub 上那份 VRM 0.0 文件直接导出 VRM 1.0；必须使用 VRoid Studio 内的 `.vroid` 样例重新导出。把 VRM 0.0 直接交给当前加载器会失败，本阶段不添加 VRM 0.x 转换器，也不修改加载器绕过限制。

### 2.2 当前阻塞与未取得项

- 本机没有 AvatarSample_A 的 `.vroid` 或 VRM 1.0 文件；在常见安装路径也未发现 VRoid Studio，因此未执行安装、下载或导出。
- 未注册/登录 VRoid Hub，未同意其下载条款，未下载 VRM 0.0 文件。Hub 页面提供 “Sign in with pixiv ID” 入口，官方条件也说明下载/上传 VRM 需同意 VRoid Hub 利用条款；本次没有进行账号操作。
- 因此以下字段必须保持未知，不能用推测填充：
  - AvatarSample_A 导出文件的 SHA-256、文件大小；
  - 导出文件的实际 `VRMC_vrm.specVersion` 与元数据；
  - 导出后材质、表情、骨骼与 VRM 1.0 的保真情况；
  - 最终图集的帧占用、动作语义、视线和小尺寸可读性结果。
- 这些缺项只影响“第二模型验证”完成度，不影响已经交付的预览组件和首个模型的本地回归。

### 2.3 用户交付清单（VRoid Studio 路径）

本轮没有新的官方 VRM 1.0 直接下载来源可核实，也没有进行注册、登录、购买、上传或安装；第二模型仍为“未取得”。若继续走 AvatarSample_A 的 VRoid Studio 导出路径，用户只需交付以下内容：

- [ ] 在官方 VRoid Studio **≥1.20.2** 中从 “Sample Models” 打开 **AvatarSample_A**；不要使用 VRoid Hub 上的 VRM 0.0 文件代替。
- [ ] 导出时格式明确选择 **VRM 1.0**；保持模型身份为 AvatarSample_A，不改名或伪装成另一份原创模型。
- [ ] 把导出的 `.vrm` 放在仓库外，提供绝对路径、字节数和 SHA-256。
- [ ] 从文件内核对并记录：`VRMC_vrm.specVersion`（必须为 `1.x`）、`meta.name`、`meta.authors`、`meta.licenseUrl`、`avatarPermission`、`commercialUsage`、`allowRedistribution`、`modification`、`creditNotation`。
- [ ] 注明 VRoid Studio 实际版本和导出时使用的简化/材质设置；未改默认值时写“默认”。
- [ ] 把同一文件交给主开发者执行本地导入与 v2 图集导出；协作侧只复核文件身份、元数据和导出结果，不下载、不上传模型。

文件未到位前继续保持哈希、元数据和图集结果为空，不用推测填充；到位后按状态总表逐项更新。该清单不改变“第二模型验证未完成”的结论。

## 3. 结论与边界

1. 首个模型的文件、来源、哈希和许可边界清楚，阶段 01 的加载与图集导出证据可追溯；本阶段只复核了只读元数据。
2. 原计划 AvatarSample_A 的路径已确认，但该角色文件仍未取得。最终改用 AvatarSample_B 的真实运行结果见本文顶部补充，不将 A 的资料确认冒充运行结果。
3. 本地 `inspectAtlas` 通过、预览可播放，都不代表目标平台官方预检或安装通过；平台预检和安装仍需对精确的最终文件单独执行。
4. 模型二进制、用户模型和导出产物不进入 Git；仓库和默认发布包不应附带源模型。打包排除由主开发者的 C2 任务验收，本记录不提前宣称完成。
5. 本记录不构成法律意见；发布角色图像或源模型前，应重新读取原始许可页并结合发布主体、平台条款复核。

## 参考原始页面

- [VRoid Studio v1.20.2：VRM 1.0 导出恢复](https://vroid.pixiv.help/hc/ja/articles/16283115491609)（2023-03-08）
- [VRoid Studio：VRM 导出功能说明](https://vroid.pixiv.help/hc/en-us/articles/15760756822297-I-want-to-learn-more-about-the-VRM-export-feature)
- [VRoid Studio：样例模型使用方法](https://vroid.pixiv.help/hc/en-us/articles/31627266179865)
- [AvatarSample A〜Z 利用条件](https://vroid.pixiv.help/hc/ja/articles/4402394424089)（最终更新 2024-12-26）
- [AvatarSample_A VRoid Hub](https://hub.vroid.com/en/characters/2843975675147313744/models/5644550979324015604)
- [VRM Public License 1.0](https://vrm.dev/licenses/1.0/)
