## Context

DSH Forge 当前只有发行版设计文档，没有可执行的 profile 编译器、Electron launcher 或桌面服务实现。本变更的动机和行为范围见 `proposal.md`；本设计只说明如何把这些要求落成可独立验证的模块。

上游 DSH 的 profile 是一个目录，包含 `package.json`、`dsh.profile.bundles`、用户 `cordis.patch.yml` 和 pnpm 解析结果。bundle 通过 `dsh.bundle.patch` 声明 patch，后续 patch 层按行覆盖配置，但 Cordis entry 的激活由 service 依赖驱动。参考桌面项目还要求 generation 级服务生命周期、完整子进程 teardown、安装恢复和真实 renderer boot 检查。

本仓库必须支持两种平面：仓库源平面表达发行版意图；构建产物平面包含可启动 profile、依赖闭包和安装包。产物平面可以被删除并重建，不能成为第二套人工维护配置。

## Goals / Non-Goals

**Goals:**

- 为 `distribution.yml`、`profile.yml`、bundle manifest 和 resolved manifest 建立可版本化 schema。
- 生成与上游 DSH 兼容的 profile，并使 `profile:verify` 与真实启动共享同一组合算法。
- 用 generation 状态机处理 profile 选择、健康确认、失败恢复、退出和服务过期。
- 提供类型明确且具有取消、并发和恢复语义的 `desktopProfiles` 与 `desktopPnpm`。
- 将第三方 Node 插件明确建模为可信同进程代码，并将来源、授权、审计和隔离状态分开。
- 在真实安装包层验证 Electron、Node、pnpm、native addon、签名、更新和 SBOM。

**Non-Goals:**

- 不实现独立进程插件沙箱、远程 provider、通用插件 IPC 或 Tauri 宿主。
- 不在本变更中实现运行时动态 catalog、市场后端、高级桌面布局或多个产品 flavor。
- 不复制上游 DSH 源码，不修改上游 agent loop、会话事件或模型协议。
- 不把静态 capability 元数据描述为恶意代码防护。

## Decisions

### 1. 采用四层实现面

实现划分为以下四个面，每个面拥有自己的输入和验证责任：

- **解析器面**：读取发行版和 profile 源文件，解析 bundle、依赖、来源、许可证和构建脚本，生成规范化清单。
- **组合器面**：把 bundle patch、profile patch、home patch 和 launcher overlay 应用到同一个空 Loader 根，并提供 dump 和验证结果。
- **运行时面**：Electron launcher 在单进程中创建一个 generation，向 Host 提供内部 runtime 和公开 desktop services，等待 Host 与 renderer 健康后提交状态。
- **发布面**：在干净环境安装解析结果，检查运行时闭包、原生文件、SBOM、签名和真实安装包行为。

解析器和组合器必须可以在没有 Electron 的 headless 进程中运行；运行时面不能反向修改源平面。发布面只消费解析器的 resolved manifest 和组合器的结构化 dump。

### 2. 固定两个规范源和一个解析证据

`distribution.yml` 只保存应用身份、平台、默认 profile、品牌资源和更新入口。`profiles/<name>/profile.yml` 只保存 runtime 版本组和有序 bundle 集合；profile 自有 `cordis.patch.yml` 是覆盖意图。可加载的第三方插件必须由 bundle 的依赖和 patch 注册，禁止额外的顶层 `plugins` 顺序。

解析器输出三类文件：

- **可启动 profile**：`package.json`、`cordis.patch.yml`、`pnpm-workspace.yaml` 和 `pnpm-lock.yaml`。
- **resolved manifest**：输入摘要、工具版本、每个 bundle 和插件的来源/版本/完整性、license、`allowBuilds` 决策、平台和 ABI。
- **产物目录**：写入 `artifacts/<distribution>/<profile>/<input-digest>/`，包括 profile 目录、SBOM、许可证通知和安装包输入。

锁文件是机器生成的解析证据，可以提交审查，但不能作为人工组合意图。`profile:verify` 必须比较输入摘要和锁定结果，漂移时失败。

### 3. 先规范化，再解析依赖，再生成 profile

`profile:resolve` 使用以下顺序：

1. 解析并校验 `distribution.yml` 和 `profile.yml`，拒绝未知字段、非法名称和不支持的 schema。
2. 解析 bundle manifest，确认每个包声明有效的 `dsh.bundle.patch`，并收集其依赖、peer、来源、许可证和脚本。
3. 验证 DSH package family、Cordis peer、desktop protocol、Electron ABI、Node engine 和平台矩阵兼容。
4. 拒绝 branch/tag/Git 浮动来源；对 Git monorepo 将固定 commit 与 subdirectory 规范化为唯一依赖地址。
5. 为需要安装脚本的精确依赖生成 `allowBuilds`，没有审核决策则失败。
6. 在临时目录生成上游 profile，运行冻结版本的 pnpm 解析并写入锁文件。
7. 使用组合器生成结构化 `dump-config`，检查未匹配 patch、重复 provider、缺失 bundle 和 unresolved entry。
8. 计算输入和输出摘要，写入 resolved manifest 和 artifacts 目录。

解析器不执行任意插件代码；依赖安装只在构建阶段执行，并由发布面单独审查脚本和 native addon。

### 4. 分离 patch 优先级和 Cordis 激活

组合器使用以下 patch 层：

```text
profile bundles（按声明顺序）
  -> launcher desktop layer（dsh-web-app 之后，临时注入）
  -> product/profile bundle 覆盖
  -> profile cordis.patch.yml
  -> DSH home cordis.patch.yml
  -> 受限 launcher overlay（仅启动事实）
```

launcher desktop layer 不写入用户 profile。`launcher overlay` 只能提供随机端口、绝对路径、平台 provider 和 generation ID 等启动事实，不能覆盖模型、工具或权限策略。

patch 对同一行采用后写覆盖；覆盖整个 `config`，不做隐式深度合并。组合器必须把“覆盖顺序”与“entry 激活顺序”分别输出。entry 是否激活由 Cordis injection 和 service availability 决定，缺失必需 service 时保持 pending 或使健康检查失败。

### 5. 采用显式 generation 状态机

Electron 私有状态文件使用版本化 JSON，至少包含：

```text
version
active
pending
lastKnownGood
generationId
lastFailure { target, stage, attempt, reason, occurredAt }
```

状态转换如下：

```text
selected
  -> pending-persisted
  -> preparing
  -> host-ready
  -> renderer-ready
  -> committed
```

任何 `preparing`、`host-ready` 或 `renderer-ready` 阶段失败都转入 `failed`，保留目标和失败阶段，恢复到可验证的 `lastKnownGood`。同一目标可以显式重试，但自动恢复最多执行一次；恢复也失败时进入 `manual-recovery`，不再无限 relaunch。

健康提交必须同时满足：Loader entries 已结算且激活、Web readiness probe 成功、BrowserWindow 使用正确 sandbox 配置、renderer boot report 成功、托盘和交互命令注册完成。提交动作在托盘命令可触发前同步完成。

状态文件写入使用私有目录、符号链接拒绝、临时文件加 `wx` 和原子 rename。旧 service、窗口、subprocess handle 和 generation-specific path 在 dispose 后全部失效。

### 6. 将桌面服务设计成 generation-scoped capability

公开 API 只从 `desktop-plugin/profile-service` 和 `desktop-plugin/pnpm` 导出类型。`desktopRuntime`、Electron 对象、Node helper、ABI 环境和 `desktopPnpmBootstrap` 不进入第三方 contract。

`desktopProfiles` 具有不可变 `current` 快照。`list()` 只读扫描 profile manifest；`select()` 先持久化 pending，再请求有序 teardown 和 relaunch。同一目标的并发选择共享 operation，不同目标在 pending 期间失败；旧 generation 的 service 调用明确失败。

`desktopPnpm` 使用 Node `Readable` 输出，完成结果包含 `exitCode` 和 `signal`。一个 generation 最多一个 operation，取消和 dispose 都必须作用于完整进程树。普通 `runPlugin()` 不接受 `add`；可恢复安装使用单独的 install operation：安装前保存受保护文件快照，成功后封存 profile 配置和 receipt，下一 generation 健康失败时恢复快照并报告 node_modules 未主动回滚的事实。

### 7. 明确 trusted-in-process 信任模型

每个 Host descriptor 和 catalog 条目记录 `executionMode: trusted-in-process`。插件元数据分成：Host 支持、插件请求、用户/策略授权、审计结果和技术 enforcement。首版 enforcement 明确为未隔离，公共 service 是兼容和审计边界而不是 Node 安全边界。

L0/L1/L2 只表示交付和验证状态。L0/L1 条目必须拥有精确来源、完整性、许可证、维护者、依赖闭包、构建脚本、请求能力、模型可见工具、验证平台和时间。启动时只能读取静态 catalog；安装必须由用户或管理员明确触发并展示将修改的 profile。

### 8. 使用 manifest 驱动的打包和更新门禁

发布面从 resolved manifest 生成 Electron Builder 输入，并为声明平台检查：

- Electron、DSH package family、Cordis peer、pnpm 和 Node ABI 的精确版本；
- ASAR 与 `app.asar.unpacked` 中的 native addon、helper 和执行权限；
- profile、bundle、许可证、SBOM 和 runtime closure 的完整性；
- macOS 签名/公证或 Windows Authenticode 发布者身份。

未签名产物只能作为 smoke 产物。更新器使用 channel 元数据、产物摘要和发行版信任根验证升级，拒绝错误身份、摘要不符和未授权降级。下载、校验和用户确认在独立暂存目录完成，当前 generation 只在完整 dispose 后由平台安装器替换。

### 9. 采用分层验证而不是单一端到端测试

- **schema/解析测试**：非法 schema、浮动 Git、未知构建脚本、重复 peer 和锁文件漂移。
- **组合测试**：每层 patch、整行 config 替换、未匹配目标、dump 与 boot 等价性。
- **生命周期测试**：状态文件损坏、并发 select、renderer 超时、旧 service、信号退出、崩溃恢复。
- **服务测试**：空参数、NUL、busy、取消、完整进程树、安装 WAL、部分失败和人工恢复。
- **真实 Loader 测试**：profile-local fixture 通过真实 package resolution 加载，而非只 mock service。
- **产物测试**：ASAR 入口、unpacked native 文件、干净机器启动、安装包退出、签名、更新和回滚。

每个测试报告都携带 profile、distribution、runtime manifest 和平台标识，避免把一个平台的通过结果误用于其他产物。

## Risks / Trade-offs

- **可信同进程插件仍可直接使用 Node/Electron** → 所有用户界面、catalog 和文档统一展示 `trusted-in-process`，将独立进程隔离保留为后续独立规范；不使用“无法访问”措辞。
- **node_modules 不能可靠回滚** → 恢复事务只承诺受保护配置文件和可验证的 profile 状态；检测到依赖目录未知时进入人工恢复，不自动宣称一致。
- **profile 编译器增加维护面** → 组合器复用上游 DSH 的 patch parser 和 dump 语义，避免维护第二套 Loader 实现；解析器只负责清单和产物编排。
- **launcher overlay 可能与用户 patch 发生冲突** → overlay 字段采用白名单，所有越界覆盖在离线验证阶段失败，并输出命中的 Loader 行。
- **跨平台 native 依赖使发布矩阵扩大** → `distribution.yml` 必须声明平台和架构；未声明的平台没有发布承诺，平台门禁按产物逐一执行。
- **签名和更新依赖外部发布基础设施** → 开发与 CI 可以生成未签名 smoke，但发布 channel 在签名、公钥和元数据服务准备前保持关闭。
- **静态 catalog 可能落后于上游** → catalog 条目带验证时间、依赖摘要和来源 commit；任一关键事实改变即要求重新验证，而不是自动继承旧结果。

## Migration Plan

这是一个空仓库的基础变更，不需要兼容旧的 DSH Forge 数据格式。实施顺序如下：

1. 先落地 schema、规范化器、resolved manifest 以及纯 fixture 验证；此阶段不启动 Electron。
2. 接入上游 DSH package，生成单个 `official` profile，完成组合 dump、真实 Loader smoke 和 `dsh --profile` 启动。
3. 实现兼容模式 Electron launcher、generation 状态文件、renderer boot report、`desktopProfiles` 和随机 loopback readiness。
4. 接入 `desktopPnpm` 的普通操作和可恢复 install operation，完成部分失败、取消、重启验证和人工恢复测试。
5. 完成 Electron runtime closure、平台 native 检查、SBOM、许可证通知和未签名 smoke 产物。
6. 配置签名、公钥和更新 channel 后，才允许生成生产发布产物；每次上游 DSH 或 Electron 升级都重新解析并运行完整门禁。

若任一阶段破坏 profile dump、Loader smoke、generation 健康提交或产物闭包，回滚到上一个已验证的 resolved manifest 和 last-known-good 安装包，不回滚或手工修改源 profile 以掩盖失败。

## Open Questions

无。更新传输协议、UI 文案和诊断保留周期可以在不改变上述 schema、状态机和验证边界的前提下由后续实现决定。
