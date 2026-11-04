# AvatarSample_B：0.8.7 源码回归与静态视觉复核

2026-11-04。源代码检查点 86dcfcce6ca182dfa4453b4a88c5f2a1923bb562；启动时工作区干净。本轮使用已有的第二独立模型，推进当前时间线的模型覆盖，没有修改产品代码或版本，不推送或发布。

## 精确输入与结果

| 项目 | 结果 |
| --- | --- |
| 模型 | artifacts/model-library/2026-10-22/AvatarSample_B.vrm，21,047,556 字节 |
| 模型 SHA-256 | ffbd8c92a9e67c0a948f69c7a2eec91e5c282c9ae70e9184309fc164d74cbc27 |
| v1 | 1536×1872、57 帧、411,308 字节；SHA-256 c3a1840fc4e148e578cc74e6b9d57093548838348f13b5fc8d16ddce4a52b234 |
| v2 | 1536×2288、73 帧、508,877 字节；SHA-256 09bf651d1ed4fa72959f336a8da128d524ca9f81559da00d0c904636af9c1dde |
| 结构 | v1/v2 均通过，无结构错误 |
| 取消 / 重复 | 第三格取消为 AbortError；取消后重新导出 v2，与第一次哈希完全一致 |
| 释放 / 错误 | 最终 4 个 WebGL context 全部释放，live=0；pageErrors/consoleErrors 为空 |
| 两规格共享部分 | 解码后的 v1 RGBA 与 v2 前九行逐字节一致，shared-rows.json 已保存 |

产物目录：`artifacts/animation-fixes/avatar-b-087-20261104/`；渲染记录 `manifest.json`，视觉分析 `qa-v2/manifest.json`，共生成 15 张联系表。这是当前源码通过独立 Electron fixture 的加载、渲染和导出检查，不冒充发布 EXE 内的完整工坊/角色库验收。

## 已查看与观察

- `idle-heads.png`：六格头部中，第 4 格（0 起算）出现闭眼，第 5 格恢复张眼；将 0.8.7 的六帧眨眼修复验证到另一独立角色。
- `state-waving.png`：抬臂和前臂摆动可辨，查看的四格未见手、头发超出格边。
- `state-jumping.png`：离地/落地可辨；底边序列 188、178、167、178、188，回到相同基线，未见格边裁切。
- `state-running-right.png`：朝右、腿部交替可辨，未见单格裁切；不据此判定足底接触、速度或连续循环自然度。
- `state-failed.png`、`state-running.png`：两类姿态可区分，但手臂分别停在胸前和腹部附近；相较首模，掩面和托腮语义偏弱。保留模型适配 warning，不判为动作语义全部通过。
- `gaze-heads.png`：已查看 16 个方向，头部方向变化可辨，按上方开始顺时针排列。头部与上方参考的差值只有第 0 格为零，眼区相邻差值 330–453 px。自动分析的下半身差值为 128–165 px（除参考格），可能包含头发/配饰影响，未做骨骼矩阵归因，不宣称下半身完全固定。

其余联系表已生成，但本轮未逐一人工查看；没有把完整九状态连续播放标为通过。联系表与像素差只属于上述精确图集，不能覆盖旧哈希或未来改图。

## 复现

```powershell
node scripts/animation-render-smoke.mjs --model artifacts/model-library/2026-10-22/AvatarSample_B.vrm --out-dir artifacts/animation-fixes/<新的空目录>
node scripts/atlas-visual-qa.mjs --file artifacts/animation-fixes/<新的空目录>/atlas-v2.png --profile v2 --out-dir artifacts/animation-fixes/<新的空目录>/qa-v2
```

渲染工具请求 SwiftShader，计时不代表实际硬件性能。模型、PNG 和联系表留在 Git 忽略目录，不随仓库或发布包分发；本轮不重新判断原资源许可。

后续优先处理该模型失落/工作时的手臂落点与遮挡，再做连续播放观察和更多模型对照。目标 ChatGPT 官方预检/安装、真实 API、物理多屏/DPI/休眠及能耗验收仍独立待办。本轮没有改程序，不创建新 EXE 或重复跑无关单测。
