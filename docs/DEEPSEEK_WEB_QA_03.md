# 阶段三 D17 浏览器主程序验收报告

2026-10-23，工作区 `E:\GitWorkSpace\OiGptPet`，分支 `codex/desktop-prototype`。

本批只新增 `scripts/web-library-smoke.mjs` 与本文档；没有修改 `src/**`、`electron/**`、`packages/**`、既有测试、根配置或依赖，没有提交、推送、上传或激活 ChatGPT 宠物。

## 结论

D17 验收通过。真实 `src/main.ts` 页面在隔离的临时 Chromium 窗口中完成旧 IndexedDB VRM 迁移、改名与刷新持久化、真实 PNG 派生 WebP 的主界面导入、无效输入保护、切回 VRM 恢复导出。`pageerror` 与 console error 均为空。

运行同时记录到一个非阻断的布局异常：切回 VRM 后缩放窗口，画布 CSS 尺寸仍停留在精灵图阶段的旧值。D17 门槛不要求布局跟随，因此本次 smoke 不据此失败；该问题已写入 `docs/DEEPSEEK_REVIEW_03.md`，交 Codex 修复。

## 验证方式与隔离

- 用 `@playwright/test` 启动临时 Electron 45 Chromium 窗口，加载真实 `src/main.ts` 页面；临时应用没有本项目的 preload，也没有暴露 `petDesktop`。
- 临时 `userData`、Vite 缓存、WebP 输入文件和临时 Electron 应用全部位于本次 `mkdtemp` 创建的 `%TEMP%\oigptpet-web-library-*` 目录下。清理前由脚本的 `removeOwnTempDirectory` 核验目标位于系统临时目录、名称带 `oigptpet-web-library-` 前缀且不是盘符路径。
- Vite 使用 `configFile: false`、随机端口（本次 `127.0.0.1:62486`）、`host: '127.0.0.1'`、`hmr: false`、独立 `cacheDir`，并显式设置 `define: { __WITH_DEMO__: 'false' }`。没有访问 5173 或主用户数据。
- 为验证“旧库 → 主界面迁移”，先用路由拦截把 `/src/main.ts` 替换为空模块，在隔离 profile 中创建旧库并写入 VRM；随后撤销拦截、重新加载真实主页面，由 `src/main.ts` 触发迁移。导入 WebP 走 `#model-file` 文件输入，不直接调用角色库 `add`。
- 说明：这里验证的是 Chromium 浏览器代码路径，不等同于外部 Chrome/Edge 或真实 LAN/手机浏览器测试。

## 命令与结果

```text
node --check scripts/web-library-smoke.mjs
node scripts/web-library-smoke.mjs
```

两条命令均通过。smoke 退出信息：

```text
Web library smoke passed: real main page migrated the legacy IndexedDB VRM, renamed and refreshed it, imported real PNG-derived v1/v2 WebP through the file input, preserved state on invalid files, and restored VRM export. E:\GitWorkSpace\OiGptPet\artifacts\web-library\run-20261023022744
```

产物目录为新建的 `artifacts/web-library/run-20261023022744/`，未覆盖既有证据。`result.json` 为 5,383 字节，SHA-256 `51dc36f16d81e9e884228473358ab87b321c2687d99fe6cc0ec192e03c6f8756`。

## 场景结果

### 1. 旧库迁移

- 旧库：`oigptpet` 版本 1，`models` store，`current` 为真实 VRM `ArrayBuffer`。
- VRM：`public/models/demo.vrm`，10,776,032 字节，SHA-256 `12c2b97e95e700783a6a550dc0eee2d7880aeedccef9ae67bc4c5a2f0f2631a2`。
- 重新打开真实主页面后自动迁移：
  - 新库 ID：`vrm:12c2b97e95e700783a6a550dc0eee2d7880aeedccef9ae67bc4c5a2f0f2631a2`
  - 名称：`VRM1_Constraint_Twist_Sample`
  - 新库 active 与唯一列表项均指向该 ID
  - 原始 Blob 与新库 `characters`/`assets` 的摘要、字节数一致
- 迁移后旧库仍为版本 1，`models` store 仍在，`current` 的字节数与 SHA-256 均未变化。

### 2. 改名、刷新与浏览器能力

- 在主界面把名称改为 `浏览器搭档`；刷新后名称、active、别名输入框和唯一列表项均保留，没有产生重复迁移，旧库摘要仍不变。
- 浏览器能力实测：
  - `typeof window.petDesktop === "undefined"`
  - “放到桌面”按钮禁用，文本为“桌面版功能”
  - 桌宠大小 `#pet-scale` 禁用
  - 动画性能 `#performance-mode` 可用
  - 示例入口 `#load-demo` 隐藏（`__WITH_DEMO__: 'false'`）
  - 格式徽标为 `VRM 1.0`
  - 页面可见，画布已渲染；浏览器内预览和文件导入正常

### 3. 真实 PNG 派生 WebP 的主界面导入

测试输入不是直接把 PNG 当 WebP：每次运行在页面内用 `createImageBitmap` + Canvas 2D 重编码为 `image/webp`，再经 `#model-file` 导入。WebP 摘要与源 PNG 摘要不同，脚本先断言这一点。

| 文件 | 来源 | 输入字节 | 输入 SHA-256 | 尺寸 | 实际导入 WebP 字节 | 实际 WebP SHA-256 |
| --- | --- | ---: | --- | --- | ---: | --- |
| v1 PNG | `artifacts/animation-fixes/run-04/atlas-v1.png` | 293,190 | `05ac930c71c9a8f5308c2fc4c5aedcffaec99b865cbdc5a36b1c4ade1156e8f6` | 1536×1872 | 506,194 | `d43bb5a90601e7a316d1102e64c40d3453ed17cfcabf1d462dd85269e534d6c3` |
| v2 PNG | `artifacts/animation-fixes/run-04/atlas-v2.png` | 370,954 | `84604125009381796d748388ab5b934dd9faac581b8cd8a00fd4417b4b3acada` | 1536×2288 | 630,984 | `c678283924c8594d117eb234950a1f570eecd18acc4a7b83fa6a73ab33a84817` |

导入结果：

- v2：选中规格 v2，导入后 active 为 `sprite:v2:c6782839…`，库内规格为 v2、kind 为 sprite，存储字节与摘要等于实际 WebP；Canvas 2D 检测到实际不透明像素（alpha ≥ 8 且超过 64 个），刷新后恢复为同一 active，导出按钮禁用。
- v1：选中规格 v1，导入后 active 为 `sprite:v1:d43bb5a9…`，库内规格为 v1，存储字节与摘要等于实际 WebP；Canvas 2D 检测到不透明像素，导出按钮禁用。
- 两次导入后库内共 3 个条目（原 VRM + v2 + v1）。
- 精灵图导出按钮标题：`精灵图可直接播放；导出新动作需要源 VRM。`

### 4. 无效文件保护与源导出恢复

- 错误规格：把 v1 WebP 以 v2 规格导入，状态为
  `图集尺寸必须为 1536×2288（v2），实际为 1536×1872。 已保留原角色。`
  当前角色仍为 v1 精灵图，库仍为 3 个条目。
- 损坏文件：把 v2 WebP 截断为 96 字节后以 v1 规格导入，状态为
  `WebP 声明的大小超过实际数据，文件可能已被截断。 已保留原角色。`
  当前角色仍为 v1 精灵图，库仍为 3 个条目，条目 ID 集合与操作前一致。
- 切回已迁移 VRM：名称仍为 `浏览器搭档`，格式徽标 `VRM 1.0`，库 active 指向该 VRM，源 VRM 导出按钮恢复可用。
- `pageErrors` 与 `consoleErrors` 结束时均为空数组。

## 产物

目录：`artifacts/web-library/run-20261023022744/`

| 文件 | 字节 | 说明 |
| --- | ---: | --- |
| `result.json` | 5,383 | 结构化结果、哈希、能力、持久化、耗时与错误收集 |
| `migrated-vrm.png` | 188,262 | 旧库迁移后、改名前的 VRM 主界面 |
| `webp-v2.png` | 191,497 | v2 WebP 导入后的精灵图预览 |
| `final-vrm.png` | 152,375 | 切回 VRM 并缩放窗口后的画面（含下述布局观察） |

## 环境与耗时

- Electron 45.0.0，Chromium 156.0.8078.48，应用 Node 24.22.0；Windows 10 x64，12 CPU，25,590,673,408 字节内存。
- 可见临时 Chromium 窗口，初始窗口 1280×900，最终内容区缩放到 980×760；本地 Vite dev server；隔离临时 userData 与缓存；单进程。
- 总耗时 28,352.5 ms（含 Vite 启动、Electron 启动、模型加载、多次页面刷新、WebP 重编码与导入）。
- 分项：Vite 81.8 ms；Electron 启动 1,722.9 ms；旧库写入 1,214.6 ms；迁移 6,658.4 ms；改名刷新 3,798.6 ms；WebP 重编码 2,430.8 ms；v2 导入 2,070.9 ms；v2 刷新 516.6 ms；v1 导入 388.4 ms；无效输入 457.1 ms；切回 VRM 936.1 ms。这是本机实际耗时，不是跨硬件保证。

## 补充观察：画布尺寸未跟随窗口

切回 VRM 后把 BrowserWindow 内容区缩放到 980×760，`result.json` 的 `layoutAudit` 记录：

- 容器：541×400
- 画布：763×425
- 画布 inline CSS：`width: 763px; height: 425px`
- computed：`width: 763px; height: 425px`
- `matchesHost: false`

这不是 D17 的验收门槛，smoke 未据此失败；但它是可复现的界面缺陷。触发步骤、根因代码位置和影响见 `docs/DEEPSEEK_REVIEW_03.md`。

## 未执行项与边界

- 未使用外部 Chrome/Edge、真实 LAN 地址或手机浏览器；临时 Electron Chromium 不能替代这些环境的验收。
- 未做完整应用退出再启动；持久化用两次页面刷新验证（D17 允许“刷新或完整重启”）。整应用首次启动/重启由 Codex 的 Windows 包检查覆盖。
- 未重新运行全部单元测试、原主 smoke、原导出 smoke 或打包脚本；本批只按要求运行 `node --check` 与本 smoke。
- 临时 Electron 应用没有 preload/`petDesktop`，因此本报告不覆盖桌面桥、桌宠窗口同步、托盘、透明置顶或真实设置存储；这些由现有 phase-three smoke 与 Codex 发布检查覆盖。
- 未上传或激活 ChatGPT 宠物；WebP 仅作为浏览器内测试输入，不能据此宣称目标平台已接受图集。
