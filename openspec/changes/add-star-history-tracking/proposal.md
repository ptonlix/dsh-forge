## Why

GitHub 已限制按时间读取 stargazer 的接口，第三方托管的 README 星标曲线无法稳定生成任意仓库的最新数据。DSH Forge 需要在仓库首页展示可持续更新的 Star 增长曲线，但不应将访问凭据或生成产物混入默认分支。

## What Changes

- 新增 GitHub Actions workflow，以仓库自身的 `GITHUB_TOKEN` 读取本仓库的加星时间线并生成浅色、深色 SVG。
- 将图表发布到专用的 `star-history` 数据分支，避免定时提交污染 `main` 的开发历史。
- 在中英文根 README 的末尾嵌入同一份图表，并通过 `<picture>` 自动适配 GitHub 的浅色和深色主题。
- 锁定生成 Action 到已审查的完整提交，而非浮动 tag。

## Capabilities

### New Capabilities

- `github-star-history`: 定义 DSH Forge Star 历史图表的生成触发、最小权限、数据分支和 README 呈现方式。

### Modified Capabilities

- 无。

## Impact

- 新增 `.github/workflows/star-history.yml` 和 OpenSpec 变更材料；不新增 npm 依赖，不改变 Electron、profile 或发行包。
- 修改 `README.md` 与 `README.zh.md` 的末尾展示区；首次 GitHub Actions 成功前，远程 SVG 尚不存在。
- 远程 workflow 需要 `contents: write` 以仅向专用数据分支发布图表；本地无法替代验证 GitHub 的 stargazer 权限与实际 push。
