# 项目约定

- 用户验证桌面功能前，先用当前源码运行 `npm run verify:desktop`（编译、打包、实际 EXE 冒烟检查），提供此次生成的 EXE 路径和对应提交；不要让用户验证旧包。
- `release/` 只保留最近 3 个本地 Windows EXE 包目录（同一版本号的不同构建也分别计数）。成功打包后由 `scripts/package-retention.mjs` 自动清理，保留 `release/latest.json` 指向的当前包。不删除未知目录、模型、用户数据或 GitHub Release。
- 阶段检查点先保存本地提交再暂停；发布或推送按用户当次要求。额度至少保留 20%。
