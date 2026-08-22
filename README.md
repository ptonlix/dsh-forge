# DSH Forge

> 为自己打造专属 DeepSeek Harness

DSH Forge 是一个面向桌面发行版的可 Fork 工具链。它围绕
DeepSeek Harness（DSH）组织
Electron 宿主、profile、bundle、依赖解析、桌面 capability 和发布验证，将一个
可组合的 DSH 配置编译为可审计、可复现的桌面应用输入。

本仓库不是 DSH agent loop、会话协议或模型运行时的替代实现。DSH 的 Host、Web
Client、Cordis 插件和会话语义仍由上游项目定义；本项目负责发行版身份、组合、桌面
宿主和构建证据。

## 项目状态

当前仓库处于持续开发阶段，已经具备以下基础能力：

- Electron 桌面启动器和 sandboxed renderer。
- `distribution.yml` 驱动的发行版身份与平台声明。
- `profiles/<name>/profile.yml` 驱动的 runtime、bundle 组合和开发态 profile 选择。
- profile 依赖闭包解析、冻结 lockfile、resolved manifest、SBOM 输入和许可证通知。
- 静态 catalog、来源/integrity 校验、安装事务和发布门禁。
- 公开的 `@dsh-forge/desktop-services` capability contract。
- 官方 profile `dsh-forge-official` 与 developer profile。

当前官方配置声明 macOS `arm64`/`x64` 和 Windows `x64`。Linux 不在当前发行版和
桌面打包脚本的支持范围内。仓库现有 Electron 产物可以做本地 unsigned smoke，但在
缺少 macOS 签名/公证或 Windows Authenticode 身份时，不能作为生产发布产物。

## 核心概念

| 概念 | 作用 | 权威来源 |
| --- | --- | --- |
| Distribution | 发行版名称、应用 ID、版本、默认 profile、平台和更新入口 | [`distribution.yml`](distribution.yml) |
| Profile | 固定 runtime 版本组和有序 bundle 集合 | [`profiles/`](profiles/) |
| Bundle | 标准 DSH bundle 包，负责声明依赖和 `cordis.patch.yml` | [`packages/bundles/`](packages/bundles/) |
| Catalog | 插件来源、版本、integrity、能力和审核事实的静态快照 | [`catalog/catalog.yml`](catalog/catalog.yml) |
| Schema | 配置与构建清单的数据格式契约 | [`schemas/`](schemas/) |
| Artifact | 编译、打包和验证产生的可删除构建结果 | `artifacts/` |

Profile 是发行版组合的唯一手工输入。生成的 profile、lockfile、resolved manifest
和安装包只属于产物平面，不能作为另一套需要手工维护的源文件。

## 工作流

```text
distribution.yml + profile.yml + bundle + catalog
                         |
                         v
              profile-toolchain
                         |
                         v
  profile 闭包 / lockfile / manifest / SBOM / license notice
                         |
                         v
       Electron launcher + DSH Host Cordis generation
                         |
                         v
                sandboxed Web renderer
```

运行时由 Electron 启动器创建 Host Cordis generation。Host 通过系统分配的 loopback
端口提供 Web surface，窗口固定启用 Chromium sandbox 和 context isolation，并关闭
Node integration。开发态的 profile 重配置和受控底层操作都以 generation 为边界：当前
generation 完整释放后，新的 generation 才能成为可恢复目标。打包发行版固定构建时
选定的 profile，不提供运行时切换或在线安装入口。

## 快速开始

### 环境要求

- Node.js `>=20.0.0`。
- pnpm `11.7.0`，版本由根目录 `package.json` 的 `packageManager` 固定。
- 可运行 Electron 的 macOS 或 Windows 开发环境。
- 首次解析 profile 时需要访问依赖来源；依赖安装完成后，构建和验证优先使用仓库
  锁定的输入。

### 安装依赖

```sh
pnpm install --frozen-lockfile
```

### 启动桌面端

默认启动 [`distribution.yml`](distribution.yml) 中的 `dsh-forge-official` profile：

```sh
pnpm dev
```

启动 developer profile：

```sh
pnpm dev -- --profile developer
```

开发态会将选中的 profile 编译并安装到共享 DSH Home。DSH Home 遵循上游优先级：
显式配置路径、`DSH_HOME`、`~/.dsh`。桌面应用不会把会话、凭据或 DSH 设置复制到
Electron `userData` 目录。

## Profile 与发行版配置

### 发行版身份

编辑 [`distribution.yml`](distribution.yml) 可以修改发行版身份。至少需要维护：

- `schema`、`id`、`name`、`packageScope`、`applicationId` 和 `version`；
- `defaultProfile`；
- 至少一个操作系统/架构目标；
- 如果启用更新，还要同时提供 channel、metadata URL 和 trust root。

身份字段会投影到 Electron、安装包和运行时清单。Fork 应先修改发行版身份和品牌，
再创建自己的 profile，不要把官方 profile 产物复制成新的手工源文件。

### Profile 组合

每个 profile 只在 [`profiles/<name>/profile.yml`](profiles/dsh-forge-official/profile.yml)
中声明 runtime 和有序 `bundles`。顶层 `plugins` 字段不受支持；
`@dsh-forge/desktop-layer` 由 launcher 在当前 generation 临时注入，也不应写入
持久 bundle 列表。

官方 profile 当前组合为：

1. `@deepseek-ai/dsh-base`
2. `@deepseek-ai/dsh-web-app`
3. `dsh-better-sidebar@0.14.0`

第三方 bundle 必须使用精确版本，并通过 [`catalog/catalog.yml`](catalog/catalog.yml)
记录来源、完整性、许可证、能力和验证平台。Git 来源必须固定完整 commit；生产解析
不接受 branch、tag、`main` 或 `latest`。

### Bundle 约定

可复用 bundle 放在 [`packages/bundles/`](packages/bundles/) 或来自已审核的外部包。
bundle 的 `package.json` 必须声明 `dsh.bundle.patch`，并在依赖中声明其 Loader
使用的插件包；`cordis.patch.yml` 只负责注册已安装包，不应指向仓库外的源码相对路径。

## Profile 编译与桌面打包

所有 profile 范围命令都接受可选的 profile 名称。省略名称时使用
`distribution.yml` 的 `defaultProfile`；显式名称不存在或校验失败时会直接失败，
不会静默回退到默认 profile。

先解析并验证 profile：

```sh
pnpm run profile:resolve -- dsh-forge-official
pnpm run profile:verify -- dsh-forge-official
pnpm run dump-config -- dsh-forge-official
```

可以将 `dsh-forge-official` 换成 `developer` 或其他有效 profile。解析结果位于：

```text
artifacts/<distribution-id>/<profile>/<input-digest>/
```

其中包括编译后的 profile、profile-local `pnpm-lock.yaml`、`resolved-manifest.json`、
`sbom.input.json`、`THIRD-PARTY-NOTICES.txt` 和 `config-dump.json`。

构建当前平台的 Electron 目录产物：

```sh
pnpm run package:desktop -- dsh-forge-official
pnpm run package:inspect -- dsh-forge-official
pnpm run package:smoke -- dsh-forge-official
```

`package:desktop` 会重新解析 profile、生成真实 DSH config dump、物化 profile 依赖
闭包、按目标 Electron ABI 重建 `node-pty`，再调用 `electron-builder`。打包后应继续
执行结构检查和真实启动 smoke；仅构建成功不能证明安装包可运行。

## Fork 指南

1. 复制一个现有 profile，创建 `profiles/<your-profile>/profile.yml`，并保持 runtime
   版本、desktop protocol 和 bundle 顺序明确。
2. 修改 [`distribution.yml`](distribution.yml) 中的发行版 ID、名称、包作用域、应用 ID、
   版本、品牌和 `defaultProfile`。
3. 对每个外部 bundle 建立或审核 catalog 条目，固定来源、版本和 integrity；不要使用
   浮动 Git 引用。
4. 依次执行 profile resolve、verify、config dump、package inspect 和 package smoke。
5. 如果要发布，补齐每个声明平台的 native evidence、签名/公证或 Authenticode，并执行
   `release:gate`。

Fork 不应修改 DSH 核心、复制第三方插件源码，也不应提交 `artifacts/` 作为第二套源文件。

## 桌面 capability 扩展

Fork 和第三方 Host 插件唯一应依赖的桌面公开包是
[`@dsh-forge/desktop-services`](packages/desktop-services/)。它公开：

- `desktopProfiles`：读取 profile 快照、列表并请求持久化选择；
- `desktopPnpm`：执行受控 inspect、reconcile、remove 或 catalog-confirmed install；
- `desktopServices`：协商 protocol 和执行模式。

这些是开发态和未来多 profile Host 可复用的底层接口，不代表当前固定 profile
发行包提供相应的终端用户功能。

最小使用方式：

```ts
import type { Context } from '@deepseek-ai/cordis';
import { assertDesktopServicesProtocol } from '@dsh-forge/desktop-services';

export default (ctx: Context) => {
  assertDesktopServicesProtocol(ctx.desktopServices);
  return ctx.desktopProfiles.snapshot();
};
```

不要从第三方 bundle 导入 [`@dsh-forge/desktop-services-local`](packages/desktop-services-local/)
或访问 Electron、launcher、profile 路径和原始 pnpm 参数。`desktop-services-local` 是
私有 provider，只有 desktop layer 和应用 launcher 可以使用它。

## 安全边界与限制

- 插件当前执行模式是 `trusted-in-process`。catalog、确认和审核可以约束受支持 API
  的审计流程，但不能把已经获准执行的 Node 插件变成进程级安全隔离。
- renderer 使用 sandbox、context isolation 和关闭 Node integration；当前 generation
  之外的 loopback authority、任意新窗口和不受支持协议会被拒绝或交给系统处理程序。
- 安装事务保护 `package.json`、`pnpm-lock.yaml` 和 `pnpm-workspace.yaml`，不承诺回滚
  `node_modules`；来源漂移、未知 lockfile、取消和健康检查失败必须进入恢复或人工恢复。
- lockfile、resolved manifest 和 SBOM 说明构建输入和组成，不单独证明插件作者可信、
  许可证正确、签名有效或恶意代码安全。
- 未配置平台签名身份时只允许 `unsigned-smoke`，`release:gate` 不会把它标记为生产发布。

## 常用命令

质量检查：

```sh
pnpm run typecheck       # TypeScript 类型检查
pnpm run lint            # oxlint 检查
pnpm run test            # 构建后运行 Vitest
pnpm run acceptance      # 发行版、Fork 和产物端到端验收
pnpm run check           # typecheck + lint + test
pnpm run check:all       # check + 边界、profile、catalog 和文档门禁
```

工具链和发布检查：

```sh
pnpm run catalog:verify
pnpm run boundaries:check
pnpm run docs:check
pnpm run release:gate -- dsh-forge-official
```

`release:gate` 是发布准入检查，不会替代对应平台上的真实签名、公证、安装包启动和
更新链路验证。

## 仓库结构

```text
dsh-forge/
├── apps/desktop/                 Electron 主进程、窗口和运行时状态
├── packages/
│   ├── bundles/desktop-layer/    launcher 注入的 desktop layer
│   ├── desktop-services/         公开桌面 capability contract
│   └── desktop-services-local/   私有 provider 与安装事务
├── tools/profile-toolchain/      schema、解析、组合、catalog 和发布工具
├── profiles/                     发行版 profile 源文件
├── catalog/                      静态插件审计快照
├── schemas/                      JSON Schema 契约
├── scripts/                      构建、打包、边界和 smoke 脚本
├── tests/                        单元、边界、运行时和发布测试
├── docs/                         设计、工程和基础契约参考
├── openspec/                     提案、设计决策和验收规范
├── distribution.yml              发行版身份唯一来源
└── package.json                  workspace 脚本和根依赖
```

## 文档索引

- [架构设计](docs/design/dsh-forge.md)：运行时架构、目录职责、profile 组合和 Fork 约定。
- [基础契约参考](docs/reference/foundation-contracts.md)：配置、公开 service、安装事务和
  runtime manifest 语义。
- [工程边界](docs/engineering/foundation-boundaries.md)：源/产物平面、恢复、安装和更新边界。
- [基础契约验证记录](docs/engineering/foundation-verification.md)：已执行验证、平台覆盖和当前
  签名限制。
- [OpenSpec 变更](openspec/)：功能提案、设计取舍、规范和任务状态。
- [Profile toolchain](tools/profile-toolchain/README.md)：工具链命令、编译流程、API 和发布门禁。
- [公开桌面服务](packages/desktop-services/README.md)：第三方 consumer contract 和示例。

## 许可证

workspace 包的 `package.json` 当前声明 MIT。仓库根目录尚未提供 `LICENSE` 文件；在公开
发布或分发前，请补充正式许可证文件并确认第三方依赖的许可证和分发条件。
