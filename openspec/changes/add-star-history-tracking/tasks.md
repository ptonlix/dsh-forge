## 1. 设计与供应链边界

- [x] 1.1 调研 GitHub stargazer 接口限制与当前可用的仓库内生成方案，选择固定提交的 self-hosted Action。
- [x] 1.2 定义独立数据分支、最小写权限、触发事件、并发策略与首次生成限制。

## 2. 自动化与呈现

- [x] 2.1 新增 `star-history.yml`，在定时、加星事件和手动触发时生成两种主题图表并发布到 `star-history`。
- [x] 2.2 在中英文根 README 的末尾添加稳定 Raw URL 的 `<picture>` 图表。

## 3. 验证

- [x] 3.1 已运行 YAML/Markdown 静态检查和文档门禁；`docs:pair`、`docs:check` 被既有中英文 README 总体结构不一致阻断，`docs:build` 通过。环境未安装 OpenSpec CLI，未执行严格校验。
- [ ] 3.2 在 GitHub Actions 手动运行一次，并在浅色/深色主题下确认远程 SVG 加载。
