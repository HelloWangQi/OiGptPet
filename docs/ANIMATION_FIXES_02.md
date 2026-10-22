# 阶段二动画修复交付（D8 / D9 / D10）

日期：2026-10-22。分支：`codex/desktop-prototype`。工作区：`E:\GitWorkSpace\OiGptPet`。

本文记录 D8（首帧头发物理）、D9（失落/工作可读性）和 D10（独立渲染与 QA 证据）的实际改动、复跑命令和目视结论。按任务书要求，**本批没有提交、推送、重新打包，也没有运行主 `scripts/smoke.mjs`**。目标平台的预检、安装和实际播放仍未执行。

> 最终集成补充（Codex）：下文保留 DeepSeek 交付时的命令、结论与边界。之后主程序/组件回归、新 Windows 包启动与第二模型 AvatarSample_B 验证已完成，见 `CHECKPOINT_02.md` 和 `MODEL_VALIDATION_02.md`。最终复核在导出入口、PNG 编码前后补了取消检查及 3 项回归，解决第 11.4 节的取消遗留项；`npm test` 现已排除缓存快照，实际为 7 文件 / 85 项通过。QA 脚本也已修正旧报告提示文案，历史产物不改写。最终主程序图集哈希与 run-04 相同。

## 1. 结论摘要

- D8：根因是 VRM 加载器在应用最终缩放和中性姿态之前就建立了 Spring Bone rest state；旧导出又让每格继承上一格的物理状态。现在加载完成后按最终变换重新捕获 rest state，导出时每格执行固定 30 步 60 Hz 预热再绘制一次。新图集首帧不再出现孤立发刺，行切换、跳跃和视线行不再继承上一行的头发状态。
- D9：`failed` 改为低头、躯干前倾、双手抬至脸侧的抱头低落姿态；`running`（工作）改为一手靠近下颌、另一臂横在腹前的思考姿态。两者在 192×208 原生单格下与 idle、waiting、review 可区分，腿部保持站立，没有新增桌面、文字、UI 或道具。
- D10：新增独立 fixture 和 `scripts/animation-render-smoke.mjs`，从真实 VRM 调用当前 `exportAtlas`，生成 v1/v2 新图集。结构检查、视觉 QA、取消/释放、重复渲染和逐格 draw 计数均已复跑。
- 最终图集：v1 `05ac930c…`，v2 `84604125009381796d748388ab5b934dd9faac581b8cd8a00fd4417b4b3acada`。run-03 与 run-04 两次独立渲染的 v1/v2 哈希逐字节一致。
- 尚存 warning：左右移动仍偏走路、跳跃没有明显屈膝/落地压缩、waiting/review 幅度偏小、22.5° 视线档位在原生尺寸下较细。详见第 11 节。
- `not-reviewed`：目标平台官方预检/安装/实际播放、主应用内动画播放观感、第二模型、硬件无关的性能保证。

## 2. 输入与输出身份

### 2.1 模型

| 项目 | 值 |
| --- | --- |
| 路径 | `public/models/demo.vrm` |
| 字节数 | 10,776,032 |
| SHA-256 | `12c2b97e95e700783a6a550dc0eee2d7880aeedccef9ae67bc4c5a2f0f2631a2` |

### 2.2 修复前证据

旧视觉 QA 报告 `docs/ATLAS_VISUAL_QA_02.md` 和旧联系表 `artifacts/atlas-visual-qa/` 没有被改写；旧结论继续只适用于旧哈希。

| 项目 | 值 |
| --- | --- |
| 旧 QA 输入 | `artifacts/smoke/baseline-01/atlas-v2.png`（修复前打包应用的保留副本） |
| 旧字节数 | 413,622 |
| 旧 SHA-256 | `11177753492b6d8b959fb67d092f591a9ae4a1f0d1e5fb7cc4d0f74ff0b92e0d` |
| 旧报告 | `docs/ATLAS_VISUAL_QA_02.md`（未修改） |
| 旧联系表 | `artifacts/atlas-visual-qa/`（未修改） |

说明：`artifacts/smoke/atlas-v2.png` 当前是 16:04 主应用 smoke 的输出，哈希为 `ad50cd7c…`，不是旧 QA 输入。旧哈希的副本保存在 `artifacts/smoke/baseline-01/atlas-v2.png`，同目录的 `reconstruction.json` 记录了 `matched: true`、字节数和来源。本批没有向 `artifacts/smoke/` 写入文件。

### 2.3 新图集

最终证据目录为 `artifacts/animation-fixes/run-04/`。run-03 是同一份代码的重复渲染，用作哈希复现；run-01 是仅含 D8 的中间版本，run-02 是上一轮 D9 候选，均保留用于前后对照。

| 运行 | 版本 | 字节数 | SHA-256 | 说明 |
| --- | --- | --- | --- | --- |
| run-01 | v1 | 293,312 | `4b0af6b5f6020bf49ebfd42328aaf73d2b4f963f40bfeb35b8042c489a243b4d` | D8 修复、D9 尚未调姿 |
| run-01 | v2 | 371,206 | `8194c372a25653fe9939de507a8b5b6d5319e9b3a1d02cff1f059202a86b2d15` | 同上 |
| run-02 | v1 | 294,598 | `f1d1f9818dee259ef4bca6a4ed9352c3b1afbaeccef3698be9f4701ed1fa3255` | 上一轮 D9 候选 |
| run-02 | v2 | 372,231 | `dca7e128ca94b56f2528d21f4867640d2b524b07cb6d47284912e36c3efcb381` | 上一轮 D9 候选 |
| run-03 | v1 | 293,190 | `05ac930c71c9a8f5308c2fc4c5aedcffaec99b865cbdc5a36b1c4ade1156e8f6` | 最终姿态，重复渲染 |
| run-03 | v2 | 370,954 | `84604125009381796d748388ab5b934dd9faac581b8cd8a00fd4417b4b3acada` | 最终姿态，重复渲染 |
| run-04 | v1 | 293,190 | `05ac930c71c9a8f5308c2fc4c5aedcffaec99b865cbdc5a36b1c4ade1156e8f6` | **最终证据** |
| run-04 | v2 | 370,954 | `84604125009381796d748388ab5b934dd9faac581b8cd8a00fd4417b4b3acada` | **最终证据** |

最终 v2 为 370,954 字节，低于 20 MiB 上限；两次运行的 PNG 逐字节一致。

## 3. D8：首帧头发物理初始化

### 3.1 根因

对照 `@pixiv/three-vrm` 3.5.5 的实际行为后确认：

1. 加载器在模型导入阶段就建立 Spring Bone 的初始局部旋转和尾部位置，此时还未应用本项目的最终缩放、地面归一化和中性姿态。
2. VRM 的更新顺序是 humanoid → lookAt → expressions → node constraints → spring bones → materials。旧的加载流程先摆 idle 姿态、计算包围盒、再缩放和平移，物理 rest state 仍指向缩放前的世界位置。
3. 旧导出每格调用 12 次 `stage.render`，每次只推进 1/60 秒；`renderLook` 还使用 delta 0。第一格在模型刚加载后没有足够的预热，行与行之间又会继承上一行最后一帧的物理状态，因此待机首帧会出现孤立发刺，跳跃和视线行也可能带着不适当的状态。

### 3.2 修复

`packages/renderer-vrm/index.ts`：

- 加载阶段先设置 look target，再摆 idle、做最终缩放/平移、更新世界矩阵，重新应用 idle 姿态并执行 `candidate.update(0)`。随后调用 `springBoneManager.reset()` 和 `setInitState()`，把 rest state 重新捕获到最终世界变换和中性姿态上（[index.ts:58](file:///E:/GitWorkSpace/OiGptPet/packages/renderer-vrm/index.ts#L58)、[index.ts:70](file:///E:/GitWorkSpace/OiGptPet/packages/renderer-vrm/index.ts#L70)、[index.ts:75](file:///E:/GitWorkSpace/OiGptPet/packages/renderer-vrm/index.ts#L75)）。
- 新增导出专用同步方法 `renderSettled`：应用姿态 → `vrm.update(0)` 同步骨骼/约束 → `springBoneManager.reset()` → 固定 30 次 `springs.update(1 / 60)` → 只绘制一次（[index.ts:130](file:///E:/GitWorkSpace/OiGptPet/packages/renderer-vrm/index.ts#L130)）。30 步等于 0.5 秒的固定预热，不依赖上一行，也不等待真实时间。
- `render`、`renderLook`、`hitTest`、`dispose` 等现有接口含义未变。

`packages/pet-exporter/index.ts`：

- 每格改为一次 `stage.renderSettled(..., PHYSICS_STEPS)`，不再循环 12 次 `render`（[index.ts:12](file:///E:/GitWorkSpace/OiGptPet/packages/pet-exporter/index.ts#L12)、[index.ts:38](file:///E:/GitWorkSpace/OiGptPet/packages/pet-exporter/index.ts#L38)）。
- v2 视线行改为 `renderSettled('idle', 0, sampleLook(i * 22.5), PHYSICS_STEPS)`，视线位置由 `sampleLook` 决定（[index.ts:47](file:///E:/GitWorkSpace/OiGptPet/packages/pet-exporter/index.ts#L47)）。
- 继续使用 `finally { stage.dispose(); }`；加载、渲染或取消失败时都会释放 VRM/WebGL 资源（[index.ts:58](file:///E:/GitWorkSpace/OiGptPet/packages/pet-exporter/index.ts#L58)）。

没有逐帧裁切、重新居中、修改 PNG 像素、删除头发网格或更换模型；共享缩放、镜头、地面基线（底边 188）和跳跃垂直位移保持不变。

### 3.3 实际效果

- 六帧待机头部 alpha 顶部全部为 `y=46`，不再出现旧版第 0 帧的 `y=24` 竖直发刺；底边全部 188，高度全部 143。
- 跳跃五帧底边为 `188 → 178 → 167 → 178 → 188`，首尾正好回到地面基线；峰值顶部到 `y=25`，仍在 192×208 格内。
- 旧版跳跃第 4 帧头发盖脸的分层问题在本轮实际帧中也已消失；跳跃剩余问题是没有明显屈膝/落地压缩和空中手臂偏展开，见第 11 节。
- 视线行使用同一套预热；16 个方向的头部帧没有重复，眼区差异全部非零。

## 4. D9：失落与工作动作

### 4.1 `failed`

最终姿态在 `sampleMotion('failed', phase)` 中（[index.ts:62](file:///E:/GitWorkSpace/OiGptPet/packages/character-core/index.ts#L62)）：

- `headPitch` 约 0.36–0.40，头明显低垂；`headRoll` 在 -0.12 到 -0.08 之间轻微摆动。
- `spine`、`chest`、`neck` 分别前倾，形成上身前压。
- 双臂上抬到脸侧，前臂大幅内折（左 -2.37~-2.43，右 +2.37~+2.43），读作抱头/掩面；`sad = 1`。
- 即使模型没有 `sad` 表情，头、颈、躯干和手臂轮廓仍然成立，不会退化为 idle。

最终帧边界：中心 97、宽 54、高 140、底边 188，八帧稳定；帧间差异 163–232px，是头发和轻微摆动，不是身体漂移。与 idle 中间帧差 1391px（旧版只有 588px），与 waiting 差 1315px，与 review 差 1324px。

### 4.2 `running`（工作）

最终姿态（[index.ts:81](file:///E:/GitWorkSpace/OiGptPet/packages/character-core/index.ts#L81)）：

- 左手抬到下颌附近（左大臂 Z=-1.1），右臂收在腹前（右大臂 Z=0.35）；左前臂约 -1.16~-1.24，右前臂约 +2.16~+2.24。
- 头部保持约 0.21–0.27 的前倾，并带 ±0.05 的缓慢左右扫视；脊柱和胸部前倾，腿部 `leftLeg/rightLeg = 0`、`rootY/rootYaw = 0`，双脚原地。
- 没有桌子、文字、UI、漂浮符号或道具。与 waiting/review 的单臂外展轮廓不同；与 idle 的差异为 1240px，与 review 为 1158px。

### 4.3 兼容性

`MotionPose` 只新增了可选的 `spine`、`chest`、`neck` 字段（[index.ts:15](file:///E:/GitWorkSpace/OiGptPet/packages/character-core/index.ts#L15)）；其他状态没有设置这些字段。`applyPose` 在有值时应用，无值时保持原行为（[index.ts:103](file:///E:/GitWorkSpace/OiGptPet/packages/renderer-vrm/index.ts#L103)）。`sampleMotion`、`sampleLook`、`VrmStage` 既有调用和 `ExportResult` 字段均未改变；只新增了内部辅助方法 `renderSettled`。

## 5. D10：独立渲染 fixture 与脚本

新增文件：

- `tests/fixtures/animation-render/index.html`：在模块加载前包装 WebGL/WebGL2 的 `getContext`、`drawArrays`、`drawElements`、`clear`，记录 context 创建/丢失、每格 draw/clear 次数，并监听 `webglcontextlost`。
- `tests/fixtures/animation-render/main.ts`：通过真实 `exportAtlas` 渲染 v1/v2；记录每格耗时、draw/clear 快照；解码 PNG 后调用 `inspectAtlas`；提供 `cancel(profile)`，在第 3 格后中止并等待上下文释放。
- `scripts/animation-render-smoke.mjs`：读取本地 VRM 并计算 SHA-256；用随机端口启动 Vite，通过 `/@fs/<绝对路径>` 提供模型；启动隐藏的 Electron + swiftshader；输出 `atlas-v1.png`、`atlas-v2.png`、`manifest.json`。
- `scripts/atlas-visual-qa.mjs`：新增 `--out-dir`，解析为绝对路径并拒绝空值；不传时仍写入原来的默认目录，旧命令行为不变。

独立脚本的保护与断言：

- 输出目录必须是 `artifacts/animation-fixes` 的子目录；非空目录直接拒绝；临时目录使用 `oigptpet-animation-render-` 前缀并在清理前校验绝对路径边界。
- 不使用 5173 端口，不终止或复用主工坊服务；每次使用独立的 Vite 端口、Electron 进程和 user-data 目录，结束后关闭并清理。
- 检查结构 valid、必需帧数、PNG 尺寸、每格一次 clear/一次 render、每 pass draw 数恒定、每次导出只有一个 WebGL context、取消后上下文释放、v2 重复渲染逐字节一致，以及没有 page/console error。

## 6. 实际复跑命令与结果

### 6.1 类型检查与单元/回归测试

```powershell
npx tsc --noEmit
npx vitest run --exclude '**/.cache/**'
```

结果：

- `npx tsc --noEmit`：通过，无输出。
- 排除 `.cache` 后：7 个测试文件、82 个测试全部通过。

`npm test` 本身也通过，但当前工作区 `.cache/codex-commit-1792658590950/` 下存在一份会话外工具生成的仓库快照，Vitest 默认扫描到其中的重复测试，显示为 12 个文件、127 个测试。该快照不是本批产物，也没有被本批修改；上面的 82 项是本批相关测试的准确结果。

新增/更新的测试覆盖：

- `failed` 的头/颈/躯干前倾、双臂上抬、前臂大幅内折和 `sad=1`；与 idle 的差异。
- `working` 的双手不对称、下颌手、腹前臂、头部扫视、腿部原地，以及与 waiting/review 的差异。
- 方向移动的左右腿/手臂和 rootYaw 镜像保持不变。
- 导出器每格调用一次 `renderSettled`（首格参数为 `['idle', 0, undefined, 30]`），不再调用 `render`；跳跃相位 0/0.25/0.5/0.75/1；v2 的 57 + 16 次视线采样。
- 取消在第 3 格后抛出 `AbortError` 并调用一次 `dispose`；加载失败/渲染失败也调用 `dispose`，失败路径不会调用 `toBlob`。

### 6.2 独立渲染

```powershell
node scripts/animation-render-smoke.mjs --model public/models/demo.vrm --out-dir artifacts/animation-fixes/run-03
node scripts/animation-render-smoke.mjs --model public/models/demo.vrm --out-dir artifacts/animation-fixes/run-04
```

两次输出的 v1/v2 哈希相同。run-04 的干净环境测量：

| Profile | 总耗时 | 首格 | 中位数 | p95 | 最大 | draw/clear | 每 pass draw | context |
| --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: |
| v1 | 6,271.9 ms | 2,259.6 ms | 8.2 ms | 16.1 ms | 37.2 ms | 1140 / 57 | 20 | 1 |
| v2 | 4,838.2 ms | 499.8 ms | 8.2 ms | 11.2 ms | 14.2 ms | 1460 / 73 | 20 | 1 |

run-03 同时段受后台复核进程影响，v1 出现过一次 823 ms 的离群帧（p95 368 ms），v2 仍为 4,858 ms、中位数 8.5 ms。两轮总耗时差异来自冷启动和机器调度，不作为硬件无关的保证；稳定指标是每格一次 render、20 次 mesh draw、v2 重复哈希一致。

### 6.3 视觉 QA

```powershell
node scripts/atlas-visual-qa.mjs --file artifacts/animation-fixes/run-04/atlas-v2.png --profile v2 --out-dir artifacts/animation-fixes/run-04/qa-v2
node scripts/atlas-visual-qa.mjs --file artifacts/animation-fixes/run-04/atlas-v1.png --profile v1 --out-dir artifacts/animation-fixes/run-04/qa-v1
```

结果：v1 1536×1872、57 个必需帧；v2 1536×2288、73 个必需帧；两者 `structure valid`、0 error。联系表分别写入 `qa-v1/`（12 张）和 `qa-v2/`（15 张），另有 `manifest.json` 记录输入哈希、边界、差异和复跑命令。

v1 的 57 个动画格与 v2 的前 9 行动作同源，九状态边界和帧间差异一致；v1 没有第 9/10 行视线格。

## 7. 九状态回归

旧结论来自 `docs/ATLAS_VISUAL_QA_02.md`（旧哈希）；新结论基于 run-04 的实际编码图集和目视检查。`failed`/`running` 的差异数为中间帧对 idle 的完整单格差异（每格 39,936 像素）。

| 状态 | 旧结论（旧哈希） | 新结论（新哈希） | 新证据 |
| --- | --- | --- | --- |
| `idle` | fail：帧 0 头顶发刺到 y=24，帧 1–5 为 y=46 | **pass** | 六帧顶部均为 y=46，底边 188，高度 143；帧差异 0/529/547，首帧无孤立发刺 |
| `running-right` | warning：步态偏走路、幅度小 | warning（保留） | 8 帧，底边 188/186/182/186 循环，朝屏幕右；方向、镜像和步态边界未变；不属于本批核心修复 |
| `running-left` | warning：同上 | warning（保留） | 与向右帧镜像，中心 94–96，底边 188/186/182/186；无回归 |
| `waving` | pass：可辨识为挥手 | **pass** | 4 帧，底边 188，高度 144–154，帧差异 201–208；手臂仍举过头顶摆动 |
| `jumping` | warning：无屈膝/落地压缩，空中偏 T 形，帧 4 头发盖脸 | warning（保留） | 底边 188→178→167→178→188，首尾回基线；帧 4 头发盖脸已消失；剩余问题是无明显屈膝和空中手臂偏展开 |
| `failed` | fail：接近 idle，缺少可读的失落线索；与 idle 差 588px | **pass** | 与 idle 差 1391px，与 waiting 差 1315px；低头、躯干前倾、双手抬至脸侧；底边 188、中心 97、宽 54、高 140，八帧稳定 |
| `waiting` | warning：动作幅度偏小 | warning（保留） | 6 帧，中心 104、宽 74、底边 188；单臂外展仍在，与 failed/工作/审阅轮廓不同 |
| `running`（工作） | warning：与 idle 差 1217px，工作语义弱 | **pass** | 与 idle 差 1240px，与 review 差 1158px；一手下颌、一臂腹前、头部扫视、躯干前倾、双腿原地；与 waiting/review 的单臂外展不同 |
| `review` | warning：动作幅度小 | warning（保留） | 6 帧，中心 87、宽 76、底边 188；单臂前伸/展示动作仍在，与工作状态可区分 |

补充：

- 所有状态的底边都保持 188（跑步按步态在 182–188、跳跃按弧线变化），没有累计漂移。
- 所有状态的内容都在 192×208 格内；最大宽度 111（跳跃），最大高度 154（挥手），没有贴边裁切。
- `failed` 和 `running` 的中心/宽度在整段内固定，帧间变化来自头发、手臂和轻微摆动，不是身体缩放或平移。
- 旧报告的 fail 结论仍适用于旧哈希，未被本次新结论覆盖。

### 7.1 关键视觉前后对照

旧图来自 `artifacts/atlas-visual-qa/`（旧哈希 `111777…`）；新图来自 `artifacts/animation-fixes/run-04/qa-v2/`（新哈希 `846041…`）。两边都是整数倍放大、完整 192×208 单格，没有裁切或重绘。

| 项目 | 旧图 | 新图 | 目视差异 |
| --- | --- | --- | --- |
| 待机头部 | `idle-heads.png` | `qa-v2/idle-heads.png` | 旧版首帧头顶发刺到 y=24、帧 1 两侧横向发刺；新版六帧顶部均为 y=46，头发贴合头部 |
| 失落 | `state-failed.png` | `qa-v2/state-failed.png` | 旧版手臂下垂、身体直立、接近 idle；新版低头、躯干前倾、双手抬至脸侧，轮廓明显不同 |
| 认真工作 | `state-running.png` | `qa-v2/state-running.png` | 旧版双臂微外展、缺少工作线索；新版一手靠近下颌、另一臂横在腹前，头部缓慢扫视 |
| 跳跃 | `jump-baseline.png` | `qa-v2/jump-baseline.png` | 两边底边均为 188→178→167→178→188；新版首帧无发刺，第 4 帧头发不再盖脸 |
| 十六方向视线 | `gaze-eyes.png` / `gaze-heads.png` | `qa-v2/gaze-eyes.png` / `qa-v2/gaze-heads.png` | 瞳孔方向序列保持；新版头部帧仍两两不同，长发摆动使下方身体差异从 0–1px 变为 14–17px |

## 8. 十六方向视线回归

v2 第 9/10 行共 16 个方向。基准为 0°（上）。眼区为 36×20 区域，相邻差异为当前方向与上一方向的眼区差异；结论均为实际查看 `gaze-eyes.png`、`gaze-heads.png` 和 `gaze-directions.png` 后给出。

| 序号 | 角度 | 屏幕方向 | 眼区差异 vs 上 | 相邻差异 | 结论 |
| ---: | ---: | --- | ---: | ---: | --- |
| 0 | 0° | 上 | 0 | 203 | pass（基准） |
| 1 | 22.5° | 上右 | 203 | 203 | pass（原生尺寸较细） |
| 2 | 45° | 右上 | 245 | 204 | pass |
| 3 | 67.5° | 右上 | 284 | 199 | pass |
| 4 | 90° | 右 | 310 | 206 | pass |
| 5 | 112.5° | 右下 | 320 | 205 | pass |
| 6 | 135° | 右下 | 322 | 219 | pass |
| 7 | 157.5° | 右下 | 330 | 240 | pass |
| 8 | 180° | 下 | 331 | 215 | pass |
| 9 | 202.5° | 左下 | 319 | 208 | pass |
| 10 | 225° | 左下 | 326 | 239 | pass |
| 11 | 247.5° | 左下 | 331 | 239 | pass |
| 12 | 270° | 左 | 321 | 222 | pass |
| 13 | 292.5° | 左上 | 304 | 211 | pass |
| 14 | 315° | 左上 | 266 | 205 | pass |
| 15 | 337.5° | 左上 | 203 | 207 | pass |

关键结论：

- 16 个头部帧没有与 0° 完全相同的副本，`identicalHeadToUp` 只有基准帧为 true。
- 头部差异 502–729px，眼区差异 203–331px；四个正方向（0°/90°/180°/270°）的瞳孔分别位于上/右/下/左，方向成立。
- 相邻眼区差异 199–240px，没有静止重复帧。
- 下方身体区域（y=96–207）差异为 0–17px。旧版是 0–1px；本轮差异来自转向后垂到 y=96 以下的长发（约 14–17px），不是整个人转身。实际联系表中腿、裙摆和躯干保持原位。这个指标变化已记录为限制，不构成视线回归。
- 22.5° 档位在 192×208 原生尺寸下仍较细，但 20× 眼部特写中瞳孔位置按上→右上→右→右下→下→左下→左→左上连续变化。

## 9. 跳跃基线

| 帧 | 0 | 1 | 2 | 3 | 4 |
| --- | ---: | ---: | ---: | ---: | ---: |
| alpha 底边 | 188 | 178 | 167 | 178 | 188 |
| alpha 顶部 | 46 | 35 | 25 | 35 | 46 |

首尾底边正好回到 188，离地 21px；峰值顶部 25，未触碰单格 y=0；五帧头、手、脚完整，没有裁切。首帧和末帧的头发状态稳定，没有孤立发刺。

## 10. 性能、取消与资源释放

- 旧循环每格调用 12 次 `stage.render`；新循环每格只调用 1 次 `renderSettled`，物理预热在内部完成，最后一次 `renderer.render` 才绘制。按当前探针，每 pass 固定 20 次 mesh draw，v1 共 57 pass/1140 draw，v2 共 73 pass/1460 draw。
- 每次导出创建 1 个 WebGL context；取消后 context 丢失，最终探针 `live=0`。
- 取消测试：在第 3 格完成后中止，抛出 `AbortError`，耗时约 2.03 秒，完成 3 格、60 次 draw；context 记录 3 个、丢失 3 个、存活 0；最终探针 4 个 context、4 个丢失、0 存活。没有 page error 或 console error。
- 重复渲染：同一进程内 v2 两次输出哈希一致；run-03 与 run-04 的 v1/v2 输出也逐字节一致。
- 以上耗时是本机 Electron + swiftshader 的实测，不是硬件无关的性能承诺；首格包含模型加载/着色器编译，不能当作稳定每帧成本。

## 11. 尚存问题、限制与未审项目

### 11.1 尚存 warning（新哈希）

- 左右移动仍是 4 帧步态循环播放两遍，抬脚约 6px，观感偏走路；本批只修复 D8/D9 核心项，没有扩大步态范围。
- 跳跃没有起跳屈膝和落地压缩，空中手臂仍偏水平展开；离地、落地基线和头发遮挡已改善，但语义仍是 warning。
- waiting/review 的动作幅度偏小，帧间差异约 400–480px；可区分但不够醒目。
- 22.5° 视线档位在原生 192×208 下较细，主要靠眼部特写辨认。
- 视线下方身体差异从旧版 0–1px 变为 14–17px，原因是 D8 稳定后的长发垂到 y=96 以下；不是身体转向。

### 11.2 未审（`not-reviewed`）

- 目标平台官方预检、安装和实际播放。
- 主应用/预览中的真实播放循环、8 fps 状态切换和视线切换观感；本次只审静态联系表和实际编码图集的逐帧像素。
- 第二模型（仍缺实际 VRM 1.0 文件）；本批没有改名冒充第二个模型。
- 硬件无关的耗时保证。
- 发布包重新打包/签名；按任务书本批不执行。

### 11.3 独立复核

用本机 Codex 的 `gpt-6.1-sol` 做了两次只读复核：

- 图像复核（最终 run-03 联系表）：`failed`、`working`、idle 首帧/六帧稳定性、跳跃四项均判“通过”。这是仅基于附图的辅助意见，不替代上面的结构化统计和人工检查。
- 代码复核：Codex 环境缺少 `codex-code-mode-host.exe`，无法读取文件，未形成可用 finding；不作为本批证据。该限制没有通过安装软件绕过。
- 主代理补审（2026-10-22）：GPT Sol 未完成的五项只读审计由实现方按同一清单补做，核对 `@pixiv/three-vrm` 3.5.5 源码、当前实现与 run-04 证据。D8 的 `reset`/`setInitState` 顺序与弹簧 API 语义一致；每格预热后只调用一次 `renderer.render`；取消和失败路径均进入 `finally` 的 `stage.dispose()`；D9 的躯干字段通过归一化骨骼局部旋转应用，与既有轴约定一致；边界、状态区分、取消和清理测试有效。未发现阻断问题。补审由实现方执行，**不构成独立复核**，不能替代外部代码审查或人工播放验收。补审期间复跑类型检查和单测（82 passed），未改动代码或图集产物。

### 11.4 补审遗留低风险项

- `exportAtlas` 只在每格开始时检查 `signal`。若取消恰好发生在最后一格完成之后或 PNG 编码期间，导出仍可能成功返回；资源仍由 `finally` 释放。这不违反当前“取消必须释放”的验收项，但若主应用要求“取消必定拒绝”，应在 `toBlob` 前后补一次 `throwIfAborted` 并增加回归测试。
- `artifacts/animation-fixes/run-04/qa-v2/manifest.json` 的静态 limitation 文案仍指向旧报告 `docs/ATLAS_VISUAL_QA_02.md`；这是 QA 脚本文案遗留，manifest 的输入 SHA-256 已锚定新图集，新结论以第 9 节为准。
- D9 的轴语义由姿态实验和目视 QA 确认；单测断言的是 `sampleMotion` 数值边界，没有对渲染后的骨骼世界矩阵做数值断言。后续若修改骨架或轴约定，必须重跑目视 QA。

## 12. 改动文件与接口兼容

本批新增/修改：

- `packages/character-core/index.ts`：可选躯干字段；`failed`/`running` 姿态；其他状态不变。
- `packages/renderer-vrm/index.ts`：加载后重新捕获 rest state；`applyPose` 应用可选躯干旋转；新增 `renderSettled`。
- `packages/pet-exporter/index.ts`：每格一次 `renderSettled`，固定 30 步；视线行改用 `sampleLook`；保留 `dispose`。
- `tests/animation-quality.test.ts`：姿态边界、状态区分、方向非回归、导出/取消/清理测试。
- `tests/fixtures/animation-render/index.html`、`tests/fixtures/animation-render/main.ts`：独立渲染 fixture。
- `scripts/animation-render-smoke.mjs`：独立渲染 smoke。
- `scripts/atlas-visual-qa.mjs`：新增 `--out-dir`，默认行为不变。
- `docs/ANIMATION_FIXES_02.md`：本文。

未修改 `src/`、`electron/`、`vite.config.ts`、`package.json`、`package-lock.json`、`tsconfig.json`、主 `scripts/smoke.mjs`、`scripts/release-smoke.mjs`、`scripts/package.mjs`、`scripts/distribution.mjs`、共享契约 `packages/target-chatgpt/contract.ts`、`README.md`，也没有格式化全仓库。

接口兼容：

- `sampleMotion(state, phase)`、`sampleLook(angleDegrees)` 的签名和正常输入行为不变。
- `new VrmStage(canvas, preserveDrawingBuffer?)`、`load`、`resize`、`render`、`renderLook`、`hitTest`、`dispose` 的调用含义不变；新增的 `renderSettled` 是内部辅助方法。
- `exportAtlas(source, profile, progress, signal?)` 的签名、`ExportResult` 字段、图集尺寸、列数、行序和帧数不变。

## 13. 复跑与停止条件

完整复跑：

```powershell
npx tsc --noEmit
npx vitest run --exclude '**/.cache/**'
node scripts/animation-render-smoke.mjs --model public/models/demo.vrm --out-dir artifacts/animation-fixes/<新目录>
node scripts/atlas-visual-qa.mjs --file artifacts/animation-fixes/<新目录>/atlas-v2.png --profile v2 --out-dir artifacts/animation-fixes/<新目录>/qa-v2
node scripts/atlas-visual-qa.mjs --file artifacts/animation-fixes/<新目录>/atlas-v1.png --profile v1 --out-dir artifacts/animation-fixes/<新目录>/qa-v1
```

停止条件：本批改动到此为止，等待 Codex 接线和主应用复测。没有提交、推送、重新打包或运行主 `scripts/smoke.mjs`；没有购买、注册、上传模型或安装软件。
