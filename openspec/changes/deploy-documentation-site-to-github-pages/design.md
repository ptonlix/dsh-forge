## Context

现有 `website/` workspace 已通过 `scripts/build-site.ts` 将 canonical Markdown 投影到 `website/.generated/`，再由 VitePress 输出到 `website/.dist/`；`DOCS_BASE` 控制项目 Pages 的资源前缀。现有站点变更只预留静态输出接口，没有自动部署 workflow。详见 `proposal.md` 和 `specs/documentation-site-github-pages/spec.md`。

## Goals / Non-Goals

**Goals:**

- 将现有 `pnpm run docs:check`、`pnpm run docs:build` 接入 GitHub Actions。
- 使用 Pages artifact/deploy action，保持构建和部署 job 的权限分离。
- 从 `configure-pages` 的 `base_path` 适配项目站点、用户/组织站点和自定义域名。
- 消除生成文档回链中的组织名和默认分支漂移。

**Non-Goals:**

- 不把 `website/.dist/`、`website/.generated/` 或 `gh-pages` 分支作为 canonical 文档源。
- 不改变 VitePress 页面清单、双语路由、本地搜索或 Electron 产品行为。
- 不在仓库中保存 GitHub token、域名凭据或生产签名材料。

## Decisions

### 使用独立 Pages workflow

新增 `.github/workflows/docs-pages.yml`，而不是把部署步骤加入桌面发布 workflow。文档和桌面发行包触发条件、权限和失败边界不同，独立 workflow 能避免桌面发布失败或凭据影响文档站。

曾考虑提交构建产物到 `gh-pages` 分支，但该方式会产生第二套生成物分支，并绕过现有构建检查，因此不采用。GitHub 官方 Pages artifact 流程与当前 `.dist` 输出直接匹配。

### 使用动态 `base_path`

构建 job 先运行 `actions/configure-pages`，再把其 `base_path` 拼接结尾 `/` 传给 `DOCS_BASE`。这样项目站点使用 `/dsh-forge/`，自定义域名使用 `/`，不在源码中硬编码部署域名。

### 构建与部署权限分离

工作流顶层只授予 `contents: read`；仅 deploy job 授予 `pages: write` 和 `id-token: write`，并设置 `github-pages` environment。构建失败通过 `needs` 阻止部署，artifact 只来自当前 job 的完整 `.dist` 目录。

### 统一仓库身份

当前 `origin`、根 `package.json` 和发布更新地址均使用 `ptonlix/dsh-forge`，因此将文档投影回链和 VitePress 社交链接统一到该仓库及 `main` 分支。若仓库未来迁移，必须在同一变更中同步这些事实和测试。

## Risks / Trade-offs

- [Pages 设置未选择 GitHub Actions] → 在仓库 `Settings → Pages` 中明确选择 GitHub Actions，并让首次 workflow 运行创建 `github-pages` environment。
- [项目路径变化导致资源 404] → 使用 `configure-pages` 动态读取 `base_path`，并在 workflow 中保留带 `/dsh-forge/` 的构建 smoke。
- [第三方 action 标签漂移] → 先沿用仓库现有 GitHub Actions 版本策略；进一步加强供应链时可把 action 标签固定到审计后的完整 SHA。
- [远程环境尚未在本地验证] → 本地只记录静态构建证据；首次 Actions 成功后再补充远程部署 URL 和浏览器/HTTP smoke 证据。

## Migration Plan

1. 合并 OpenSpec、workflow、仓库回链修正和测试更新。
2. 在仓库设置中选择 GitHub Actions 作为 Pages source。
3. 推送到 `main` 或手动运行 workflow，检查 build、artifact 和 deploy 三个阶段。
4. 访问 Pages URL，检查中文首页、英文 `/en/`、深层页面、搜索、raw Markdown 和 `llms.txt`。
5. 将实际 workflow 运行日期、URL 和未覆盖平台写入 `docs/engineering/foundation-verification.md`。

回滚时禁用或删除该 workflow 并将 Pages source 切换为其他受控来源；不回滚 canonical 文档，也不手工修改被忽略的构建产物。
