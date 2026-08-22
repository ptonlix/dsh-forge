## Why

DSH Forge 当前只有中文文档，且根 `README.md`、发行版设计、跨包 reference、工程边界和包 README 重复描述 profile、desktop service、信任和发布事实。已完成的盘点确认：`docs/` 只有五份文档，其中 `docs/engineering/agent-assets-migration.md` 是无入站引用的一次性上游资产迁移记录；其余文件都与当前发行版有关，但需要按读者和事实所有权重新分工。参考项目已经证明，双语兄弟文件、内容一致性记录和独立文档站可以同时满足 GitHub 阅读、维护审查和站点发布，但这些机制尚未进入本项目的契约或门禁。

现在建立统一的公开文档体系，可以在继续演进桌面发行版设计的同时，避免中文文档与英文文档漂移，并把仓库文档以可追溯方式发布为静态站；站点首期只要求仓库构建和预留 GitHub Pages 部署，不绑定具体发布流水线。

## What Changes

- 新增 `docs/README.md` 作为公开文档导航，并明确读者分层和事实所有权：根 `README.md` 只承担项目入口；`docs/design/dsh-forge.md` 只承担发行版架构；`docs/reference/foundation-contracts.md` 只承担跨包配置和公开 service 参考；`docs/engineering/foundation-boundaries.md` 只承担维护边界；包 README 和工具链 README 只承担自身 API 或操作参考。
- 将以下公开文档建立英文 `foo.md`、中文 `foo.zh.md` 与 `foo.i18n.yaml` 配对并纳入静态站：根 `README.md`、`docs/README.md`、`docs/design/dsh-forge.md`、`docs/reference/foundation-contracts.md`、`docs/engineering/foundation-boundaries.md`、`packages/desktop-services/README.md` 和 `tools/profile-toolchain/README.md`。
- 保留 `docs/engineering/foundation-verification.md` 作为只记录实际本地验证和平台覆盖的仓库工程记录，不把它作为公开站点的教程或 reference；保留 `packages/desktop-services-local/README.md`、`README.zh.md` 和 `README.i18n.yaml` 作为私有 provider 的内部维护文档，不把它作为第三方 consumer 文档或公开站点页面。
- 删除 `docs/engineering/agent-assets-migration.md`，因为它只记录一次性上游资产迁移、没有当前入站引用，也不属于 DSH Forge 的发行版、工具链、桌面宿主、公开 service 或维护事实；删除前后均需完成全仓库入站链接检查。
- 核心设计、reference 和工程边界文档保留既有路径，以免破坏已完成 OpenSpec 和包 README 的相对链接；通过重写和交叉链接收敛重复事实，不创建并列的新权威文档。
- `AGENTS.md`、`openspec/**`、双语治理元文档和仅仓库维护的验证记录明确不属于首期公开双语/站点发布范围；私有 provider 文档可以单独声明为内部双语配对，但不进入站点。
- 新增双语术语、翻译规则、语言切换、结构一致性、相对链接和 blob hash 记录契约，并把配对检查接入 `docs:check` 与 `check:all`。
- 新增独立 `website/` VitePress workspace；canonical Markdown 继续归 `docs/` 或包所有权目录维护，网站只维护发布清单、路由、侧栏和静态资源。
- 文档站发布中文根路由与 `/en/` 英文路由，构建时生成忽略的投影目录和静态 `.dist/`，并验证发布清单、站内链接、片段和 raw Markdown 页面。
- 文档站顶部使用 VitePress 本地搜索框，中文和英文界面分别提供本地化文案，并支持 `⌘K`/`Ctrl+K` 快捷键打开搜索。
- 为 GitHub Pages 预留静态部署约束和构建产物接口，但本变更不新增发布凭据、自动部署 workflow 或第三方托管配置。
- **BREAKING**：根 `README.md` 改为英文入口，中文入口移动到 `README.zh.md`；新增 `docs/README.md`/`README.zh.md`，删除 `docs/engineering/agent-assets-migration.md`。核心设计、reference 和工程边界保留现有路径，但内容职责和部分文档锚点会收敛；删除的迁移记录不再作为当前产品事实来源。

## Capabilities

### New Capabilities

- `bilingual-documentation-governance`: 定义公开文档范围、英文/中文配对、术语、结构一致性、hash 记录、链接本地化和文档门禁。
- `documentation-site-publication`: 定义 canonical 文档到双语静态网站的发布清单、路由、投影、构建产物和 GitHub Pages 兼容约束。

### Modified Capabilities

- 无。现有桌面运行时、profile、bundle、catalog 和公开 desktop service 的运行时要求不变；本变更只调整其文档表达和发布工具链。

## Impact

- 影响根 README、`docs/`、`packages/desktop-services/README.md`、`packages/desktop-services-local/README.md`、`README.zh.md`、`README.i18n.yaml`、`tools/profile-toolchain/README.md`、根 `package.json`、`scripts/`、`website/` 和文档测试。
- 新增 VitePress 网站 workspace 及其构建依赖；不新增运行时依赖，不改变 Electron 安装包内容。
- 需要更新 `docs:check`、`check:all`、边界检查和文档相关测试，并同步修正文档中的相对链接、命令和公开 API 示例。
- 删除 `agent-assets-migration.md` 前必须完成入站链接搜索；删除后 README、OpenSpec、代码注释、脚本和站点清单不得继续引用该路径。`foundation-verification.md` 与私有 provider README 必须保留其内部维护定位，不能被文档站误发布为产品能力。
