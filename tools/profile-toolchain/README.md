# `@dsh-forge/profile-toolchain`

`@dsh-forge/profile-toolchain` 是 DSH Forge 的发行版工具链。它把
`distribution.yml`、`profiles/<name>/profile.yml`、bundle manifest、静态 catalog 和
运行时版本矩阵转换为可复现的 DSH profile、依赖闭包、配置转储、SBOM 输入、许可证
通知、Electron runtime manifest 和发布门禁结果。

该包目前是仓库内部的 `private` workspace 包，不是独立发布的 npm SDK。它的公开
边界由 `package.json` 的 `exports` 声明；workspace 之间不得穿透 `src/` 使用未导出
的实现文件。

## 它解决什么问题

DSH Forge 将发行版组合视为可编译输入，而不是手工维护的安装目录。工具链负责把源
文件变成一组有证据的产物：

```text
发行版身份 + profile + bundle + catalog
                    |
                    v
          schema / runtime 校验
                    |
                    v
      依赖闭包 + allowBuilds + lockfile
                    |
                    v
 profile + resolved manifest + config dump
                    |
                    v
 runtime manifest + SBOM + smoke / release gate
```

它同时保证以下不变量：

- 源 profile 是组合意图的唯一来源；生成的 profile 和 lockfile 不能反向成为第二套
  手工配置。
- 相同输入、工具版本和依赖来源产生相同的 `inputDigest` 和规范化结果。
- 显式 profile 不存在或校验失败时直接失败，不会静默回退到默认 profile。
- 官方 profile 的外部 bundle 必须有匹配的静态 catalog、精确版本和 npm 来源事实。
- Git 依赖必须固定完整 40 位 commit；浮动 branch、tag、`main` 和 `latest` 被拒绝。
- 需要生命周期脚本的依赖必须有明确的 `allowBuilds` 决策；只有 `true` 才允许执行。
- `desktop-layer` 只能由 launcher 临时注入，不能持久化到 profile bundle 列表。
- 发布检查必须同时覆盖 profile、真实 Loader config dump、安装包结构、catalog、SBOM、
  许可证通知、平台 native evidence、smoke 和签名状态。

## 前置条件

- Node.js `>=20.0.0`。
- pnpm `11.7.0`。根 workspace 通过 [`pnpm-workspace.yaml`](../../pnpm-workspace.yaml)
  和根 [`package.json`](../../package.json) 固定工具链版本。
- 已安装 workspace 依赖和上游 DSH runtime `@deepseek-ai/dsh@0.1.0-rc.8`。
- 如果执行 profile 解析，bundle 和依赖来源必须能够从 workspace、已安装 DSH 闭包或
  catalog 记录定位；首次解析可能需要网络访问依赖源。
- 如果执行真实 config dump，需要可运行的上游 `dsh` CLI；如果执行安装包检查或
  smoke，还需要当前平台的 Electron、electron-builder 和 native rebuild 工具。

## 快速开始

在仓库根目录执行：

```sh
pnpm install --frozen-lockfile
pnpm --filter @dsh-forge/profile-toolchain build
```

解析默认 profile：

```sh
pnpm run profile:resolve
```

解析指定 profile：

```sh
pnpm run profile:resolve -- developer
pnpm run profile:verify -- developer
pnpm run dump-config -- developer
```

根脚本只是 CLI 的参数透传器。也可以直接调用源代码入口：

```sh
pnpm exec tsx tools/profile-toolchain/src/cli/index.ts profile:resolve developer
```

构建完成后，包的 `bin` 入口为 `dsh-forge`；它与上述 CLI 使用相同的命令实现：

```sh
pnpm exec dsh-forge profile:verify developer
```

所有成功命令输出结构化 JSON。可预期的业务失败使用稳定错误码写入 stderr，并以非零
退出码结束；未知命令返回退出码 `2` 并打印用法。

## CLI 命令

CLI 实现位于 [`src/cli/index.ts`](src/cli/index.ts)。除 `catalog:verify` 和
`docs:check` 外，profile 范围命令都接受可选的 `[profile]` 参数。省略参数时，工具链
从 `distribution.yml` 的 `defaultProfile` 选择目标。

| 命令 | 作用 | 主要前置输入 |
| --- | --- | --- |
| `profile:resolve [profile]` | 编译 profile、运行真实 config dump，并写出产物 | distribution、profile、bundle、catalog |
| `profile:verify [profile]` | 临时重编译并比较既有产物，检查源、锁文件和工具版本漂移 | 已执行过 `profile:resolve` |
| `dump-config [profile]` | 编译 profile 并输出真实 DSH Loader 配置转储 | 可解析的 DSH runtime |
| `catalog:verify` | 校验 catalog schema、ID 唯一性和审核有效期 | `catalog/catalog.yml` |
| `package:inspect [profile]` | 检查 Electron 产物结构、profile 闭包、动态导入和 native 文件 | `package:desktop` 产物 |
| `release:gate [profile]` | 汇总所有发布证据并决定是否可发布 | 已验证 profile、产物和证据 |
| `docs:check` | 检查仓库文档链接、命令、示例和公开 desktop service README | `docs/`、`openspec/`、公开包 README |

命令与根目录脚本的对应关系见 [`../../package.json`](../../package.json)。Electron
产物本身由根目录的 [`scripts/package-desktop.ts`](../../scripts/package-desktop.ts)
负责构建；该脚本调用本工具链的 compiler、composer 和 release API。

## 输入契约

工具链不会把 YAML 或 JSON 直接当作可信对象。解析入口先按 `unknown` 读取，再检查
字段集合、必填字段、固定 schema、版本、来源、依赖和运行时矩阵。主要校验实现在
[`src/core/schema.ts`](src/core/schema.ts)，对应的 JSON Schema 文件位于仓库根目录
[`../../schemas/`](../../schemas/)。运行时手写校验是当前 compiler 的实际执行边界，
修改 schema 时必须同步检查两者。

### `distribution.yml`

发行版身份的唯一来源是仓库根目录的 [`../../distribution.yml`](../../distribution.yml)。
必填字段包括：

- `schema: dsh-forge/distribution@1`；
- `id`、`name`、`packageScope`、`applicationId`、`version`；
- `defaultProfile`；
- 至少一个 `platforms` 条目，每个条目声明 `os` 和 `architectures`。

可选的 `updates` 在 `enabled: true` 时必须同时提供 `channel`、HTTP(S)
`metadataUrl` 和 `trustRoot`。`branding` 用于投影产品名称和发布者。解析器还会在
传入 `profilesRoot` 时确认默认 profile 的文件存在。

### `profile.yml`

profile 位于 [`../../profiles/`](../../profiles/)，必须包含：

```yaml
schema: dsh-forge/profile@1
name: developer
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
```

`runtime` 必须匹配 [`src/core/versions.ts`](src/core/versions.ts) 的首版矩阵。当前
矩阵固定为 DSH `0.1.0-rc.8`、Cordis `4.0.1`、Electron `43.4.0`、pnpm `11.7.0`、
Node `>=20.0.0` 和 desktop protocol `1`。

顶层 `plugins` 字段被拒绝；插件必须通过 bundle 表达。bundle 名称不能重复，且
`@dsh-forge/desktop-layer` 不能写入 `bundles`，因为它属于 launcher 的 generation
级临时注入。

profile 同目录的 `cordis.patch.yml` 是最终用户覆盖层；文件不存在时按空 patch 处理，
但如果文件存在，内容必须是 YAML 数组。

### Bundle manifest

bundle 的 `package.json` 必须至少声明：

```json
{
  "name": "@example/dsh-calendar",
  "version": "1.0.0",
  "license": "MIT",
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    }
  }
}
```

工具链会继续读取 `dependencies`、`optionalDependencies`、`peerDependencies`、
`scripts` 和 `pnpm.allowBuilds`。bundle patch 必须存在；依赖版本必须是字符串；
peer 必须能从当前 profile 闭包解析并满足版本范围；生命周期脚本必须有明确的构建策略，
只有 `allowBuilds: true` 才能运行。

### Catalog

静态 catalog 位于 [`../../catalog/catalog.yml`](../../catalog/catalog.yml)。每个条目
使用 `dsh-forge/catalog@1`，记录包名、精确 SemVer、tier、来源、integrity、许可证、
依赖、脚本、能力、host support、plugin request、授权、审核和
`executionMode: trusted-in-process`。

官方 profile 的外部 bundle 必须匹配 catalog 中的 L1 条目，版本和 npm 来源必须完全
一致。`catalog:verify` 默认拒绝超过 180 天未重新验证的 L0/L1 条目；L2 条目不受该
审核期限限制，但仍必须通过结构和来源校验。

## 编译流程

编译器入口位于 [`src/compiler/index.ts`](src/compiler/index.ts)。`compileProfile()`
和 `resolveProfile()` 执行相同的确定性流程：

1. 解析发行版身份和所选 profile，并校验名称一致性。
2. 定位 profile 引用的 bundle，读取 manifest 和同目录 patch。
3. 检查 DSH/Cordis peer、重复 peer 范围、Git commit、catalog 和依赖来源。
4. 遍历 bundle 的依赖闭包，收集版本、许可证、来源、integrity 和生命周期脚本。
5. 合并 workspace 的 `allowBuilds` 与 bundle 请求，拒绝未授权的生命周期脚本。
6. 对规范化输入计算 SHA-256 `inputDigest`。
7. 生成 profile `package.json`、`cordis.patch.yml`、`cordis.yml`、
   `pnpm-workspace.yaml` 和 profile-local lockfile。
8. 物化依赖闭包，写出 resolved manifest、SPDX 输入和许可证通知。

正式编译只从 workspace、已安装 DSH runtime 闭包和已安装依赖解析 bundle。编译器的
`fixtureRoot` 参数仅供测试构造非法或不完整的本地包，生产调用不得依赖测试夹具。

### 产物目录

默认产物根目录为 `artifacts/`，目录结构为：

```text
artifacts/
└── <distribution-id>/
    └── <profile>/
        └── <input-digest>/
            ├── profile/
            │   ├── package.json
            │   ├── cordis.patch.yml
            │   ├── cordis.yml
            │   ├── pnpm-workspace.yaml
            │   ├── pnpm-lock.yaml
            │   └── node_modules/
            ├── resolved-manifest.json
            ├── sbom.input.json
            └── THIRD-PARTY-NOTICES.txt
```

后续 composer 和 Electron 打包脚本可能在同一 artifact 目录追加
`config-dump.json`、`config-dump.yml`、`runtime-manifest.json`、
`package-evidence.json`、平台 native verification 和 package smoke 文件。

`findLatestArtifact()` 只在指定发行版 ID 和 profile 目录下按修改时间寻找包含
`resolved-manifest.json` 的目录；它不会跨发行版或跨 profile 回退。

## `profile:verify` 的语义

`verifyProfile()` 会在临时目录重新编译 profile，然后与指定 digest 的既有 artifact
比较：

- `resolved-manifest.inputDigest` 和规范化输入；
- compiler、pnpm 和 Node 工具事实；
- profile 内的 package、patch、workspace、lockfile；
- artifact 根目录的 resolved manifest、SBOM 输入和许可证通知。

以下情况会失败，并要求重新执行 `profile:resolve`：源 profile、bundle、依赖来源、
allowBuilds、工具版本或生成文件发生漂移；artifact 不存在；真实 config dump 与当前
组合不一致。

这项检查不把 lockfile 解释为人工组合意图。lockfile 是一次解析结果，必须能由当前源
文件和工具版本重新生成。

## 配置组合器

组合器入口位于 [`src/composer/index.ts`](src/composer/index.ts)。
`composeCompiled()` 将编译后的 profile 复制到临时 DSH Home，按以下顺序组合配置：

```text
profile bundle -> profile patch -> home patch -> launcher overlay
```

它调用真实的 `dsh --profile <name> --dump-config`，解析 Loader entry，计算 entry
激活关系并保留 patch 未匹配、包无法解析、重复 provider 和缺少注入服务等诊断。
返回的 `ConfigDump.healthy` 只有在诊断为空时才为 `true`。

launcher overlay 只允许以下字段：`port`、`profilePath`、`homePath`、
`platformProvider`、`generationId`、`runtimePath` 和 `loopbackUrl`。路径必须是绝对
路径，端口必须在 `1..65535`；未知字段和不安全路径会被拒绝。overlay 不得写回源
profile。

`desktopBundleOrder()` 会把 `@dsh-forge/desktop-layer` 临时插入
`@deepseek-ai/dsh-web-app` 之后，并明确拒绝 profile 自己持久化 desktop layer。
`writeConfigDump()` 会把规范化 JSON 和原始 YAML dump 写入 artifact，供 verify、CLI
和 release gate 复用。

## Catalog 信任与安装确认

信任实现位于 [`src/trust/catalog.ts`](src/trust/catalog.ts)。

- `readCatalog()` 读取并校验静态 catalog。
- `loadStaticCatalog()` 在返回前执行完整审核检查。
- `verifyCatalog()` 检查条目 ID 唯一性、schema 和 L0/L1 审核有效期。
- `requiresReaudit()` 比较版本、integrity、依赖、脚本、能力、插件请求和执行模式。
- `installationConfirmation()` 将 catalog 条目、目标 profile、来源、精确版本、
  allowBuilds 和用户确认时间绑定为 `ConfirmedPluginInstall`。
- `assertNoStartupInstall()` 拒绝启动阶段触发安装。

catalog 只描述信任、授权和审计事实。首版插件执行模式固定为
`trusted-in-process`，`enforcement: unavailable`；catalog 校验和用户确认不是
Node 或 Electron 的技术隔离边界。

## 发布与更新检查

发布实现位于 [`src/release/index.ts`](src/release/index.ts)，涵盖三类工作。

### 安装包检查

`inspectPackage()` 检查最终 Electron 资源的布局、profile/package 锚点、DSH runtime
闭包、官方 preset、Cordis Loader 动态导入、native 文件路径、摘要、可执行位和目标
架构。它不能用静态 `require.resolve` 代替真实 Loader 导入，因为 ESM peer 闭包可能
只有在动态加载时才会暴露问题。

### 证据生成与校验

`generateEvidence()` 为最终应用生成文件路径、大小和 SHA-256 摘要，并引用
`sbom.input.json` 与 `THIRD-PARTY-NOTICES.txt`。`verifyEvidence()` 检查证据 schema、
摘要路径唯一性和外部 SBOM/许可证文件存在性。

### 发布门禁

`releaseGate()` 汇总以下条件：

- profile verify 成功；
- 真实 DSH config dump 健康；
- package inspection 成功；
- 至少一份有效 package smoke 和 native verification evidence；
- 每个声明平台/架构都有独立 native evidence；
- catalog、SBOM 和许可证通知通过；
- 产物已签名；
- 更新已配置 channel 和 trust root。

因此，本地 unsigned smoke 可以证明结构和启动路径，但不能通过生产发布门禁。

更新相关的 `createChannelMetadata()` 和 `verifyChannelMetadata()` 使用 artifact
SHA-256、发行版身份、平台/架构、严格版本递增和 Ed25519 签名。`UpdateCoordinator`
先在暂存目录下载并校验，只有用户确认且校验成功后才释放当前 generation 并调用安装器；
失败时保留当前版本。

## 公开 exports

稳定入口由 [`package.json`](package.json) 的 `exports` 控制：

| 子路径 | 内容 |
| --- | --- |
| `@dsh-forge/profile-toolchain` | 聚合导出，适合工具和测试使用 |
| `@dsh-forge/profile-toolchain/cli` | CLI 主入口和命令实现 |
| `@dsh-forge/profile-toolchain/compiler` | profile 编译、bundle 解析、verify 和 artifact 查找 |
| `@dsh-forge/profile-toolchain/composer` | DSH 配置组合、overlay、entry activation 和 config dump |
| `@dsh-forge/profile-toolchain/schema` | distribution、profile、bundle 和 catalog 解析器及类型 |
| `@dsh-forge/profile-toolchain/trust` | catalog 加载、审核、确认和启动期安装限制 |
| `@dsh-forge/profile-toolchain/release` | runtime manifest、包检查、证据、更新和发布门禁 |
| `@dsh-forge/profile-toolchain/acceptance` | 基础发行链端到端验收 |
| `@dsh-forge/profile-toolchain/types` | 跨模块共享类型和稳定错误提取函数 |
| `@dsh-forge/profile-toolchain/core/digest` | 确定性结构摘要和稳定键排序 |
| `@dsh-forge/profile-toolchain/core/errors` | `ForgeError`、`fail()` 和稳定错误码 |
| `@dsh-forge/profile-toolchain/core/yaml` | YAML 语法读写边界 |

公开入口的实现文件目前仍在 `src/` 中维护，构建产物写入 `dist/`。跨 workspace 导入
必须使用上表中的 package export；禁止使用 `../../tools/profile-toolchain/src/...`
或依赖未声明的 dist 文件。

### API 使用示例

```ts
import { resolveProfile, verifyProfile } from '@dsh-forge/profile-toolchain/compiler';
import { composeCompiled } from '@dsh-forge/profile-toolchain/composer';

const compiled = resolveProfile({
  root: process.cwd(),
  profileName: 'developer',
});

const verified = verifyProfile({
  root: process.cwd(),
  profileName: 'developer',
});

const dump = composeCompiled(verified, {
  overlay: { port: 38080, generationId: 'example' },
});

if (!dump.healthy) throw new Error('DSH config dump 不健康');
```

`resolveProfile()` 会创建或更新 artifact；`verifyProfile()` 不接受不存在的 artifact，
也不会替用户修复漂移。`composeCompiled()` 会创建临时 DSH Home，并在返回前清理；它
不修改仓库源文件。

## 错误处理

可预期的业务错误使用 [`ForgeError`](src/core/errors.ts)：

```ts
import { errorCode, errorMessage } from '@dsh-forge/profile-toolchain/types';

try {
  // 调用 profile-toolchain API
} catch (error) {
  console.error(errorCode(error), errorMessage(error));
}
```

错误码用于机器分支，`message` 面向诊断，`details` 提供上下文。调用方不应通过匹配
完整中文错误消息实现业务分支；跨 CJS/ESM workspace 边界应使用 `errorCode()` 或
`ForgeError` 的稳定形状。

常见错误类别包括：

- `SCHEMA_*`：字段、版本、标识或 schema 不合法；
- `RUNTIME_MATRIX_DRIFT`：profile runtime 与首版矩阵不一致；
- `BUNDLE_*`、`PEER_*`：bundle、patch 或 peer 闭包问题；
- `BUNDLE_SOURCE_FLOATING`：Git 来源未固定完整 commit；
- `ALLOW_BUILDS_REQUIRED`：生命周期脚本未获授权；
- `VERIFY_*`：既有 artifact 与重新生成结果漂移；
- `DSH_DUMP_*`：真实 Loader 配置转储失败或无法解析；
- `CATALOG_*`、`TRUST_*`：catalog、审核、来源或信任模式问题；
- `PACKAGE_*`、`NATIVE_*`：安装包布局、native 文件或 ABI 证据问题；
- `RELEASE_GATE`：发布证据汇总未满足门禁。

## 开发与验证

修改工具链源码后，至少执行：

```sh
pnpm --filter @dsh-forge/profile-toolchain build
pnpm run typecheck
pnpm run lint
```

涉及 compiler、composer、trust 或 release 时，执行对应的测试和验收：

```sh
pnpm exec vitest run tests/compiler.test.ts tests/composer.test.ts tests/trust-release.test.ts
pnpm run acceptance
pnpm run profile:resolve -- dsh-forge-official
pnpm run profile:verify -- dsh-forge-official
pnpm run catalog:verify
pnpm run package:inspect -- dsh-forge-official
pnpm run package:smoke -- dsh-forge-official
```

涉及公开 exports 或边界时，再执行：

```sh
pnpm run test:desktop-services-consumer
pnpm run boundaries:check
pnpm run docs:check
```

测试夹具可以使用 compiler 的 `fixtureRoot`，但生产代码不能通过默认路径、动态
`require.resolve` 或工作区偶然 hoist 读取 `tests/` 内容。

## 目录结构

```text
tools/profile-toolchain/
├── src/
│   ├── cli/              CLI 命令解析和文档门禁
│   ├── compiler/         profile 编译、依赖闭包和 verify
│   ├── composer/         真实 DSH config dump 和临时 overlay
│   ├── acceptance/       基础发行链端到端验收
│   ├── release/          runtime manifest、包检查、证据和更新
│   ├── trust/            静态 catalog 和安装确认
│   ├── core/
│   │   ├── schema.ts     输入 schema 和运行时矩阵校验
│   │   ├── versions.ts   首版 runtime matrix
│   │   ├── digest.ts     确定性摘要
│   │   ├── errors.ts     稳定错误码
│   │   └── yaml.ts       YAML 语法边界
│   ├── types.ts          跨模块共享类型
│   └── index.ts          聚合入口
├── package.json          exports、构建脚本和 bin
├── tsconfig.json         declaration 与 NodeNext 编译配置
└── dist/                 构建生成目录，不是源码输入
```

根目录的架构和运行时约束见 [`../../docs/design/dsh-forge.md`](../../docs/design/dsh-forge.md)，
配置与公开服务参考见 [`../../docs/reference/foundation-contracts.md`](../../docs/reference/foundation-contracts.md)，
源/产物和发布边界见 [`../../docs/engineering/foundation-boundaries.md`](../../docs/engineering/foundation-boundaries.md)。

## 当前限制

- 包声明为 `private`，没有独立版本发布、稳定外部 SDK 兼容承诺或生成的 API 站点。
- `RUNTIME_MATRIX` 当前锁定单一 DSH/Cordis/Electron/pnpm 组合；升级必须同步 profile、
  依赖闭包、真实 config dump、Electron ABI 和 smoke evidence。
- `trusted-in-process` 不是插件沙箱。工具链的 catalog 和发布检查不能隔离已执行的
  Node/Electron 代码。
- `releaseGate()` 要求签名、更新信任根和所有声明平台的 native evidence；本地 unsigned
  smoke 不足以进入生产 channel。
- profile 编译和真实 DSH dump 依赖上游 DSH 包布局；工具链不复制或替代上游 runtime。
