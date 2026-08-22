## Purpose

将 DSH Forge 的 canonical 文档以可审计、可复现的双语静态站形式发布，保持文档源文件的目录所有权，并为 GitHub Pages 保留稳定的静态构建接口。

## ADDED Requirements

### Requirement: 网站必须从 canonical 文档发布而不是维护副本
文档站 SHALL 只维护发布清单、路由/侧栏配置和站点资源；公开 Markdown 的正文 MUST 继续由 `docs/` 或包/工具所有权目录维护。网站构建 MUST 从发布清单投影文档，不得把 `website/` 下的复制 Markdown 作为第二事实来源。

#### Scenario: 发布一篇公开文档
- **WHEN** 发布清单选择一对公开英文/中文文档
- **THEN** 构建从 canonical 文件读取正文并分别生成中文根路由和 `/en/` 英文路由

#### Scenario: 网站目录出现正文副本
- **WHEN** `website/` 中新增未被忽略的 Markdown 正文文件
- **THEN** 网站检查失败并要求将正文移回其 canonical 所有权目录

### Requirement: 双语站点路由和导航必须由发布清单确定
发布清单 SHALL 为每个页面声明源文件、内容语言、站点路由、导航标签、侧栏分组和稳定顺序。中文站点 MUST 使用根路由，英文站点 MUST 使用 `/en/` 前缀；同一页面的两种语言路由必须能相互定位。

#### Scenario: 生成双语路由
- **WHEN** 构建读取完整的发布清单
- **THEN** 每个已发布中文页面都有对应的英文路由，且两者的源文件语言与标签配置一致

#### Scenario: 发布清单存在重复路由
- **WHEN** 两个页面声明相同 locale 和相同路由
- **THEN** 构建在生成 HTML 前失败并指出冲突页面

### Requirement: 网站构建必须产生可移植静态产物
网站构建 SHALL 只依赖仓库内容和锁定的构建依赖，输出可直接部署到静态文件服务器的目录；构建不得要求运行 DSH Host、访问用户数据、访问生产 API 或在构建时下载插件。构建必须保留 raw Markdown 页面，供自动化消费者读取。

#### Scenario: 在干净环境构建网站
- **WHEN** 依赖已按 lockfile 安装且执行文档站构建
- **THEN** 构建生成包含双语 HTML、静态资源、每个发布路由 raw Markdown 和站点索引的目录

#### Scenario: 构建依赖运行时能力
- **WHEN** 网站构建尝试读取 Electron、DSH Home、profile、catalog 或外部网络状态
- **THEN** 构建失败或被检查拒绝，不得将这些运行时事实作为网站输入

### Requirement: 顶部搜索必须使用本地索引并支持键盘快捷键
文档站顶部 SHALL 提供基于 VitePress local provider 的搜索按钮和输入界面。搜索 MUST 使用构建时生成的站点索引，不得依赖外部搜索服务；用户按 `⌘K` 或 `Ctrl+K` 时 MUST 能打开搜索。中文根路由和英文 `/en/` 路由 MUST 展示对应语言的搜索文案。

#### Scenario: 打开顶部搜索
- **WHEN** 读者点击顶部搜索按钮或按下 `⌘K`/`Ctrl+K`
- **THEN** 站点打开本地文档搜索界面，并显示当前语言的搜索文案

#### Scenario: 搜索索引可离线使用
- **WHEN** 站点在无外部网络的静态服务器上运行
- **THEN** 搜索仍从构建产物索引返回已发布页面结果，不请求第三方搜索服务

### Requirement: 网站必须验证站内链接和片段
网站检查 SHALL 验证 canonical 相对链接投影后的站内目标、语言切换目标、发布路由和构建 HTML 中的 fragment id。不存在的页面、raw Markdown 文件或 fragment MUST 使网站检查失败。

#### Scenario: 站内链接和片段完整
- **WHEN** 所有发布页面、raw Markdown twin 和 HTML fragment 均存在
- **THEN** 网站检查成功并报告检查数量

#### Scenario: 站内片段不存在
- **WHEN** 任一页面链接到未生成的路由或 HTML 中不存在的 fragment
- **THEN** 网站检查失败并报告来源页面、目标和 fragment

### Requirement: 构建接口必须兼容 GitHub Pages 静态部署
网站输出 MUST 能部署到 GitHub Pages 的静态站点；路径前缀、相对资源引用和 404/单页导航策略必须通过仓库配置显式声明。实现本变更时不得要求启用 GitHub Actions、配置凭据或执行实际部署。

#### Scenario: 生成 GitHub Pages 兼容产物
- **WHEN** 使用仓库声明的静态构建命令生成站点
- **THEN** 输出目录可以作为 GitHub Pages 发布目录使用，且页面资源不会依赖本地绝对路径

#### Scenario: 未配置部署凭据
- **WHEN** 构建环境没有 GitHub token、远程仓库写权限或部署服务
- **THEN** 本地网站构建和检查仍可完成，但不得声称 GitHub Pages 已部署
