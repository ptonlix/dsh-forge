# DSH Forge（DSH 铸造台）发行版平台设计

> 中文品牌口号：为自己打造专属 DeepSeek Harness
>
> 英文品牌口号（固定原文）：Build Your Own DeepSeek Harness

> 设计状态：当前规范。本文定义本仓库围绕 DeepSeek Harness 构建可组装、可审计、可发布的桌面 Agent 发行版的唯一架构。

## 1. 文档范围

本文只描述桌面发行版仓库的设计，不修改 DeepSeek Harness 的核心架构。DSH 的 profile、bundle、Cordis 插件、Host、Web Client 和会话数据语义仍以上游文档为准。

本文覆盖以下内容：

- Electron 宿主与 DSH 插件的职责划分。
- 可复制的仓库目录和包边界。
- profile 组合、锁版本和安装包生成流程。
- 桌面能力、第三方插件和权限的公开接口。
- 供应链、升级、测试和发布要求。
- 官方发行版与 Fork 定制发行版的目录、配置和同步契约。

本文不定义以下内容：

- DSH agent loop、会话事件或模型协议的替代实现。
- 第三方插件的安全审查结论。
- 具体发行版的产品文案、品牌视觉和商业策略。
- Tauri 宿主的首版实现。

## 1.1 实施契约

桌面 capability 的现行验收规则由 [公开 capability seam](../../openspec/changes/redesign-desktop-plugin-capability-seam/specs/desktop-capability-seam/spec.md)、[服务 contract](../../openspec/changes/redesign-desktop-plugin-capability-seam/specs/desktop-plugin-services/spec.md)和[插件信任](../../openspec/changes/redesign-desktop-plugin-capability-seam/specs/plugin-trust-policy/spec.md)定义。配置字段和公开 service 请查阅[基础契约参考](../reference/foundation-contracts.md)；provider 所有权、安装来源验证与 `trusted-in-process` 非隔离限制请查阅[工程边界](../engineering/foundation-boundaries.md)。

## 2. 核心结论

### 2.1 首版使用 Electron

首版使用 Electron。Electron 主进程提供 Node 运行时、窗口生命周期和跨平台打包能力；DSH Host Cordis generation 负责 Agent、工具、会话、模型和 Web 服务。

Tauri 不进入首版实现，但宿主能力必须通过独立的 `desktopRuntime` 提供方抽象。未来的 Tauri 宿主只能替换该提供方，不能迫使 DSH bundle 或第三方插件改写。

### 2.2 桌面行为以 DSH 插件实现

Electron 启动器只保留不可由 Cordis 完成的职责：单实例锁、进程启动、原生运行时初始化、打包入口和最终退出。窗口、导航、profile 选择、插件管理、更新和桌面设置都由 DSH Host 插件通过 effect 管理。

桌面包具有普通 DSH Host 和 Web Client 两个面。第三方插件继续使用标准 `dsh.bundle` 和 `dsh.client` 元数据，不依赖 Electron 专用注册表。

### 2.3 发行版是可编译的组合

发行版的源文件是 `profiles/<name>/profile.yml`。编译器根据清单解析官方 bundle、精选 bundle、第三方插件和补丁，生成 DSH profile、锁文件、依赖来源清单、SBOM 和安装包输入。

profile 生成物不能作为手工修改的第二个事实来源。用户修改组合时修改清单，再重新解析和验证。

### 2.4 原生能力通过有限的 Host service 提供

第三方插件只能将公开的类型化 service，例如 `desktopProfiles` 和 `desktopPnpm`，作为稳定兼容接口；`BrowserWindow`、`Tray`、原始 Electron IPC、内部路径和运行时 bootstrap facts 不属于公开 contract。

Electron、DSH 和第三方插件仍在同一个 Node 进程中运行。首版插件执行模式为 `trusted-in-process`：插件安装和权限提示是信任、授权与审核机制，不构成对 Node 或 Electron 能力的技术隔离。

### 2.5 本仓库是一等的可 Fork 发行版模板

本仓库同时交付一个官方参考发行版和一套可 Fork 的桌面发行版工具包。官方发行版用于验证 DSH、桌面插件、bundle 和构建流程；Fork 用户通过 `distribution.yml`、自己的 profile 和自有 bundle 生成不同名称、品牌、插件组合和更新渠道的桌面应用。

Fork 的首选路径是修改组合和发行版配置，不是修改 DSH 核心或复制第三方插件源码。所有可 Fork 的入口都必须使用公开的桌面插件 service、bundle manifest、profile schema 和构建命令；生成的 profile、锁文件和安装包只属于构建产物，不能成为 Fork 的第二套手工维护源文件。

## 3. 运行时架构

```text
Electron bootstrap
  |
Native runtime provider
  |
Host Cordis generation
  |- dsh-base
  |- dsh-web-app
  |- desktop layer
  |- user/plugin layers
  |
Loopback HTTP/WebSocket
  |
Sandboxed Web renderer
```

DSH Web surface 继续使用 loopback HTTP/WebSocket。宿主启动 Web profile 时使用系统分配的端口，不能固定使用 `3080`。宿主等待服务报告规范 URL 并执行 HTTP readiness probe，再将同源页面加载到沙箱化 renderer。

renderer 必须启用 Chromium sandbox 和 context isolation，关闭 Node integration。外部 HTTP、HTTPS 和 mail 链接交给系统打开；页面导航只允许当前 loopback authority。

### 3.1 启动生命周期

1. Electron 启动器获取单实例锁并解析用户选择的发行版。
2. 启动器解析 Node、pnpm、共享 DSH Home 和发行 profile 目录，但不修改系统环境变量。
3. 启动器提供 `desktopRuntime` 和启动事实，然后创建 Host Cordis generation。
4. Loader 按序加载官方 bundle、发行版 bundle、desktop layer 和用户补丁。
5. Web Host 绑定 loopback 随机端口，启动器等待规范 URL 和 readiness probe。
6. Electron 创建窗口并加载该 URL；窗口成功加载后提交 last-known-good generation。
7. 关闭窗口只隐藏窗口；明确退出、信号或 generation 失败才会停止 Host。

### 3.1.1 共享 DSH Home 与发行 profile

DSH 的用户数据根目录遵循上游优先级：显式配置路径、`DSH_HOME`、`~/.dsh`。Desktop 只读取该结果并将其显式传给 Host；不得重写 `process.env.DSH_HOME`，也不得把会话、凭据、设置或存储复制到 Electron 的 `userData` 目录。

Electron 的 `userData` 只保存窗口、Chromium 数据和启动器 generation 状态。Desktop 不读取、迁移或复制任何历史私有 DSH Home；所有 DSH 会话、凭据、设置、存储和 profile 都只通过共享 Home 访问。

官方发行版的 `defaultProfile` 与发行版 ID 均为 `dsh-forge-official`；该名称既是仓库编译源目录，也是共享 DSH Home 中的受管 profile 目录 `~/.dsh/profiles/dsh-forge-official`。开发态通过 `--profile <name>` 选择 `profiles/<name>/` 后，启动器会编译该 profile 并安装到 `~/.dsh/profiles/<name>`；只更新带有当前发行版归属和来源 profile 标记的目录，无法证明归属的同名目录必须拒绝覆盖。打包应用只包含构建时选定的一个 profile，并从随包的 resolved manifest 读取其名称，不能在启动时切换到未随包交付的 profile。用户自定义 profile 仍位于 `~/.dsh/profiles/<name>`，用户覆盖继续通过共享 Home 的 `cordis.patch.yml` 生效。

### 3.2 重启边界

profile 切换、桌面呈现模式切换和 DSH 核心升级都通过完整 generation dispose 后重启。桌面插件不得在运行中的根 Loader tree 中替换窗口、根布局或持久化服务。

失败的 pending generation 必须保留目标记录，允许同一目标重试；新 generation 成功完成 Host 和窗口挂载后才能成为 last-known-good。

## 4. 仓库目录

```text
dsh-forge/
├── apps/
│   └── desktop/
│       ├── main.ts
│       ├── native-runtime.ts
│       ├── platform/
│       └── runtime/
├── packages/
│   ├── desktop-services/
│   │   └── src/
│   ├── desktop-services-local/
│   │   └── src/
│   ├── bundles/
│   ├── features/
│   └── generators/
├── tools/
│   └── profile-toolchain/
├── profiles/
├── catalog/
├── schemas/
├── tests/
│   └── fixtures/
├── templates/
├── scripts/
├── docs/
├── distribution.yml
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
└── package.json
```

### 4.1 `apps/desktop`

该目录是 Electron 应用入口，不承载 DSH 领域行为。

- `main.ts`：Host generation 组装、profile 启动和生命周期协调。
- `native-runtime.ts`：实现 `desktopRuntime` 的 Electron 提供方。
- `platform/`：BrowserWindow 安全策略、窗口实现和平台适配。
- `runtime/`：generation 状态机和私有状态存储。
- `electron-builder.yml`：安装包资源、签名和平台目标。

`apps/desktop` 可以替换为未来的 `apps/desktop-tauri`，但二者必须实现同一组宿主能力定义。

### 4.2 `packages/desktop-services` 与 `packages/desktop-services-local`

`desktop-services` 是 ESM 公开 contract，声明 Cordis service、协议、判别 command 与
已确认安装请求。`desktop-services-local` 是私有 ESM provider：默认 export 只由
desktop layer 注册，`./launcher` 只由 `apps/desktop` 创建 capability。Electron
`desktopRuntime`、profile 路径、恢复文件与 launcher 事实都不属于公开 exports。

### 4.3 `packages/bundles`

该目录只放可复用的 `dsh.bundle` 包，不放具体发行版。

- `curated`：经过审查并默认启用的 L0 能力。
- `optional`：已验证兼容但默认关闭或按需安装的能力。
- `desktop-ui`：只在确实需要桌面呈现时加载的 Web UI 组合。

官方 profile 选择 `dsh-base`、`dsh-web-app` 和经审计的第三方 bundle 作为持久运行组合，
launcher 随后临时注入 desktop layer。产品策略 bundle 只能在同一变更中带有非空 patch、完整
覆盖值、偏离理由与验证时进入 profile；空扩展锚点不得保留。

场景发行版不应命名为 `dshd-flavor-*` 并放在 bundle 目录；场景是 profile 清单，不是通用运行时层。

#### 4.3.1 具体插件的引用关系

未发布或需要本仓库补充 patch 的插件由 bundle 通过标准 Node 包依赖和 patch 注册：

```text
具体插件包（npm 或 GitHub 仓库）
  -> bundle/package.json 的运行时依赖
bundle
  -> cordis.patch.yml 中的 Loader 行
profile
  -> 按顺序选择 bundle
```

bundle 的 `package.json` 必须声明 `dsh.bundle.patch`，并在 `dependencies` 中声明它的插件包；`cordis.patch.yml` 的 Loader 行使用已安装包的名称，不能指向本仓库之外的源码相对路径。插件的来源、版本和完整性由 profile-local lockfile 及 catalog 记录。

已发布且自身声明有效 `dsh.bundle.patch` 的第三方 npm bundle 可以被官方 profile 直接选择，
不得再创建只用于重复挂载同一 entry 的空 wrapper。例如官方 profile 直接选择
`dsh-better-sidebar@0.14.0`；它是 L1 catalog 条目，固定 npm tarball integrity、许可证、
维护者、依赖与安装脚本摘要、能力范围和已验证平台。该包在 profile 中只出现一次，避免重复
注册 sidebar 路由。

构建器把这类外部 bundle、DSH runtime 及其必要 peer 写入生成 profile 的显式依赖，从冻结的根
lockfile 投影 profile-local lockfile，再离线物化闭包。生命周期脚本只有在 `allowBuilds` 中经
审计授权时才能运行。Desktop Host 以受管 profile 的 `package.json` 为模块锚点加载 DSH 与外部
entry；只有 launcher 所有的 `desktop-layer` 及其服务提供方可以作为受限、临时 fallback 注入。
它不会回退到根工作区、任意用户目录，也不会把 desktop layer 写进持久 bundle 列表。打包流程将
物化闭包解引用后复制到 macOS 应用包的 `Contents/Resources/dsh-forge/profile/node_modules` 或 Windows
可执行文件同级的 `resources/dsh-forge/profile/node_modules`，并在同一最终资源目录执行
Cordis Loader 动态导入检查。打包前，profile 内的 `node-pty` 必须按目标 Electron ABI 重建，最终
包的 native 文件、摘要和当前平台 smoke evidence 一并记录。

这是一项发行准入，不是隔离机制。`dsh-better-sidebar` 与 DSH、Electron 同处一个 Node 进程，
执行模式为 `trusted-in-process`；其文件、网络、Git 与终端能力来自审核事实，不因 profile
选择、设置开关或 renderer sandbox 而被技术隔离。

发布到 npm 的插件使用普通的精确版本：

```json
{
  "name": "@dsh-forge/bundle-calendar",
  "version": "0.1.0",
  "license": "MIT",
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    }
  },
  "dependencies": {
    "@someone/dsh-calendar": "1.4.0"
  }
}
```

`packages/bundles/optional/calendar/cordis.patch.yml` 只负责把插件加入 Loader：

```yaml
- insert:
    - id: someone-calendar
      name: '@someone/dsh-calendar'
      config:
        locale: system
```

GitHub 仓库没有发布 npm 包时同样可以作为依赖来源。生产构建必须锁定完整 commit SHA，不能使用 branch、tag、`main` 或 `latest`：

```json
{
  "dependencies": {
    "@someone/dsh-calendar": "github:someone/dsh-calendar#8e7c2a4f8b5c9d1e6f3a2b7c4d8e9f0012345678"
  }
}
```

GitHub 依赖必须满足以下条件：

- 仓库根目录或指定子目录包含合法的 `package.json`、可加载入口和许可证声明。
- TypeScript 源码依赖必须提供自包含的 `prepare` 或其他构建脚本；安装时执行构建脚本需要在该 profile 生成的 `pnpm-workspace.yaml` 的 `allowBuilds` 中显式授权，并在审核记录中说明原因。
- GitHub monorepo 的 `subdirectory` 写入 catalog，组合编译器负责生成实际的包管理器依赖地址，不能让不同 profile 手工拼接地址。
- 仓库不是合法 npm/Node 包时，不能直接写入 profile；应由原作者补齐包元数据，或由维护者创建不复制源码的薄适配 bundle，封装构建和 Loader 注册。

profile 只选择 bundle，示例为：

```yaml
bundles:
  - '@deepseek-ai/dsh-base'
  - '@deepseek-ai/dsh-web-app'
  - '@dsh-forge/bundle-calendar'
```

GitHub 插件的 catalog 条目至少记录 `kind: github`、仓库、commit、可选的 `subdirectory`、包名、许可证、tier 和最近验证时间。解析后生成的 lockfile 记录最终版本和完整性；发布前必须执行 profile dump、Loader smoke、SBOM 和依赖审查。commit 锁定只能保证构建来源可复现，不能证明插件作者可信。

L1 插件建议按功能拆成独立 bundle，而不是集中到一个巨大的 `optional` bundle。这样用户可以逐项查看来源、权限、版本和失败回滚结果，也允许其他仓库直接复用其中一个 bundle。

### 4.4 `packages/features`

这里放能够独立演进的产品功能，例如插件目录、来源展示、版本检查和安装确认 UI。功能包可以在普通 DSH 中运行；只有确实需要时才探测 `desktopProfiles` 或 `desktopPnpm`，否则保留普通 DSH fallback。

### 4.5 `profiles`

每个目录是一个可复制的发行版定义。最小文件集合如下：

```text
profiles/developer/
├── profile.yml
├── cordis.patch.yml
├── pnpm-lock.yaml
└── README.md
```

`profile.yml` 是组合源文件；`cordis.patch.yml` 是发行版拥有的最终覆盖层；锁文件记录精确解析结果。编译后的 `package.json`、profile 目录、SBOM 和安装包暂存到 `artifacts/`，不手工编辑。

包含 GitHub 源码依赖时，编译器还必须生成 profile 专属的 `pnpm-workspace.yaml`，把经过审核的构建脚本写入 `allowBuilds`；用户修改授权后必须重新解析、锁定并验证 profile。

`profiles/dsh-forge-official/` 是本仓库维护的参考发行版；Fork 用户创建 `profiles/<name>/`，通过复制发行 profile 并替换自己的 bundle 和插件形成组合，不直接改写 `dsh-forge-official`。每个 Fork profile 都必须可以独立执行 `profile:resolve`、`profile:verify` 和安装包冒烟。

### 4.6 `catalog`、`tools` 和 `templates`

`catalog` 保存插件目录快照、来源和审核事实；它不在应用启动时动态决定加载内容。

`tools/profile-toolchain` 保存清单解析、组合、profile 验证、SBOM、catalog、发布和 CLI；这些工具不是 DSH 运行时插件。`packages/features` 与 `packages/generators` 是真实功能包和生成器包的集合根，没有实际消费者时不创建空实现。

`templates` 为第三方提供新插件、新 bundle 和新 profile 的起始结构。模板必须生成可通过同一质量门禁的最小项目。

### 4.7 `distribution.yml`

`distribution.yml` 是 Fork 用户的发行版身份入口，不属于 DSH 运行时插件。它保存应用 ID、产品名称、包作用域、默认 profile、品牌资源和更新渠道；构建器将这些值传给 Electron 打包、安装器、更新器和桌面插件。

示例：

<!-- dsh-forge-example:distribution -->
```yaml
schema: dsh-forge/distribution@1
id: dsh-forge-official
name: DSH Forge
packageScope: '@dsh-forge'
applicationId: ai.dshforge.desktop
version: 0.1.0
defaultProfile: dsh-forge-official
channel: stable
platforms:
  - os: darwin
    architectures: [arm64, x64]
  - os: win32
    architectures: [x64]
updates:
  enabled: false
  channel: stable
  metadataUrl: https://updates.invalid/dsh-forge/stable.json
  trustRoot: dsh-forge-dev-root-v1
branding:
  productName: DSH Forge
  publisher: DSH Forge Team
```
<!-- /dsh-forge-example:distribution -->

Fork 用户应优先修改 `distribution.yml` 和 `profiles/<name>/`。需要新增能力时，再创建自己的 bundle 或 feature；只有确实涉及窗口、托盘或平台 API 时才修改 `apps/desktop` 的平台适配层。

### 4.8 上游同步边界

新仓库不创建 `upstream.json` 或 `upstream/`。本项目直接使用固定版本的官方 DSH 包，不复制 DSH 核心源码，也不把上游源码快照作为发行版的维护源文件；这两个路径会模糊公共框架、官方发行版和 Fork 定制代码的所有权。

上游 DSH 的版本和来源由 profile 的 runtime 字段、`pnpm-lock.yaml`、catalog 记录和构建验证共同确定：

```text
上游 DSH 发布新版本
  -> 修改 profile 的 runtime 版本
  -> 重新解析 pnpm-lock.yaml
  -> 运行 profile:verify、dump-config 和 Loader smoke
  -> 启动真实安装包并验证回滚
  -> 发布新的官方或 Fork 发行版
```

本仓库不维护上游源码快照或本地补丁。上游版本只通过 profile runtime、锁文件、catalog 和构建验证共同确定；若要维护源码快照，必须新增独立的 OpenSpec 变更，不得在本架构中隐式增加目录。

## 5. Profile 组合模型

`profiles/dsh-forge-official/profile.yml` 的组合源文件结构如下：

<!-- dsh-forge-example:profile -->
```yaml
schema: dsh-forge/profile@1
name: dsh-forge-official
runtime:
  dshPackageFamily: '@deepseek-ai/dsh'
  dshVersion: 0.1.0-rc.8
  cordisVersion: 4.0.1
  desktopProtocol: 1
  electronVersion: 43.4.0
  nodeEngine: '>=20.0.0'
bundles:
  - '@deepseek-ai/dsh-base'
  - '@deepseek-ai/dsh-web-app'
  - dsh-better-sidebar
```
<!-- /dsh-forge-example:profile -->

编译器必须验证以下条件：

- DSH、Node、desktop protocol 和 bundle schema 版本兼容。
- 每个 bundle 都声明有效的 `dsh.bundle` patch。
- 依赖版本、来源、完整性和许可证信息可追溯。
- 同一 Cordis peer 版本不会产生重复运行时实例。
- bundle 顺序、禁用项和 patch 目标能够被 `dsh --dump-config` 解释。
- 启用插件的声明权限不超过发行版允许的能力上限。

加载顺序固定为：

```text
dsh-base
  -> dsh-web-app
  -> desktop layer（launcher 临时注入）
  -> selected product bundles
  -> selected plugins
  -> profile patch
  -> home patch
  -> launcher overlay
```

desktop layer 可以由启动器按 generation 注入，但不能把自身永久写入用户选择的 bundle 列表。

所有发行版默认继承官方运行配置。只有存在实际覆盖时，产品策略 bundle 才会加入 profile：

```text
dsh-base / dsh-web-app（官方运行基线）
  -> desktop layer（私有 provider）
  -> 非空 product-policy bundle（可选）
  -> curated / optional
  -> 用户 profile 补丁
```

## 6. 插件分层与信任模型

插件目录的分类描述兼容性和交付状态，不宣称代码安全：

- L0：随安装包交付并默认启用；通过源码、依赖、权限和平台冒烟审查。
- L1：目录中可发现，经过兼容性验证；默认不加载，安装或启用前需要用户确认。
- L2：只提供来源链接或独立安装方式；不进入发行版安装包。

每个插件记录以下事实：来源、精确版本、提交或 tarball 完整性、许可证、维护者、依赖、需要的 Host 能力、模型可见工具和最近一次验证结果。

锁文件只能证明构建使用了某个依赖结果，不能证明插件作者可信。Git 依赖只允许固定 commit；生产构建默认拒绝浮动 branch、tag 和未审查的安装脚本。

## 7. 桌面服务公开接口

### 7.1 `desktopProfiles`

```ts
import type { DesktopProfiles, DesktopProfileSnapshot } from '@dsh-forge/desktop-services'

interface DesktopProfiles {
  readonly current: string | null
  snapshot(): Readonly<DesktopProfileSnapshot>
  list(): readonly DesktopProfileSummary[]
  select(name: string): Promise<DesktopProfileSelection>
}
```

`current` 是一个 generation 内不可变的快照。`select()` 是持久化后重启的 operation，不是就地修改 Loader tree。插件不能通过 argv、settings、`ctx.baseUrl` 或 `$DSH_HOME` 猜测当前 profile。

### 7.2 `desktopPnpm`

```ts
import type { Readable } from 'node:stream'
import type { ConfirmedPluginInstall, DesktopPnpm, DesktopPnpmOperation } from '@dsh-forge/desktop-services'

interface DesktopPnpmOperation {
  readonly stdout: Readable
  readonly stderr: Readable
  readonly done: Promise<Readonly<{ exitCode: number | null; signal: NodeJS.Signals | null; cancelled: boolean }>>
  cancel(): Promise<void>
}

interface DesktopPnpm {
  run(command: { kind: 'inspect'; query: 'list' | 'why' }): DesktopPnpmOperation
  install(request: ConfirmedPluginInstall): DesktopPnpmOperation
}
```

插件管理只能使用判别 command 或由 catalog confirmation 派生的 `install()`。provider
始终拥有 profile 初始化、reconcile、来源校验与恢复语义，第三方不能传递原始 pnpm
参数、路径或任意 options。

两个方法都必须返回 stdout、stderr、完成状态和取消句柄。调用方负责 deadline、进度显示、非零退出码处理、取消和 teardown 等待。

### 7.3 跨环境插件

普通 DSH 插件不能把 Desktop service 放进顶层必需依赖。它应在 Desktop service 存在时挂载 Desktop adapter，在普通 Web 或 headless 环境中保留原实现。

只面向桌面的插件可以把 `desktopProfiles` 或 `desktopPnpm` 声明为 required injection，但在 service 不存在时必须明确保持 pending 或失败，不得静默改用另一个 profile。

## 8. 打包与发布

构建分为四个阶段：

1. 从 `profile.yml` 解析依赖、bundle、插件和 patch。
2. 在干净环境安装锁定依赖，运行 `dump-config`、Loader smoke 和插件兼容性测试。
3. 生成 profile 目录、SBOM、许可证通知、resolved manifest 和平台资源。
4. 启动真实安装包，验证窗口、loopback Web、profile、退出、更新和回滚。

profile 工具命令支持显式 profile；省略名称时使用 `distribution.yml` 的 `defaultProfile`：

```text
pnpm run profile:resolve -- dsh-forge-official
pnpm run profile:verify -- dsh-forge-official
pnpm run package:desktop -- dsh-forge-official
pnpm run package:inspect -- dsh-forge-official
```

例如新增 `profiles/developer/profile.yml` 后，可使用以下命令启动、验证并打包该 profile：

```text
pnpm dev -- --profile developer
pnpm run profile:resolve -- developer
pnpm run profile:verify -- developer
pnpm run package:desktop -- developer
pnpm run package:inspect -- developer
pnpm run package:smoke -- developer
```

开发启动会自动生成或更新 `~/.dsh/profiles/developer`；已存在但不带 DSH Forge 归属标记的同名目录不会被覆盖。打包应用则将 `developer` 固定在产物中，启动时自动生成或更新同名受管 profile。

安装包必须包含固定版本的 DSH runtime、Node runtime、已解析插件依赖和 profile 生成物。源码仓库不复制第三方插件源码；发行包仍然需要物理包含运行所需的依赖。

## 9. 安全与权限

安全模型分为三层：

- DSH 层：sandbox、approval、filesystem 和 subprocess provider。
- Desktop Host 层：原生能力 allowlist、来源校验、单实例和 loopback 导航限制。
- 发行层：插件准入、锁版本、许可证、SBOM、签名和更新策略。

任何层都不能把任意第三方 Node 插件变成进程级安全隔离。需要真正隔离的能力必须另行设计进程协议或远程 provider，不能只依赖 `enabled: false`、Electron sandbox 或 Tauri capability。

桌面插件安装只能由明确的用户或管理员操作触发。应用必须展示插件名称、来源、版本、许可证、请求的 Host 能力和将修改的 profile；退出码为零不能替代安装后的 profile 和 Loader 验证。

## 10. 版本与升级

每个发行版锁定以下版本组：

- DSH runtime package family。
- Node runtime 和 Electron ABI。
- desktop plugin protocol。
- profile schema 和构建工具版本。
- 每个 L0/L1 插件及其依赖。

上游升级必须同时通过源码溯源、npm artifact、profile dump、平台打包和真实安装包启动验证。会话数据、profile 数据和插件依赖使用不同的迁移策略；不能因为桌面壳升级而隐式修改用户会话记录。

更新采用“下载、校验、用户确认、完整重启”的流程。更新器不得在运行中的 Cordis generation 内替换已加载的 Node 依赖。

## 11. 测试要求

### 11.1 组合测试

- 每个 profile 都有确定性的 `dump-config` 快照或结构化断言。
- 每个 bundle 的 patch 都有加载和冲突失败测试。
- 第三方插件夹具通过真实 package resolution 加载，而不是只使用 mock。
- profile 切换验证持久化顺序、失败回滚和旧 service 失效。

### 11.2 桌面测试

- Electron 启动、随机端口、URL readiness 和窗口加载。
- renderer 的 sandbox、context isolation、无 Node integration 和导航 allowlist。
- 关闭窗口隐藏、显式退出、SIGTERM、崩溃和自动重启。
- macOS 和 Windows 的窗口、托盘、终端、更新和安装包启动。

### 11.3 供应链测试

- 锁文件完整性和依赖来源检查。
- 许可证通知和 SBOM 完整性检查。
- 安装脚本、native addon 和 Electron ABI 检查。
- 每个发行包启动后执行真实 profile 和插件管理冒烟。

## 12. 开发顺序

第一阶段只实现兼容模式、单个 `developer` profile、`desktopProfiles`、随机 loopback 端口和安装包启动验证。

第二阶段加入 `curated` bundle、插件目录、用户确认安装和 `desktopPnpm`；插件目录先使用静态审核快照，不做运行时自动安装。

第三阶段加入多个 flavor、profile 回滚、SBOM、签名更新和跨平台发布流水线。

第四阶段再评估高级桌面布局、远程控制、独立插件进程和 Tauri 宿主。任何新宿主都必须实现既有 `desktopRuntime` 和 Desktop service contract。

## 13. 验收标准

设计达到首版验收标准时，必须同时满足以下条件：

- 新用户无需单独安装 Node.js 或 pnpm 即可启动发行包。
- 发行包能够报告精确的 DSH、Node、Electron、插件和 profile 版本。
- 用户可以复制一个 profile，替换 bundle 和插件，重新生成自己的桌面应用。
- 普通 DSH 插件在 Web、headless 和 Desktop profile 中拥有明确的加载行为。
- 第三方插件不能直接获得原始 Electron API 或未声明的宿主能力。
- profile 安装失败不会留下未记录的 bundle、半完成的依赖或不可恢复的运行 generation。
- 上游升级可以通过锁文件、profile dump、安装包冒烟和回滚结果复现。
- Fork 用户只修改 `distribution.yml`、自己的 profile 和扩展包，就能生成具有独立应用身份的桌面发行版，不需要修改 DSH 核心。
- 官方 profile 始终可以独立构建和启动，公共桌面插件 service、bundle manifest、profile schema 和构建命令有明确版本。

## 14. Fork 发行版契约

本仓库的公共维护面和官方发行版必须保持可分离：

- 公共维护面包括 `apps/desktop` 的通用启动流程、`packages/desktop-services` 的公开 service、bundle manifest、profile 编译器、模板和构建工具。
- 官方发行版包括 `distribution.yml` 的默认身份、`profiles/dsh-forge-official/`、官方精选 bundle 和官方 catalog 快照。
- Fork 发行版拥有自己的 `distribution.yml`、`profiles/<name>/`、品牌资源、可选 bundle、插件 catalog 和签名配置。

Fork 用户按以下范围选择修改方式：

1. 只改变应用身份、默认值、插件组合或更新渠道时，只修改 `distribution.yml` 和自己的 profile。
2. 需要新产品能力时，在 Fork 中新增 bundle 或 feature，并只依赖公开的 DSH 和 Desktop service。
3. 只有窗口、托盘或平台原生行为不同，才修改 `apps/desktop` 的平台适配层；不得让业务 bundle 依赖 Electron 私有 API。

Fork 不得把 `artifacts/`、生成的 profile 目录或第三方插件源码作为手工维护源文件。每次从上游同步公共框架后，必须重新解析自己的 profile，执行 `profile:verify`、dump-config、Loader smoke、SBOM 和真实安装包启动检查；失败的 Fork 构建不能被标记为可发布版本。

公共 service、bundle manifest、profile schema 和 `distribution.yml` schema 的破坏性变化必须有明确的版本升级和迁移说明。Fork 只要仍使用兼容版本，就不应被迫修改自有插件源码。

## 15. 不应采用的做法

- 不复制或 fork 第三方插件源码作为发行版的维护方式。
- 不把每个 flavor 写成一套重复的 `cordis.patch.yml` 和依赖目录。
- 不把桌面能力做成 renderer 中的任意 Electron IPC。
- 不在应用启动时动态拉取未经审核的插件清单并执行安装。
- 不把 `enabled: false` 当作第三方代码的安全隔离。
- 不为了支持 Tauri 而提前引入第二套宿主实现和第二套 UI 组合。
- 不把官方发行版的品牌、插件清单和更新地址硬编码到公共桌面框架。

## 16. 实施入口

新仓库应按以下顺序创建：

1. 创建 `distribution.yml` 和 `profiles/dsh-forge-official/`，固定官方发行版身份、DSH runtime 和最小 bundle 栈。
2. 创建 `apps/desktop`、`packages/desktop-services` 和私有 `desktop-services-local`，建立 capability seam。
3. 实现 `profile:resolve`、`profile:verify` 和安装包启动 smoke。
4. 只在有实际覆盖时增加产品策略 bundle，再逐项加入 L0 插件。
5. 提供可复制的 profile、bundle 和发行版模板，并用模板生成一个独立的 Fork 示例。
6. 最后实现插件目录、profile 管理、更新和其他发行版 flavor。

完成上述入口后，再根据真实运行时失败和升级成本调整公开 service；不要先根据假设扩展 Electron API 或插件市场协议。
