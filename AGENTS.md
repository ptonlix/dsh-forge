# DSH Forge 开发规范

本文是 DSH Forge 仓库的根级开发规范，适用于仓库根目录及其所有子目录。更深层目录
中的 `AGENTS.md` 可以补充或收紧本规范；如果没有更深层规则，以下内容全部有效。

本文描述开发和维护边界，不替代产品设计、公开 API 或 OpenSpec 的验收语义。遇到事实
冲突时，按以下优先级处理：

1. 当前代码、`package.json`、JSON Schema 和已执行测试中的实际行为；
2. `docs/design/`、`docs/reference/` 和 `docs/engineering/` 中对应范围的权威文档；
3. `openspec/` 中尚未归档的变更提案、设计和规范；
4. 本文的通用开发流程。

如果实现、文档和 OpenSpec 不一致，不要通过猜测补齐行为。先定位权威来源，再用最小
变更同步代码、测试和文档。

## 项目定位

DSH Forge 是面向桌面发行版的可 Fork 工具链，负责将 DSH 的 profile、bundle、桌面
capability 和依赖闭包编译为可审计、可复现的 Electron 应用输入。它不是 DSH agent
loop、会话协议、模型运行时或第三方插件源码的替代实现。

当前产品边界如下：

- 首版宿主使用 Electron，renderer 固定启用 Chromium sandbox、context isolation，关闭
  Node integration。
- 发行包在构建期绑定一个 profile；第三方依赖在构建期解析、锁定并随安装包交付。
- 开发态可以使用 `--profile <name>` 选择仓库 profile；打包应用不提供运行时 profile
  切换。
- 当前页面不提供插件目录、在线下载插件或运行时安装入口。
- `desktopProfiles`、`desktopPnpm` 等底层 service 仍可供开发态、受控 Host 或未来独立
  产品变更使用，但不能据此宣称当前发行包支持对应终端 UI。
- 插件执行模式为 `trusted-in-process`。catalog、用户确认和 sandbox 不是 Node/Electron
  进程级安全隔离。
- `templates/`、空的 `packages/features`、`packages/generators` 不是当前实现面；没有
  真实消费者和可测试职责时，不创建这些目录或占位包。

## 目录所有权

每个生产模块只能有一个维护根。新增文件前先判断它属于哪个目录，禁止复制实现形成
双轨架构。

| 路径 | 所有权与职责 | 允许依赖 |
|---|---|---|
| `apps/desktop/` | Electron 主进程、启动器、窗口、平台适配和 generation 编排 | 公开 package exports；可使用 `desktop-services-local/launcher` |
| `packages/desktop-services/` | 第三方可依赖的公开桌面 service contract、类型、协议和校验函数 | `@deepseek-ai/cordis` 等公开 peer |
| `packages/desktop-services-local/` | 私有 provider、profile service、受管 pnpm、WAL 和恢复逻辑 | 公开 contract、profile-toolchain；只允许 launcher/desktop layer 使用 |
| `packages/bundles/` | 可复用 `dsh.bundle` 包及 patch；`desktop-layer` 是 launcher 临时注入层 | DSH 和明确声明的运行时依赖 |
| `tools/profile-toolchain/` | schema 解析、profile 组合、catalog、SBOM、发布检查和 CLI | Node 工具依赖；不得反向依赖 `apps/desktop` |
| `profiles/` | `profile.yml` 和可选 profile patch 等组合源文件 | bundle 名称和固定 runtime 事实 |
| `catalog/` | 静态插件来源、版本、integrity、许可证和审核事实 | 不负责启动时发现或下载 |
| `schemas/` | distribution、profile、bundle、catalog、resolved manifest 的数据契约 | 与运行时手写校验同步维护 |
| `scripts/` | 构建、打包、边界、签名和 smoke 编排 | 应调用 workspace 的公开 API |
| `tests/` | 单元、集成、边界、发布和 fixture 测试 | 测试可以使用受控内部入口；fixture 模拟外部 consumer |
| `docs/design/` | 产品和发行版架构权威文档 | 链接到 reference 和 engineering 文档 |
| `docs/reference/` | 配置、公开 service、运行时事实和操作参考 | 不复制完整实现 |
| `docs/engineering/` | 工程边界、迁移和验证记录 | 记录实际验证，不记录未执行的结果 |
| `openspec/` | 变更 proposal、design、spec 和 tasks | 记录决策和验收边界，不作为运行时输入 |

禁止重新引入根级 `src/` 生产实现。禁止从一个 workspace 包通过 `../other-package/src/`
导入另一个包；跨包必须通过对方 `package.json` 的 `exports`。禁止把 `dist/`、
`artifacts/`、`node_modules/` 或测试 fixture 当作生产源码。

## 依赖方向与公开边界

依赖方向必须保持单向：

```text
apps/desktop
  -> desktop-services（公开 contract）
  -> desktop-services-local/launcher（私有 launcher seam）
  -> profile-toolchain（构建/运行时编排所需的公开工具 API）

desktop-layer bundle
  -> desktop-services-local（默认 provider）

第三方 bundle / Fork
  -> desktop-services（唯一公开桌面入口）

profile-toolchain
  -不得-> apps/desktop
```

具体规则：

- `@dsh-forge/desktop-services` 是第三方 Host 插件唯一应依赖的桌面包。不得导入
  `desktop-services-local`、Electron、launcher、原始 IPC、profile 路径或 pnpm 参数。
- `@dsh-forge/desktop-services-local` 根入口只由 desktop layer 注册；`./launcher` 只由
  `apps/desktop` 创建 capability。普通 bundle、Fork 和 fixture 不得使用私有入口。
- Electron 对象必须留在 `apps/desktop/platform` 或内部 runtime 中，不能塞进公开
  Cordis service、bundle manifest 或第三方插件配置。
- 工具链只能依赖可复用的 Node/配置事实，不得反向导入 Electron 应用；应用调用工具链
  时使用 package exports 或同包内部相对路径。
- 对外导出新增字段、类型或子路径前，必须同步 package README、基础契约参考、消费方
  fixture 和边界测试。未写入 `exports` 的文件不是公共接口。

## Profile、Bundle 与 Catalog

### Profile

`profiles/<name>/profile.yml` 是发行组合的唯一手工输入。生成的 profile、锁文件、
resolved manifest、SBOM、许可证通知和安装包都属于 `artifacts/` 产物平面，不得手工
修改，也不能作为第二套源文件。

Profile 必须遵守：

- 只声明固定 runtime 版本组和有序 `bundles`；顶层 `plugins` 字段不受支持。
- bundle 名称不得重复；`@dsh-forge/desktop-layer` 由 launcher 临时注入，不能持久化到
  profile 的 bundle 列表。
- DSH、Cordis、Electron、Node、desktop protocol 和 bundle schema 必须通过兼容性校验。
- 外部 bundle 的来源、版本、integrity、许可证、能力和审核事实必须能在静态 catalog
  中追溯。
- Git 依赖必须固定完整 40 位 commit；禁止 branch、tag、`main`、`latest` 或其他浮动
  引用。
- 新增或修改 profile 后，必须重新运行 `profile:resolve`、`profile:verify` 和对应的
  config dump；不能复用另一个 profile 的 artifact。

命令省略 profile 名称时使用 `distribution.yml` 的 `defaultProfile`；显式名称无效时
必须失败，禁止静默回退到默认 profile。

### Bundle

Bundle 是可复用的 DSH 包，不是发行版目录。Bundle 的 `package.json` 必须声明有效的
`dsh.bundle.patch`，并在 `dependencies` 中声明 Loader 使用的插件包。`cordis.patch.yml`
只注册已安装包，不得指向仓库外源码相对路径。

新增 bundle 前必须确认存在真实组合需求、非空 patch、完整覆盖值、偏离理由和可执行
验证。不要创建只为重复挂载同一 entry 的空 wrapper。

### Catalog

`catalog/catalog.yml` 是静态审计快照，不是应用启动时的动态插件市场。每条记录至少要
能说明来源、精确版本、完整性、许可证、维护者、依赖、脚本、能力、验证平台、执行模式
和审核事实。

- L0：随官方安装包交付并默认启用。
- L1：兼容性已验证，但不进入默认 profile；维护者审查后写入自己的 profile 并重新构建。
- L2：仅记录来源和审核事实，不进入默认 profile 或安装包。

catalog 变更必须运行 `pnpm run catalog:verify`。锁文件、SBOM 和 catalog 只能证明构建
输入和审核记录，不能证明插件作者可信、许可证绝对正确或代码安全。

## 运行时与生命周期

### Generation

Electron 启动器创建 Host Cordis generation。generation 拥有 profile、窗口、loopback
服务、desktop capability 和受管进程的生命周期。

- 新 generation 必须在 Host entry settle、loopback readiness、窗口加载和 renderer boot
  report 均成功后，才能成为 `last-known-good`。
- 失败的 pending generation 要保留失败事实，并按受控恢复规则回退；不能静默覆盖状态。
- 关闭窗口默认只隐藏窗口；显式退出、信号、崩溃恢复和 generation 失败必须等待 Host
  与受管子进程完成有界 teardown。
- generation dispose 后，旧 service 引用和旧 operation 不能访问或修改新 generation。
- 跨 generation 的异步回调必须取消、排空或显式拒绝；不能依赖垃圾回收解决生命周期。

### Desktop service

公开 service 的协议版本必须先通过 `assertDesktopServicesProtocol()` 协商。快照和列表
返回只读事实；调用关闭 generation 的 service 必须以稳定错误失败。

`desktopPnpm` 的 operation 受 generation 级 lease 串行化：

- 每个 generation 同时最多一个 operation；重复调用以 `PACKAGE_BUSY` 失败。
- `done` 必须等待受管进程树、reconcile、来源校验、健康检查以及 receipt 或恢复全部结束。
- `cancel()` 必须可重复调用；取消后调用方仍要等待 `done`。
- workdir、环境、pnpm 参数和脚本权限由 provider 所有，调用方只能传递判别 command、
  catalog confirmation 和可选 `AbortSignal`。

### 安装事务

安装必须由明确确认生成的、深度冻结的 `ConfirmedPluginInstall` 触发。provider 需要将
请求重新绑定到当前 generation 的 catalog，并在提交 receipt 前比较 package 名称、精确
版本、来源、commit/tarball 和 integrity。

WAL 只保护 `package.json`、`pnpm-lock.yaml` 和 `pnpm-workspace.yaml`，不承诺回滚
`node_modules`。以下情况必须恢复受保护文件并记录失败或人工恢复：来源漂移、未知
lockfile、pnpm 非零退出、取消、reconcile 失败或下一 generation 健康检查失败。

当前发行包不提供页面端安装流程。任何未来动态安装能力都必须通过独立变更重新定义用户
确认、来源展示、恢复、健康检查和权限边界。

## Electron 安全规范

Electron 相关代码必须集中在 `apps/desktop`：

- BrowserWindow 固定使用 sandbox、context isolation 和 `nodeIntegration: false`。
- 页面只允许当前 generation 的 loopback authority；跨 authority 导航必须拒绝。
- 应用内新窗口默认拒绝；允许的 HTTP、HTTPS、mail 链接交给系统处理程序。
- 未知协议、任意文件路径、任意新窗口和 renderer 侧 Node 访问不得放行。
- 单实例锁必须在启动 Host 或 generation 之前建立；第二个进程只能通知并聚焦现有窗口后退出。
- 不把 `userData` 当作 DSH Home；会话、凭据、设置和 profile 按上游 DSH Home 规则存储。
- 不把 Electron 私有对象传入业务 bundle 或公开 service；需要原生能力时新增类型化
  Host service，并补充权限、失败和 teardown 语义。

## TypeScript 与代码风格

根项目使用 Node.js `>=20.0.0`、pnpm `11.7.0`、TypeScript NodeNext 和严格类型检查。
代码应符合根 `tsconfig.json` 和 oxlint 配置，而不是依赖编辑器的宽松默认值。

- 使用 TypeScript；稳定的公共类型优先写成显式 `interface`、判别 union 或 branded type。
- 保持 `strict`、`noUncheckedIndexedAccess`、`noUnusedLocals`、`noUnusedParameters` 和
  `noImplicitOverride` 通过；不要用 `any`、非空断言或宽泛 `object` 掩盖契约缺口。
- NodeNext 下本地 ESM 相对导入保留 `.ts` 扩展；跨包导入使用 package exports。
- 变量、函数和类型名称使用清晰的英文技术标识；新增注释、诊断、README 和设计文档使用
  中文。稳定包名、命令、API 名和错误 code 保留原文。
- 注释只解释所有权、不变量、生命周期、失败语义或安全原因；不要逐行复述代码。
- 优先使用现有的 profile-toolchain、错误类型、schema parser、WAL、进程树和 generation
  helper；只有能减少真实复杂度时才新增抽象。
- 不在业务代码中直接解析 YAML/JSON 为 `any`；使用已有 parser、schema 或 `unknown` 后
  的显式校验。
- 对路径使用 `node:path`，对外部命令使用受控参数数组；禁止把用户输入拼成 shell 命令。
- 所有异步资源必须有取消、超时或 disposal 语义；错误必须保留稳定 code 和必要 cause，
  不要只抛裸字符串。

## 测试规范

测试必须验证公开行为、失败语义和资源生命周期，不只验证实现细节。单个后台测试命令
最长不超过 60 秒；出现挂起时先定位未排空的进程、Timer、Promise 或 generation，再扩大
超时。

按变更范围选择最小可信检查：

| 变更范围 | 至少运行 |
|---|---|
| 公开 service 类型或 README 示例 | `pnpm run test:desktop-services-consumer`、`pnpm run docs:check` |
| local provider、WAL、取消或 generation | `pnpm run test:desktop-services-local`、`pnpm run boundaries:check` |
| profile、bundle、catalog 或工具链 | `pnpm run profile:resolve`、`pnpm run profile:verify`、`pnpm run catalog:verify` |
| Electron 窗口、导航或 native runtime | 相关 Vitest 测试、`pnpm run package:desktop`、`pnpm run package:inspect`、`pnpm run package:smoke` |
| 跨模块或发布流程 | `pnpm run check:all`，必要时再运行 `pnpm run acceptance` 和 `pnpm run release:gate` |

常用门禁：

```sh
pnpm run typecheck
pnpm run lint
pnpm run test
pnpm run check
pnpm run boundaries:check
pnpm run catalog:verify
pnpm run docs:check
git diff --check
```

测试要求：

- 新行为至少覆盖成功、无效输入、取消/关闭、并发和恢复路径中适用的部分。
- 第三方 bundle 测试使用真实 package resolution、Loader 或受控 fixture，不用 mock 掩盖
  package exports 和 peer 解析问题。
- Electron 安全规则既要有 runtime fake 单测，也要在可用平台执行真实 BrowserWindow 或
  安装包 smoke。
- 测试临时目录必须在成功和失败路径清理；启动的子进程必须由测试拥有并等待退出。
- 不将 `dist/`、`artifacts/`、签名文件或本机用户目录提交为测试结果。

## 文档规范

新增或修改文档时先确定读者和权威来源：

- `docs/design/` 写架构职责、边界和关键行为，不复制完整接口。
- `docs/reference/` 写配置字段、公开 API、失败语义和可操作参考。
- 包内 README 按“包定位 → 配置/入口 → API 或行为 → 生命周期/边界 → 模型体验 → 已知
  限制 → 维护验证”组织，并提供可编译或可执行的示例。
- `docs/engineering/` 只记录工程迁移、验证范围、平台限制和恢复边界。
- `openspec/` 保留动机、决策、替代方案、后果和验收覆盖；不要把评审对话、临时计划或
  未执行的验证写成当前事实。

文档必须：

- 使用中文叙述；包名、命令、API、schema、错误 code 和路径保持原文。
- 明确行动者、条件、时序、所有权、副作用和失败后果。
- 使用相对链接指向唯一权威来源；移动文档前先搜索入站链接。
- 不把“未来独立变更”写成当前功能，不使用“当前已实现布局”“后续目标布局”或并列替代
  架构表述。
- 命令、YAML 和 TypeScript 示例必须能被现有门禁解析；需要自动验证的示例使用已有
  `dsh-forge-example:*` 标记。
- 不在 README 中承诺页面端 profile 切换、插件市场、动态下载或模板生成，除非对应
  OpenSpec 变更和代码已经落地。

文档门禁是 `pnpm run docs:check`。它会检查尾随空格、相对链接、文档命令、已删除路径、
标记 YAML、公开 service consumer 示例和双轨架构表述。

## OpenSpec 变更流程

涉及公开行为、目录边界、schema、依赖来源、桌面安全、恢复、发布或跨模块契约的工作，
必须先在 `openspec/changes/<change-name>/` 建立或更新变更材料：

1. `proposal.md`：说明 Why、What Changes、Capabilities 和 Impact，并写清 Non-goals。
2. `design.md`：记录上下文、目标/非目标、决策、风险、迁移和开放问题。
3. `specs/<capability>/spec.md`：用可验收的 SHALL/SHOULD 语义描述行为、失败和边界。
4. `tasks.md`：拆分可执行任务，并随实现逐项更新状态。

OpenSpec 是变更决策来源，不是把未完成设计直接当成当前实现的授权。实现过程中发现
范围扩大、替代方案或当前设计不准确时，先更新变更材料，再同步代码、测试和文档。
完成后应运行仓库配置允许的严格验证，例如：

```sh
openspec validate "<change-name>" --type change --strict --no-interactive
```

不要修改历史变更来伪造完成状态；若变更已完成，按项目采用的归档流程处理，并保留真实
验证证据。

## 变更实施流程

每次开发任务按以下顺序执行：

1. **读取上下文**：检查 `git status`、相关 README、设计/reference、源码、测试和 OpenSpec；确认是否存在用户未提交修改。
2. **划定范围**：列出将修改的文件、依赖方向、公开契约、失败路径和验证命令；不顺手重构无关模块。
3. **先改契约再改实现**：公开行为变更先更新 OpenSpec/schema/类型，随后实现 provider、应用和测试；纯文档变更也要核对当前代码。
4. **保持所有权**：用现有 helper、错误类型、解析器和生命周期抽象；不新增重复 registry、状态机或兼容 re-export。
5. **覆盖失败路径**：至少考虑无效配置、来源漂移、取消、并发、generation 关闭、部分写入和人工恢复。
6. **运行最小门禁**：先跑受影响包和测试，再根据风险扩大到 `check:all`、打包、smoke 或 acceptance。
7. **复读与交付**：重新读取修改后的文档/代码，运行 `git diff --check`，检查工作区状态，并在交付说明中列出实际运行的命令和未覆盖的平台。

编辑文件使用可审查的补丁方式，保持 ASCII 优先；只有项目已有字符集或用户明确要求时
才引入其他 Unicode。不要用脚本静默覆盖整个目录，不要删除用户未授权的文件。

## Agent 与协作者约束

本仓库由人和自动化 Agent 共同维护时，额外遵守以下规则：

- 与用户沟通、提交的 Markdown、代码注释、测试诊断和新增可见字符串使用中文；稳定的
  包名、命令、API、schema、错误 code 和协议字段保留原文。
- 开始任务先执行 `git status --short`，再用 `rg` 或 `rg --files` 查找入口、引用和测试；
  不凭目录名称猜测职责。
- 编辑手工文件使用可审查的 patch 工具；不要用 `cat >`、临时 Python 写文件或未经检查的
  全量格式化覆盖用户已有内容。
- 工作树已有修改属于用户，必须逐文件读取并保留；不得使用 `git reset --hard`、
  `git checkout --` 或其他回退命令清除不属于本次任务的改动。
- 任务要求“检查、解释或 review”时，默认只做读取和验证；只有用户明确要求修改时才写入
  代码或文档。
- 不自动执行 `git commit`、`git push`、发布、签名、公证或生产更新；这些操作需要用户
  明确授权，并在执行前说明精确目标和影响。
- 不报告未运行的测试、平台 smoke、签名验证或 OpenSpec 校验为“已通过”；交付时列出
  实际命令、结果和未覆盖范围。
- 发现实现与当前设计冲突时，先报告事实和影响，再选择最小可验证修复；不要用注释、
  兼容别名或文档措辞掩盖未实现功能。
- 复杂任务先拆成可验证的 3 至 8 个步骤；每完成一个主要步骤就更新状态，避免在没有
  验证的情况下批量修改多个所有权边界。

## 安全与危险操作

以下操作必须先确认目标和影响范围，必要时向用户请求明确授权：

- 删除、移动或批量覆盖文件/目录，尤其是 `profiles/`、`catalog/`、`schemas/`、用户数据和生成物；
- `git reset --hard`、`git checkout --`、提交、推送或改写历史；
- 修改系统权限、环境变量、签名身份、生产更新地址或外部服务配置；
- 全局安装/卸载或升级核心依赖；
- 调用生产 API、发送敏感数据或执行不可逆数据库操作。

安全操作原则：

- 先用只读命令确认精确目标，不对仓库根目录或宽泛 glob 执行递归删除。
- 优先使用可恢复的移动/备份；删除后说明删除内容和是否可恢复。
- 不使用 `$HOME`、`~` 或未解析变量作为破坏性命令目标；临时目录使用 `mktemp -d`。
- 不把网络下载结果直接执行；依赖必须通过 lockfile、catalog、integrity 和允许脚本门禁。
- 不把日志、密钥、完整环境变量或用户路径写入公开诊断；错误消息应保留可操作信息并
  隐去凭据。

## 交付检查清单

提交或交付前确认：

- [ ] 修改只落在已声明范围，未覆盖用户已有改动。
- [ ] 目录所有权、依赖方向和 package exports 仍通过边界检查。
- [ ] schema、类型、实现、测试和文档没有互相漂移。
- [ ] generation、进程、文件句柄、WAL 和 AbortSignal 的生命周期有明确结算。
- [ ] 新增依赖有精确版本、来源、integrity、许可证和 catalog 事实。
- [ ] 相关测试、`docs:check`、`git diff --check` 等实际门禁已经运行。
- [ ] 未运行的平台、签名/公证缺口和人工恢复风险已明确报告。
- [ ] 未把 `dist/`、`artifacts/`、临时日志或本机凭据加入版本控制。

根级 README、设计文档、基础契约参考和工具链 README 是读者入口；本文件是开发约束
入口。任何新模块都应在自己的 README 中说明职责、公开入口、配置、失败、生命周期、
限制和验证命令，并链接回相应权威文档。
