# 给 DeepSeek 1017 的协作任务

> 本文是阶段一任务档案。该模块已进入基线提交 `7ea0cbc`。下一阶段请执行 [阶段二任务](PHASE_02.md)，以其中的文件所有权和接口约定为准。

## 可以直接转发的说明

我们正在开发 OiGptPet：同一个二次元角色，支持独立 Windows 桌宠，以及导出成 ChatGPT 宠物精灵图。主开发者负责 Electron 桌面壳、Three.js/VRM 渲染、角色动作、界面与图集导出。请你负责下面的独立检查与播放计算模块，完成后交回源文件及验证结果。

项目路径：`E:\GitWorkSpace\OiGptPet`。如果你在其他工作区，保持相对目录不变即可。

先阅读：

- `docs/DEVELOPMENT_PLAN.md`
- `packages/target-chatgpt/contract.ts`（双方已约定的接口，由主开发者维护）

### 任务 A：图集检查和预览坐标模块，优先完成

你可以新建或修改的文件只有：

```text
packages/atlas-tools/index.ts
packages/atlas-tools/inspect.ts
packages/atlas-tools/playback.ts
tests/atlas-tools.test.ts
docs/ATLAS_TOOLS.md
```

如需更多文件，请保持在 `packages/atlas-tools/` 下。不要修改根目录配置、lockfile、`src/`、`electron/`、其他测试、共享契约或其他包；不要格式化全仓库。此任务无需安装新的运行时依赖。

通过 `../target-chatgpt/contract` 导入类型和常量。用 TypeScript 实现纯函数，不依赖 Electron、Node、DOM 或 Three.js，不读取磁盘、不发网络请求、不上传宠物。

从 `packages/atlas-tools/index.ts` 导出以下函数和共享类型：

```ts
import type {
  AtlasPixels, AtlasProfile, AtlasInspection, FrameRect, AnimationState,
} from '../target-chatgpt/contract';

export function inspectAtlas(
  image: AtlasPixels,
  profile: AtlasProfile,
  encodedBytes?: number,
): AtlasInspection;

export function getAnimationFrameRect(
  state: AnimationState,
  timeSeconds: number,
  fps?: number, // 默认 8
): FrameRect;

export function getLookFrameRect(angleDegrees: number): FrameRect;
```

**inspectAtlas 的必要行为：**

1. 精确验证宽高、RGBA 数据长度；尺寸或数据长度无效时直接返回清楚错误，避免继续越界扫描。
2. 如提供 `encodedBytes`，必须为正的安全整数且不大于 20 MiB。
3. v1 有九行，共 57 个必需帧；v2 有十一行，共 73 个必需帧。每行有效帧位于最左侧，数量从共享契约读取。
4. 每个必需格必须有 alpha 大于零的像素，否则报 `empty-frame`，携带从零开始的 row、frame。
5. 所有未使用格必须全透明；任意 alpha 大于零时报 `unused-cell`。
6. 整张图完全不透明时报 `opaque-background`。不要把合理的单格内容覆盖率、碰到某条边或非黑 RGB 当成必然错误。
7. `valid` 仅表示以上结构检查通过。始终在 `warnings` 说明：未判断动作语义、角色一致性、视线正确性，也未替代目标平台预检。
8. 无效数值不能抛出无说明的运行时异常；如 TypeScript 输入契约之外的 profile 值出现，请用清楚的异常拒绝，不悄悄降级。

**播放坐标的必要行为：**

- 返回像素坐标，单格固定 192×208；动画按各行实际帧数循环，不能播放尾部空格。
- `timeSeconds` 为负数、NaN 或 Infinity 时按零处理；无效 fps 按默认 8 处理。
- 状态不合法时以清楚的异常拒绝。
- 视线取最接近的 22.5° 方向，0° 朝屏幕上方，顺时针。0–157.5° 位于第 9 行；180–337.5° 位于第 10 行。
- 角度应正确归一化，支持负数、超过 360° 的角度与 359°→0° 跨界。无效角度按 0°。
- 不做整张图片镜像、模型旋转或像素重绘。

**测试要求：**

用仓库已有 Vitest，运行 `npm test -- tests/atlas-tools.test.ts`。覆盖以下真实边界，而不是只复制实现：

- 正确 v1 / v2，必需格为空，尾部空格被污染。
- 数据长度不符、尺寸不符、文件为零字节或超过上限。
- 全不透明背景；正常透明图不误报。
- 每种动画循环到尾帧和下一轮，未播放空白列。
- 四个视线正方向、负角度、超过一圈、359° 环绕。
- 非有限输入及不合法状态/profile。

可以程序构造测试 RGBA 数组；这些只是结构测试数据，不是角色艺术或可上传宠物。不要把合成测试图用于创建或安装宠物。

在 `docs/ATLAS_TOOLS.md` 说明调用示例、数值边界、局限，以及本地结构检查与官方校验之间的区别。

### 任务 B：寻找可用的动漫角色资源，可选

仅新建 `docs/RESOURCE_CANDIDATES.md`，调查 3–5 个 VRM 动漫角色候选，优先原创、来源可追溯、有清楚许可的资源。

每项记录：作者、原始发布页、提供文件格式、模型版本（若可确认）、个人桌宠使用条件、渲染动画/精灵图导出条件、上传第三方平台条件、源模型及渲染产物再分发条件、署名要求、核查日期、未确认项。

只使用作者原始发布页或官方说明作为依据，不通过搜索摘要推断授权。无法确认就标注未知；不要声称“免费=可随软件发布”。不要购买、注册账户、代发询问信息或将模型上传到任何平台。

### 交付方式

- 若共享工作区：直接写入上面约定的文件，完成后给出文件清单、测试命令和真实测试结果。不要提交或推送其他人的改动。
- 若独立工作区：返回 Git patch 或仅含上述文件的压缩包；尽量不直接在聊天里贴所有源码。
- 说明已完成项、失败项、已知限制和需要主开发者决定的问题。
- 依赖安装或测试工具不可用时，保留实现并明确说明未运行测试，不编造成功结果。

## 主开发者的对接责任

1. 维护 `packages/target-chatgpt/contract.ts`；需要变更时先同步接口。
2. 开发期间不创建或修改 DeepSeek 拥有的上述模块文件。
3. 主界面先完成 VRM 实时预览与导出，模块交回后接入结构检查和逐帧预览。
4. 合并后运行全量类型检查和测试；最终安装前还要执行目标平台真实预检及人工动作检查。
