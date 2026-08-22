---
name: dsh-forge-doc-standards
description: 用于编写、移动、审查或整理 DSH Forge 的设计文档、工程文档、包 README、OpenSpec 和 Agent skill，确保层级、职责、链接、当前实现边界和验证范围清晰。
---

# DSH Forge 文档规范

这是文档编辑指导，不是自动生成器。执行写入前必须明确文档范围和用户授权；不要把本
skill 当作修改未请求文件的许可。 prose 的命题完整性使用
[`dsh-forge-prose-standard`](../dsh-forge-prose-standard/SKILL.md)，提交前证据使用
[`dsh-forge-pre-push-checks`](../dsh-forge-pre-push-checks/SKILL.md)。

## 真实来源和文档层级

先确定读者要完成有顺序的工作，还是查阅范围内的稳定事实，再选择文档类型：

- 根 [`README.md`](../../../README.md)：项目入口、安装、常用命令和高层工作流。
- 根 [`AGENTS.md`](../../../AGENTS.md)：开发约束、目录所有权、质量门禁和协作者规则。
- `docs/design/`：产品和发行版架构的权威来源，描述直接子系统、职责和关键行为。
- `docs/reference/`：配置、公开 service、失败语义、运行时事实和操作参考。
- `docs/engineering/`：迁移边界、供应链/恢复边界、平台覆盖和实际验证记录。
- 包内 `README.md`：一个 package 的消费者契约、入口、配置、生命周期、限制和验证。
- `openspec/changes/`：变更提案、设计、规范、任务和验收决策；不是运行时配置。
- `.agents/skills/`：Agent 工作流约束；不是 DSH 运行时产品文档。

设计文档只描述直接子系统，算法、完整字段表和操作步骤放到 reference 或包 README，并
使用相对链接连接。一个事实只有一个权威解释；其他位置只保留局部使用所需的短契约和
链接，不复制整章内容。

## 目录与放置规则

1. 先检查已有导航、入站链接和同主题文档，再新建文件或移动文档。
2. 教程必须按前置条件、操作步骤和可观察结果组织；参考文档按查找范围组织，不要求
   读者顺序阅读；设计文档按边界和决策组织；工程文档按验证事实和维护动作组织。
3. 一个大型混合文档应拆成明确的教程、参考或设计；次要形式可以留在清晰命名的章节中。
4. 重命名/移动是原子变更：先搜索 Markdown、代码字符串、脚本和 README 的入站引用，
   同一变更中修复所有链接和锚点。没有确认入站引用前不要移动文件。
5. `dist/`、`artifacts/`、SBOM、license notice、runtime manifest 和 smoke evidence 是
   生成物；修改 profile、catalog、schema 或生成器源后重新生成，不能手工修产物。
6. `catalog/catalog.yml` 是当前静态 catalog 源文件，必要时可按其 schema 修改并运行
   `catalog:verify`；不要把它误写成运行时下载目录或从产物复制回源文件。
7. 不创建没有真实消费者和可测试职责的 `templates/`、空 `packages/features` 或
   `packages/generators` 文档/目录。

## 当前实现边界

文档必须与代码一致，尤其不能把设计中已经收敛掉的能力写成当前产品：

- 打包发行版在构建期固定一个 profile；开发态可以使用 `--profile`，发行包不提供运行时
  profile 切换 UI。
- 第三方依赖在构建期解析、锁定并随 Electron 包交付；当前没有页面端插件目录或动态下载。
- `catalog` 保存来源、版本、integrity、能力和审核事实；`desktopPnpm.install()` 是
  受控底层 API，不代表当前终端用户可以在线安装插件。
- `desktop-services` 是公开 contract；`desktop-services-local` 是私有 provider，只能
  由 desktop layer 和 `apps/desktop` 使用。
- `trusted-in-process` 是执行模式，不是安全隔离；Electron sandbox 也不能隔离已加载的
  Node 插件。
- 更新、签名/公证、跨平台发布流水线、托盘/终端 UI、Tauri 和其他发行 flavor 只有在
  独立变更已实现时，才能写成当前功能。

## 写作要求

每个文档开头应让读者知道主题、适用范围、前置条件和直接子文档。段落必须保留：

- 行动者、动作、条件、顺序和适用范围；
- `必须`、`可以`、`禁止`、`不会` 等模态强度；
- 所有权、持久化、副作用、失败和恢复后果；
- 当前实现、开发态能力和未来独立变更的区别。

使用中文叙述；稳定包名、命令、API、schema、错误 code、协议字段和路径保留原文。不要
加入审查对话、阶段计划、控制流旁白、测试 walkthrough、重复解释或无标记的未来承诺。
非显然的设计理由可以保留，但必须链接到其唯一权威来源。

代码块、命令和相对链接必须可解析、可找到目标；需要自动验证的 YAML/TypeScript 示例
使用项目已有的 `dsh-forge-example:*` 标记。公共 service README 的 consumer 示例不能
导入私有 provider；profile/bundle 示例必须符合实际 schema。

## 文档修改流程

1. 明确 scope、读者、文档类型和用户授权，读取根/子目录 `AGENTS.md`。
2. 搜索同主题文档、导航和入站引用；读取 owning code、配置、测试和 OpenSpec。
3. 选择唯一文档归属，决定哪些事实局部保留、哪些只用链接引用。
4. 编写或移动文档，使用清晰标题、短段落、列表和必要的表格；不复制生成物或历史对话。
5. 重新读取全文，检查命令、路径、代码围栏、锚点、模态词和当前功能边界。
6. 若修改了公开行为、schema、目录所有权、供应链、Electron 安全或恢复语义，先更新或
   创建 OpenSpec 变更，再同步代码、测试和文档。
7. 运行文档门禁和变更范围对应的 build/test，记录实际结果和未覆盖平台。

## 文档审计

审计时先用便宜的探针，再做语义判断：

```sh
git status --short --branch
rg --files -g '*.md' -g '!vendor/**' -g '!node_modules/**' -g '!dist/**' -g '!artifacts/**'
rg -n "旧路径|旧包名|已删除接口|未来功能关键词" docs README.md AGENTS.md .agents/skills \
  --glob '!vendor/**' --glob '!node_modules/**' --glob '!dist/**' --glob '!artifacts/**'
```

检查重复段落、过期路径、未实现能力承诺、手写状态清单、README 与代码漂移、断链和
OpenSpec 任务状态。`openspec/changes/archive/` 若存在则视为历史记录，不做普通 prose
清理；当前变更必须与实现同步。

## 验证与门禁

当前文档门禁：

```sh
pnpm run docs:check
git diff --check
```

`docs:check` 当前扫描 `docs/`、`openspec/` 和两个桌面 service README，检查尾随空格、
Markdown 相对链接、文档中使用的 `pnpm run` 命令、已删除路径、标记 YAML 和公开 service
consumer 示例。它不扫描根 `README.md`、根 `AGENTS.md` 或 `.agents/skills/`；修改这些文件
时必须额外使用 `rg`、`awk` 或人工复读检查。

按变更范围追加：

- 包 README/API：对应 package build 和 consumer 类型检查；
- provider/generation/WAL：local provider 测试和 `boundaries:check`；
- profile/bundle/catalog：`profile:resolve`、`profile:verify`、`catalog:verify`；
- Electron/打包文档：相关 runtime 测试、package inspect/smoke；
- OpenSpec：项目提供的严格验证命令和 `git diff --check`。

只报告实际运行过的检查；平台签名、公证、Windows native evidence、网络依赖和生产
发布链路未运行时，必须明确说明。
