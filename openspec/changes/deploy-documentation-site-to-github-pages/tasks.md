## 1. GitHub Pages workflow

- [x] 1.1 新增 `.github/workflows/docs-pages.yml`，在 `main` 推送和手动触发时运行，并固定 Node.js `22.14.0`、pnpm `11.7.0`；用 workflow 文件审查触发条件和版本
- [x] 1.2 在 build job 中执行 `pnpm install --frozen-lockfile`、构建 `@dsh-forge/desktop-services`、`pnpm run docs:check`、带 `DOCS_BASE` 的 `pnpm run docs:build`，并上传 `website/.dist` Pages artifact；用本地等价命令和 artifact 路径检查验证
- [x] 1.3 在独立 deploy job 中配置 `github-pages` environment、`pages: write`、`id-token: write` 和 `needs: build`，调用 `actions/deploy-pages`；用 workflow YAML 静态检查确认构建失败不会部署

## 2. 仓库身份与站点链接

- [x] 2.1 将文档投影回链统一到 `https://github.com/ptonlix/dsh-forge/blob/main/`；用站点链接测试验证内部文档目标
- [x] 2.2 将 VitePress 顶部 GitHub 链接统一到 `https://github.com/ptonlix/dsh-forge`；用生成配置或 HTML 输出检查链接
- [x] 2.3 更新 `tests/website-docs.test.ts` 断言并覆盖仓库所有者和 `main` 分支；运行该定向测试

## 3. 文档记录与集成验证

- [x] 3.1 更新 `docs/engineering/foundation-verification.md`，记录 workflow 接入但保留“实际远程部署需在 GitHub Actions 完成”的事实；用 `docs:check` 检查文档链接和命令
- [x] 3.2 运行 `pnpm exec vitest run tests/website-docs.test.ts tests/bilingual-docs.test.ts`、`pnpm run docs:check`、`pnpm run docs:build` 和 `DOCS_BASE=/dsh-forge/ pnpm run docs:build`；记录实际结果
- [x] 3.3 运行 OpenSpec 严格校验和 `git diff --check`，复读 workflow、站点输出和变更范围后完成交付
