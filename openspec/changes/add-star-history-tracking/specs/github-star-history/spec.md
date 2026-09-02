## Purpose

为 DSH Forge 仓库首页提供不依赖第三方托管查询服务、可按 GitHub 主题适配的 Star 历史曲线。

## ADDED Requirements

### Requirement: 工作流必须在仓库权限内生成 Star 历史图表

Star 历史工作流 SHALL 在每日定时任务、`watch.started` 事件和维护者手动触发时运行。工作流 MUST 使用当前仓库自动注入的 token 读取当前仓库的加星时间线，且不得要求在仓库中保存个人访问令牌。

#### Scenario: 新 Star 到达

- **WHEN** GitHub 为本仓库派发 `watch.started` 事件
- **THEN** 工作流生成并发布新的图表，或在图表数据未变化时不产生额外输出

#### Scenario: 首次或故障恢复

- **WHEN** 维护者手动触发工作流
- **THEN** 工作流使用当前仓库提交重新生成图表，不依赖先前生成物存在

### Requirement: 图表产物必须与默认分支隔离

工作流 MUST 仅使用 `contents: write` 发布浅色与深色 SVG 到 `star-history` 专用数据分支。该工作流不得向 `main` 写入图表提交；并发运行 MUST 收敛为单一写入序列。

#### Scenario: 数据变更

- **WHEN** 加星数据相较上次发布发生变化
- **THEN** `star-history` 分支更新两张 SVG，`main` 的提交历史不新增图表生成提交

#### Scenario: 多个触发重叠

- **WHEN** 定时任务与多个 `watch.started` 事件同时或连续发生
- **THEN** 较新的运行取消较旧的同组运行，避免并发向数据分支推送

### Requirement: README 必须呈现主题自适应的稳定图表地址

中英文根 README MUST 在末尾提供同一份 Star 历史图表。图表 MUST 使用 `<picture>` 为深色主题选择深色 SVG，并以浅色 SVG 作为回退；图片地址必须使用 `star-history` 分支中的稳定路径。

#### Scenario: 浅色主题浏览

- **WHEN** 读者在 GitHub 浅色主题查看任一根 README
- **THEN** 页面显示浅色 Star 历史 SVG

#### Scenario: 深色主题浏览

- **WHEN** 读者在 GitHub 深色主题查看任一根 README
- **THEN** 页面显示深色 Star 历史 SVG
