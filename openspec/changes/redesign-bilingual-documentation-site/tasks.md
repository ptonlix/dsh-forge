## 1. 文档盘点与范围收敛

- [x] 1.1 建立 `docs/`、根 README、包 README 和工具链 README 的逐文件清单，记录读者、事实所有者、公开状态、重复内容和入站引用。
- [x] 1.2 将文档重新归类为 `docs/design/`、`docs/reference/`、`docs/engineering/` 和 `docs/i18n/`，为每个保留事实指定唯一权威来源。
- [x] 1.3 删除或合并与 DSH Forge 发行版、工具链、桌面宿主、公开 service 和维护流程无关的文档；在变更记录中说明原因、替代来源和链接检查结果。
- [x] 1.4 更新 README、包 README、OpenSpec 变更材料和脚本中的旧路径，确认没有引用已删除文档。

## 2. 双语治理契约

- [x] 2.1 新增 `docs/i18n/README.md`、`translation-rules.md`、`terminology.md`，明确公开范围、三文件配对、语言切换、术语和审查责任。
- [x] 2.2 新增配对清单/排除清单和 Git blob hash sidecar 解析与写入工具，拒绝半配对、错误 hash 和非法路径。
- [x] 2.3 实现双语结构签名和相对链接本地化检查，覆盖标题、列表、表格、代码围栏、切换链接和双语目标。
- [x] 2.4 将根 README、公开 design/reference/engineering 文档、包 README 和工具链 README 迁移为完整英文/中文配对，并为每对生成 `.i18n.yaml`。
- [x] 2.5 更新现有 docs:check，使其发现公开文档范围、执行双语配对、保留命令/YAML/链接/公开 service 边界检查；将该门禁接入 `check:all`。
- [x] 2.6 为新增门禁补充成功、缺文件、hash 漂移、结构不一致、链接错误、排除项违规和删除后残余引用测试。
- [x] 2.7 支持明确声明内部双语配对：校验 `README.md`、`README.zh.md` 和 `README.i18n.yaml`，但不将内部配对加入公开站点发布范围。

## 3. 文档站发布适配器

- [x] 3.1 新增 `website/` workspace、package scripts、锁定依赖、忽略的 `.generated/`/`.dist/` 和站点资源目录。
- [x] 3.2 新增 `website/docs.ts` 发布清单，声明公开页面的 canonical source、locale、根路由或 `/en/` 路由、标签、侧栏和顺序，并拒绝重复或缺失路由。
- [x] 3.3 实现 canonical Markdown 到投影目录的构建适配器，改写站内相对链接、语言切换链接和静态资源引用，不复制正文作为维护源。
- [x] 3.4 配置 VitePress 双语主题和导航，输出中文根站点、英文 `/en/` 站点、raw Markdown twin 和 `llms.txt`。
- [x] 3.5 实现站点构建后验证，检查发布清单覆盖、HTML 路由、站内链接、fragment、raw Markdown 和索引文件。
- [x] 3.6 将静态输出、base path 和资源引用配置为 GitHub Pages 可部署格式；只验证本地 build/preview，不添加部署 workflow 或凭据。
- [x] 3.7 为站点清单、链接重写、缺失页面、重复路由、fragment 错误和 GitHub Pages 路径补充定向测试。
- [x] 3.8 启用 VitePress 本地搜索，移除顶部文字版 GitHub 导航，配置中英文搜索文案和 `⌘K`/`Ctrl+K` 快捷键入口。

## 4. 集成验证与交付

- [x] 4.1 更新根 `package.json` 的 `docs:check`、`docs:build`、`docs:dev`、`docs:preview` 和 `check:all` 命令，保持网站依赖不进入 Electron 生产闭包。
- [x] 4.2 运行受影响的文档配对测试、站点测试、`pnpm run docs:check`、`pnpm run docs:build`、`pnpm run check:all` 和 `git diff --check`。
- [x] 4.3 重新读取公开文档入口和生成站点导航，确认只发布当前 DSH Forge 事实，不承诺页面端 profile 切换、插件市场或动态下载。
- [x] 4.4 更新 `docs/engineering/` 验证记录，明确实际运行的静态构建命令、未执行的 GitHub Pages 部署、平台和签名限制。
- [x] 4.5 使用 OpenSpec 严格校验变更材料，确认 proposal、两份 capability spec、design 和 tasks 完整且与实际范围一致。
