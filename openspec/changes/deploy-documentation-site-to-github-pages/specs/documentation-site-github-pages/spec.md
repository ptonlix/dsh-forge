## Purpose

为已经通过本地校验的 DSH Forge 静态文档站提供可审计的 GitHub Pages 自动发布能力，使 canonical 文档变更能够在受控权限下稳定上线。

## ADDED Requirements

### Requirement: 文档站必须在默认分支变更后自动构建

文档站发布工作流 SHALL 在默认分支 `main` 的推送和维护者手动触发时运行，并使用仓库锁定的 Node.js 与 pnpm 版本安装依赖。工作流 MUST 只从仓库 canonical 文档和锁定依赖构建站点。

#### Scenario: main 分支推送

- **WHEN** 提交推送到 `main`
- **THEN** 工作流安装锁定依赖并执行文档检查与站点构建

#### Scenario: 手动运行工作流

- **WHEN** 维护者从 GitHub Actions 手动运行文档发布工作流
- **THEN** 工作流使用当前提交重新构建站点并继续执行相同的检查流程

### Requirement: 构建失败时不得部署

发布工作流 MUST 在上传 Pages artifact 前成功完成 `docs:check` 和 `docs:build`。任一检查、依赖安装或构建失败时，工作流 MUST 不得执行 Pages 部署。

#### Scenario: 文档检查失败

- **WHEN** `docs:check` 报告无效文档
- **THEN** 构建 job 失败且 deploy job 不运行

#### Scenario: 站点构建失败

- **WHEN** `docs:build` 无法生成完整站点
- **THEN** Pages artifact 不被视为可发布输入且 deploy job 不运行

### Requirement: Pages 部署必须使用最小权限和受控环境

部署 job MUST 仅在构建 job 成功后运行，并使用 GitHub Pages artifact、`github-pages` environment、`pages: write` 和 `id-token: write` 权限。构建 job 不得获得 Pages 写权限。

#### Scenario: 构建成功后部署

- **WHEN** 构建 job 上传 `website/.dist` artifact
- **THEN** deploy job 使用 `github-pages` environment 发布该 artifact，并暴露 Pages URL

#### Scenario: 构建未成功

- **WHEN** 构建 job 失败或未上传 artifact
- **THEN** deploy job 不得尝试部署或创建新的 Pages 版本

### Requirement: 构建必须适配项目路径和自定义域名

工作流 SHALL 从 GitHub Pages 元数据取得 `base_path` 并传入 `DOCS_BASE`。项目站点必须生成带仓库路径的资源和链接；用户/组织站点或自定义域名必须生成根路径资源和链接。

#### Scenario: 项目站点部署

- **WHEN** Pages 地址为 `https://<owner>.github.io/dsh-forge/`
- **THEN** 构建使用 `/dsh-forge/` base path，页面资源和语言切换链接均包含该前缀

#### Scenario: 自定义域名部署

- **WHEN** Pages 地址使用自定义域名且没有仓库子路径
- **THEN** 构建使用 `/` base path，页面资源不包含错误的仓库路径

### Requirement: 仓库回链必须指向当前 canonical 仓库

站点生成的未发布内部文档链接和顶部 GitHub 链接 MUST 指向当前 canonical 仓库 `https://github.com/ptonlix/dsh-forge` 的 `main` 分支。测试 MUST 覆盖该仓库身份和分支事实。

#### Scenario: 内部文档回链

- **WHEN** canonical 页面链接到未发布的内部维护文档
- **THEN** 投影页面回链到 `https://github.com/ptonlix/dsh-forge/blob/main/...`

#### Scenario: 顶部 GitHub 链接

- **WHEN** 读者点击站点顶部 GitHub 图标
- **THEN** 浏览器打开 `https://github.com/ptonlix/dsh-forge`
