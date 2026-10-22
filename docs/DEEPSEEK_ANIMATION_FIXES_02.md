# 阶段二：DeepSeek 动画修复任务

日期：2026-10-22。工作区 `E:\GitWorkSpace\OiGptPet`，分支 `codex/desktop-prototype`。

用户要求 Codex 先暂停，再给 DeepSeek 分配工作。本轮只更新任务，Codex 不继续修改功能或运行集成测试，等待用户恢复。

## 本批任务的依据

已收到 D5 的局域网 HTTP 摘要兼容、D6 的真实图集 QA 及 D7 的模型交付清单。保留这些结果，不重复开展已经完成的哈希工作。

以 `docs/ATLAS_VISUAL_QA_02.md` 为问题证据，输入图集 SHA-256 为：

`11177753492b6d8b959fb67d092f591a9ae4a1f0d1e5fb7cc4d0f74ff0b92e0d`

必须准确区分缺陷：

- **fail：待机头发发刺/分层异常。** 第 0 行帧 0 的 alpha 顶部为 y=24，而其余待机帧为 y=46；这不是单格裁切，QA 的单格裁切检查已通过。
- **fail：失落动作语义不成立。** 第 5 行接近待机，缺乏原生尺寸下可辨认的低头、蜷缩或失落反应。
- **warning：工作动作语义弱。** 有不同姿态，但不容易读成专注处理任务。
- 视线方向、挥手、跳跃实际离地等已有通过项，不应因修复其他状态而退化。

截图和先前单元测试通过不能替代修复后的实际编码图集复验。

## 文件所有权变更

**本批明确将下列三个原属主开发者的包移交给 DeepSeek。** 当前它们在共享工作区没有未提交改动。此授权覆盖旧任务中“不改动作内核/渲染器/导出器”的限制，范围仅限下面列出的路径。

可修改或新增：

```text
packages/character-core/index.ts
packages/renderer-vrm/**
packages/pet-exporter/**
tests/animation-quality.test.ts
tests/fixtures/animation-render/**
scripts/animation-render-smoke.mjs
scripts/atlas-visual-qa.mjs
tests/fixtures/atlas-preview/visual-qa.ts
docs/ANIMATION_FIXES_02.md
docs/ATLAS_VISUAL_QA_02.md
```

此前已经拥有的 `atlas-preview`、`atlas-tools` 文件只在需要修复本批回归时修改，不开展额外重构。

不得修改：

```text
src/**
electron/**
vite.config.ts
package.json / package-lock.json / tsconfig.json
scripts/smoke.mjs
scripts/release-smoke.mjs
scripts/package.mjs
scripts/distribution.mjs
tests/export-session.test.ts
tests/distribution.test.js
tests/character-core.test.ts
packages/character-core/vrm-file.ts
packages/target-chatgpt/contract.ts
README.md
```

Codex 后续只处理主程序界面、保存/报告和发布包验收，不在 DeepSeek 交付前改上述三个包。

## D8：修复首帧头发物理初始化，优先级最高

先诊断根因，保留修复前证据。重点核对：模型最终缩放和地面归一化、Spring Bone 初始化/重置、首帧预热、动作行之间继承的物理状态。

要求：

1. 阅读当前 `@pixiv/three-vrm` 实际提供的 API，确认物理初始化顺序；不要假设某个 reset 方法存在。
2. 模型完成最终缩放、平移与初始姿态后，再正确初始化物理状态。选择有依据的固定步长和预热策略，避免第一格还带着未稳定的头发状态。
3. 导出应可重复：同一文件、相同配置的新加载不能随机产生首帧发刺；不能依赖用户先播放一段时间来“碰巧稳定”。
4. 修复涵盖行切换、跳跃落地和视线行，检查是否继承了不适当的上一动作物理状态。
5. 保持共同缩放、镜头和地面基线；保留跳跃垂直位移。不要逐帧裁切、重新居中、修改 PNG 像素、删除头发网格或更换模型来遮掩问题。
6. 取消/失败仍须释放 VRM 和 WebGL 资源；不能以增加大量重复绘制或不受限制的等待作为修复。

验收重点是实际输出中不再出现所记录的孤立头发发刺，同时没有引入贴边、缩放跳变和循环闪动。不要仅以 alpha 顶部某个固定数值自动判定视觉通过。

## D9：加强失落与工作动作的可读性

先修失落状态，再处理工作状态；已有方向和跳跃行为保持兼容。

要求：

1. `failed` 在 192×208 原生单格下可读为失落或失败反应，有明确的头/颈/上身姿态线索。模型缺少 `sad` 表情时，也不能退化为普通待机。
2. `running` 仍表示工作、思考或专注处理任务，不是脚步奔跑。增强手臂、前臂、头部之间的协调，让它与等待/审阅有区别；不新增桌子、文字、UI、漂浮符号或未授权道具。
3. 保留左右移动、挥手、跳跃及十六方向已有通过行为。可改善跑步幅度和跳跃屈膝，但仅作为修复核心失败项之后的可选工作，不扩大范围。
4. 保持 `sampleMotion` 的确定性和正常输入行为；如需新增姿态字段，尽量使用兼容的可选字段或明确默认值，并由同批渲染器处理。
5. 不要求为了差异像素数而夸大动作；状态语义通过真实帧序列与播放观感判断。

需要保持兼容的接口：

```ts
sampleMotion(state, phase)
sampleLook(angleDegrees)

new VrmStage(canvas, preserveDrawingBuffer?)
stage.load(buffer)
stage.resize(width, height, pixelRatio?)
stage.render(state, phase, delta, look?)
stage.renderLook(angle)
stage.hitTest(x, y)
stage.dispose()

exportAtlas(source, profile, progress, signal?)
```

可以增加内部辅助方法或兼容的可选参数，不更改这些调用的含义。保持 `ExportResult` 的字段及 PNG 输出规格不变，不变更共享状态名、行序、帧数和 v1/v2 尺寸。

## D10：新图集、回归证据与必要的性能修正

1. 新建独立 fixture 和 `scripts/animation-render-smoke.mjs`，从本机真实 VRM 调用当前 `exportAtlas`，输出新的 v1/v2 PNG 和元数据。使用独立端口、进程及用户数据目录，不占用或终止 5173 主工坊服务。
2. 输出保存到 `artifacts/animation-fixes/` 下的新运行目录，记录输入模型 SHA-256、实际输出 SHA-256、字节数、规格、结构检查结果与耗时。不覆盖 `artifacts/smoke/` 或旧视觉 QA 的证据。
3. 把新图集交给现有预览/视觉 QA 工具复验。若原 QA 脚本固定写入同一目录，可以新增 `--out-dir` 参数，保留旧命令的默认行为；新复验写入独立目录。
4. 保留旧 QA 报告中的原始输入和失败结论，在 `docs/ANIMATION_FIXES_02.md` 另写新哈希的前后对照、修改依据、九种状态及十六方向的回归结论。没有查看图片/动画的项目标为 `not-reviewed`。
5. 为新姿态边界和取消/资源清理补有意义的回归。不能用“数值改变了”的单元测试替代实际模型输出检查。
6. 检查当前离线采样每格循环中重复的 GPU 绘制：如只需推进物理，可分离“模拟更新”和“最终绘制”，减少无用 draw call。此项在 D8/D9 修复之后进行，不牺牲物理稳定性和输出质量。
7. 首要性能目标是取消可响应、输出过程不长期阻塞 UI、不为每次物理步进重复做无意义绘制。记录实测，不设没有硬件依据的毫秒保证。

独立渲染脚本建议接口：

```powershell
node scripts/animation-render-smoke.mjs --model public/models/demo.vrm --out-dir artifacts/animation-fixes/run-01
```

独立脚本默认不安装任何 ChatGPT 宠物，也不保存用户模型到发布包。不安装新依赖、不修改主集成测试。结束时关闭自己的窗口/服务，递归清理前校验临时目录的绝对路径边界。

## 交付与停止条件

先交 D8/D9 的最小修复和新编码图集，再做可选优化。交付内容：

- 文件清单与接口兼容说明；
- `npx tsc --noEmit`、`npm test`、独立渲染/QA 的真实命令与结果；
- 旧/新图集的精确 SHA-256、视觉前后对照、尚存 fail/warning；
- v1/v2 结构检查、十六方向不退化、跳跃基线不丢失的证据；
- 渲染耗时及取消/释放检查结果。

修复完成后停止修改文件，等待 Codex 接线和主应用复测。**不要提交、推送、重新打包或运行主 `scripts/smoke.mjs`**；主程序中另有窗口自动化时序问题由 Codex 处理。

第二模型仍依赖实际 VRM 1.0 文件，本批不重复调研或绕过版本限制。目标平台预检和安装仍为未执行，不因视觉修复而自动标为通过。
