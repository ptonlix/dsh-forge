## Why

当前文档站已经能生成经过校验的 VitePress 静态产物，但仓库没有自动发布流程，维护者仍需手工搬运或部署生成物。现在将构建产物接入 GitHub Pages，可以让 `main` 分支的 canonical 文档在每次变更后自动发布，并保留本地构建与远程部署之间的可验证边界。

## What Changes

- 新增 GitHub Actions workflow，在 `main` 推送或手动触发时构建并部署文档站。
- 使用 GitHub Pages artifact 和 `github-pages` environment 发布 `website/.dist`，构建期间从 Pages 元数据取得项目路径或自定义域名路径。
- 在部署前执行 `docs:check` 和 `docs:build`，失败时禁止发布不完整产物。
- 统一文档站生成的 GitHub 仓库回链、默认分支和顶部 GitHub 链接，避免指向错误的组织或 `master` 分支。
- 同步站点链接测试和工程验证记录；只在实际远程部署成功后记录部署证据。

## Capabilities

### New Capabilities

- `documentation-site-github-pages`: 定义文档站通过 GitHub Actions 构建、校验和部署到 GitHub Pages 的触发、权限、路径和失败语义。

### Modified Capabilities

- 无。现有 `documentation-site-publication` 负责静态产物接口；本变更新增其外部部署自动化，不改变 canonical 文档或站点路由契约。

## Impact

- 新增 `.github/workflows/docs-pages.yml`，使用 GitHub 官方 Pages actions，不新增运行时依赖或桌面发行包内容。
- 修改 `scripts/project-docs.ts`、`website/.vitepress/config.mts` 及对应站点测试，使生成链接与当前仓库 `ptonlix/dsh-forge`、`main` 分支一致。
- 更新 `docs/engineering/foundation-verification.md`，区分本地构建证据和首次真实 GitHub Pages 部署证据。
- 需要运行 OpenSpec 严格校验、文档检查、站点测试、带项目 base path 的构建和 `git diff --check`；实际远程 Pages smoke 只能在 GitHub Actions 中完成。
