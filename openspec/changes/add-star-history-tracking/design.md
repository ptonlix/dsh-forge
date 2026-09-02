## Context

传统的 `api.star-history.com` README 图片由第三方服务读取 GitHub stargazer 时间线。GitHub 在 2026 年收紧该接口后，这类托管图表对任意仓库不再可靠。仓库内的 GitHub Actions 则可使用自动注入的 `GITHUB_TOKEN` 读取本仓库数据，并把静态 SVG 交由 GitHub Raw 提供。

## Goals / Non-Goals

**Goals:**

- 在不保存个人访问令牌的前提下，持续生成本仓库精确的按日期 Star 曲线。
- 使用浅色和深色 SVG，使 GitHub README 随阅读者主题切换。
- 将生成提交隔离到只保存图表的分支，避免干扰 `main` 与发布分支。
- 在收到新 Star 后尽快更新，同时保留每日任务处理取消 Star 和时间轴推进。

**Non-Goals:**

- 不在 Electron 产品、网页应用或 npm 包中加入统计逻辑。
- 不收集、展示或持久化单个 stargazer 的身份。
- 不把图表生成物、令牌或 GitHub Actions 运行结果作为本地手工文件提交。
- 不为任意第三方仓库提供跨仓库统计服务。

## Decisions

### 使用本仓库 GitHub Actions 而非托管 SVG API

工作流使用 `xpzouying/star-history` 的固定提交。该 Action 在 GitHub Actions 中生成 SVG，使用当前仓库的 `GITHUB_TOKEN`，无需把个人令牌交给外部服务。选择完整 40 位提交以固定可审查的 Action 输入。

### 发布到专用数据分支

Action 的 `branch: star-history` 模式创建仅含两个 SVG 的孤儿数据分支，并在变更时覆盖该分支。`main` 不接收定时图表提交；该分支保留给此工作流，维护者不得在其中保存其他内容。README 使用稳定的 `raw.githubusercontent.com` 路径，因此图片更新不需要改写 README。

### 双触发与并发收敛

`watch.started` 在新的 Star 到达时触发，定时任务每天运行一次以同步取消 Star 并刷新时间轴，`workflow_dispatch` 供首次生成和故障恢复使用。所有运行进入同一 `star-history` concurrency group，新的运行会取消排队或正在运行的旧任务，避免一批 Star 产生重复写入。

### 主题自适应 README

两份根 README 使用 `<picture>`：深色 source 指向深色 SVG，`img` 回退为浅色 SVG。图表外层链接到仓库的 stargazers 页面，使图片在 GitHub 中可访问原始统计入口。

## Risks / Trade-offs

- [首次图表为空]：合并后由维护者手动运行一次 workflow；首次成功后 Raw URL 才有图片。
- [默认分支以外的 fork]：README 中 canonical URL 指向 `ptonlix/dsh-forge`；Fork 应在自己的变更中调整仓库身份和数据分支地址。
- [Action 或 GitHub API 失败]：工作流失败不会修改 `main`；保留上一次成功发布的静态 SVG，并可手动重试。
- [专用分支被误用]：该 Action 会 force-push `star-history`；分支仅可存放图表，其他内容应另建受控分支。

## Migration Plan

1. 合并 workflow、双语 README 与本变更材料。
2. 在 Actions 页面手动运行 `Update Star History`，确认 `star-history` 分支包含两张 SVG。
3. 在 GitHub 的浅色和深色主题下访问 README，确认两种图表均加载。
4. 回滚时删除或禁用 workflow，并停止引用数据分支；若需要删除远程数据分支，另行明确授权后执行。
