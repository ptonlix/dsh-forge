## Context

当前仓库的文档入口是根 `README.md`、`docs/design/`、`docs/reference/`、`docs/engineering/`、包 README 和工具链 README。现有 `docs:check` 位于 profile-toolchain CLI，负责 Markdown 链接、命令、标记 YAML 示例和公开 service README；仓库没有网站 workspace，也没有中英文配对机制。

本变更同时触及文档所有权、翻译一致性、构建工具和发布路由。运行时 Electron、profile、bundle、catalog 和公开 desktop service 契约不因文档站改变。删除文档必须遵循用户确认的范围，并在删除前完成入站引用检查。

## Goals / Non-Goals

**Goals:**

- 为所有纳入公开范围的文档建立可审计的中英文配对和术语约束。
- 将 `docs/` 重新划分为发行版设计、公开参考、工程维护和双语治理四类事实来源，删除无关或重复内容。
- 让网站从 canonical 文档投影生成中文根路由和 `/en/` 英文路由，避免正文副本。
- 生成可在本地和 CI 验证的静态产物，并满足 GitHub Pages 的目录和资源路径约束。
- 把双语和站点一致性检查纳入现有 `docs:check` 与 `check:all`。

**Non-Goals:**

- 不修改 DSH agent loop、会话协议、Electron 运行时或发行版构建语义。
- 不翻译 `AGENTS.md`、`openspec/**` 或未纳入公开发布清单的内部记录。
- 不在本变更中创建 GitHub Actions、部署 token、域名、版本发布或实际 GitHub Pages 部署。
- 不把文档站嵌入 Electron renderer，也不提供应用内帮助中心或动态文档下载。
- 不新增自动翻译服务；翻译由维护者完成，脚本只验证结构、链接和一致性记录。

## Decisions

### 1. 使用同目录兄弟文件和 sidecar hash

公开文档采用 `foo.md`、`foo.zh.md`、`foo.i18n.yaml`。英文和中文同权，hash 记录两侧上次确认内容的 Git blob。选择 blob hash 而不是 commit hash，是因为同一变更中可以计算尚未提交的内容；选择兄弟文件而不是 locale 目录，是为了保留当前文档链接和目录所有权，避免引入第二套路径映射。

考虑过只维护中文源并生成英文、只在译文 frontmatter 写英文 commit，或使用独立翻译仓库。这些方案要么禁止中文先行，要么无法表达同一变更中的内容，要么让当前仓库的门禁无法覆盖译文，因此不采用。

### 2. 公开范围采用“所有公开文档，排除明确内部目录”

公开范围包含根 README、公开 design/reference、公开 engineering 文档、包 README 和工具链 README。`AGENTS.md` 是执行指令，`openspec/**` 是变更决策材料，双语规则自身是治理元文档，均明确排除。私有 provider README 可以放入 `internalBilingual` 进行内部配对校验，但必须同时保留在 `excluded`，不得进入站点。每个被删除或移出范围的文档必须有替代来源或删除理由，并经过入站链接搜索。

不会复制参考项目的 Agent Note 体系；本仓库继续以 `docs/engineering/` 记录已实现工程事实，以 OpenSpec 记录变更决策。

### 3. 网站使用独立 VitePress workspace 和 TypeScript 发布清单

新增 `website/` workspace。`website/docs.ts` 是唯一发布清单，声明 canonical source、content locale、route、label、sidebar 和 order。构建脚本将源 Markdown 投影到忽略的 `website/.generated/`，VitePress 输出到忽略的 `website/.dist/`。网站不维护正文 Markdown。

中文页面发布在根路由，英文页面发布在 `/en/`。站内语言切换由主题导航和投影链接共同提供；源文件保留 GitHub 可用的相对切换链接。每个路由另外生成 raw Markdown twin 和 `llms.txt` 索引，便于自动化读取，但这些都是构建产物。

主题启用 VitePress 本地搜索。搜索按钮固定在顶部导航，使用站点构建产物生成本地索引，并由 VitePress 处理 `⌘K`/`Ctrl+K` 快捷键；中文根路由和英文 `/en/` 路由分别使用对应语言的按钮、结果和键盘提示文案。GitHub 仅保留现有社交图标，不占用文字导航位。

选择显式发布清单而不是从目录自动发现，是为了把“哪些文档对外发布”与“仓库里有哪些 Markdown”分开，并能在清理 `docs/` 后检测漏发、重复路由和错误侧栏。选择 VitePress 是因为它适合纯静态输出并能保留 Markdown 生态；该依赖只属于 website workspace，不进入 Electron runtime。

### 4. 将站点检查拆为源检查、投影检查和构建检查

`docs:check` 继续由 profile-toolchain 负责源文档契约，并调用双语配对检查。网站 workspace 的单元测试验证发布清单和链接重写；站点构建后再检查 HTML fragment、raw Markdown 和 `llms.txt`。`check:all` 串联这些检查，但不把部署、签名或未运行平台 smoke 混入成功结论。

### 5. 为 GitHub Pages 保留静态路径接口但不绑定部署

网站构建输出是单一静态目录，base path、资源引用和 fallback 规则由仓库配置显式定义，默认可通过 GitHub Pages 项目站点路径发布。实现阶段只验证本地 `build`、`preview` 和产物结构；部署 workflow、token 和远程验证另行处理。

## Risks / Trade-offs

- [双语范围扩大导致迁移量大] → 先建立公开文档清单和术语表，再分批迁移；门禁按公开范围一次性生效，避免长期存在“部分双语”状态。
- [删除文档造成链接断裂] → 删除前运行全仓库入站链接搜索，站点发布清单和现有 docs:check 同时作为第二道检查；无法归属的内容先移入明确的工程文档而非直接丢弃。
- [英文/中文语义仍可能不准确] → hash 和结构门禁只负责发现漂移，评审仍必须检查术语、行为、限制和失败语义；不宣称自动翻译质量。
- [VitePress 投影引入路径或 fragment 漂移] → 发布清单测试、相对链接重写测试和构建后 fragment 检查共同验证；canonical 文档继续保留 GitHub 链接语义。
- [GitHub Pages base path 配置错误] → 将 base path 和静态资源前缀作为可测试配置，构建不得写入本地绝对路径；实际部署前仍需在 GitHub Pages 环境做人工 smoke。
- [website 依赖扩大仓库安装时间] → 将依赖限制在 website workspace，使用 lockfile 固定版本，不把 VitePress 引入生产桌面依赖。

## Migration Plan

1. 盘点现有 `docs/`、包 README、工具链 README 的读者、事实归属、入站链接和重复内容，形成公开文档清单及删除/合并决策。
2. 先建立 `docs/i18n/` 治理文档、术语表、配对 manifest 和验证脚本，再迁移根 README、公开 design/reference、engineering 和包 README；每对文档同一变更完成并记录 hash。
3. 将无关文档删除或合并到唯一权威来源，更新所有相对链接、README 入口、包 README 交叉引用和文档命令。
4. 新增 website workspace、发布清单、投影脚本、VitePress 配置和静态资源，先发布最小完整的公开文档集合，再逐步加入更多页面。
5. 接入 `docs:check`、`check:all`、站点测试和构建产物检查；记录本地静态构建结果以及未执行的 GitHub Pages 部署范围。

回滚时恢复文档源文件、发布清单和门禁配置的上一版本即可；不删除 `artifacts/`、用户 DSH Home、依赖缓存或其他生成产物。若站点投影失败，保留 canonical 文档和已生成的诊断，禁止用残缺 `.dist/` 目录作为发布输入。

## Open Questions

无。公开范围、静态构建和 GitHub Pages 预留边界已由用户确认；具体文档逐文件的删除/合并理由属于实施任务中的盘点结果，不改变本变更的规范。
