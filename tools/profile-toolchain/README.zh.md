# @dsh-forge/profile-toolchain

中文 | [English](README.md)

`@dsh-forge/profile-toolchain` 是 DSH Forge 的私有 workspace 工具链，负责把发行版输入编译为可复现的 profile 和发布证据。它读取 `distribution.yml`、`profiles/<name>/profile.yml`、bundle manifest、静态 catalog 和 runtime matrix；它不替代 DSH runtime 或 Electron 宿主。

## 边界与输入

该包不是独立发布的 npm SDK。支持的 workspace 边界由 [`package.json`](package.json) 的 `exports` 声明。Consumer 必须使用 package exports，不能跨 workspace 导入 `src/`。

手工维护的输入包括：

- `distribution.yml`：发行版身份、默认 profile、平台和更新信任配置。
- `profiles/<name>/profile.yml`：固定 runtime 版本和有序 bundle 名称。
- Bundle 的 `package.json` 与 `cordis.patch.yml`：DSH manifest、依赖和 patch 注册。
- `catalog/catalog.yml`：精确来源、版本、integrity、许可证、能力和审核事实。
- 根 `pnpm-workspace.yaml`：生命周期构建脚本的允许策略。

生成 profile 目录、lockfile、resolved manifest、SBOM 输入、许可证通知和 runtime manifest 都属于 `artifacts/`。它们是验证证据，不能成为手工维护的组合源。

## 快速开始

```sh
pnpm install --frozen-lockfile
pnpm --filter @dsh-forge/profile-toolchain build
pnpm run profile:resolve -- developer
pnpm run profile:verify -- developer
```

根脚本把 profile 参数传给同一 CLI 实现。成功命令输出 JSON；预期业务失败使用稳定错误码并返回非零状态。

## CLI

实现位于 [`src/cli/index.ts`](src/cli/index.ts)。Profile 命令使用显式 profile；省略时使用 `distribution.yml` 的 `defaultProfile`。显式 profile 无效时失败，绝不静默回退。

| Command | 作用 |
| --- | --- |
| `profile:resolve [profile]` | 编译 profile、解析依赖闭包并写出证据。 |
| `profile:verify [profile]` | 重新编译并比较源文件、工具、lockfile 和 manifest 事实。 |
| `dump-config [profile]` | 运行真实 DSH loader 并输出规范化 config dump。 |
| `catalog:verify` | 检查 catalog schema、ID、来源事实和审核期限。 |
| `package:inspect [profile]` | 检查 Electron 产物的 profile 闭包、动态导入和 native 文件。 |
| `release:gate [profile]` | 汇总 profile、包、catalog、SBOM、native evidence 和 smoke 证据。 |
| `docs:check` | 检查文档链接、命令、示例、公开范围和双语配对。 |
| `docs:pair --write [file]` | 为一个或全部公开双语配对记录 Git blob hash。 |

## 编译契约

编译器在计算输入摘要前校验 schema 字段、runtime 版本、bundle patch、peer 范围、完整 Git commit、catalog 来源和生命周期脚本授权，然后写出 profile-local package manifest、patch、workspace 文件、lockfile、resolved manifest、SBOM 输入和许可证通知。

组合器按 `profile bundle -> profile patch -> DSH Home patch -> launcher overlay` 组合配置，运行真实 DSH loader，并把未匹配 patch 或缺少 entry 报告为不健康。Overlay 是类型化的，不能回写 source profile。

## Catalog 与发布

Catalog 是静态审核快照，不是运行时插件市场。`installationConfirmation()` 将 catalog 条目、目标 profile、精确版本、来源、integrity、允许构建脚本和明确确认绑定。启动期安装会被拒绝。插件执行模式仍是 `trusted-in-process`；catalog 检查不是进程隔离。

发布门禁要求 profile 已验证、config dump 健康、安装包检查、平台 native evidence、smoke、catalog、SBOM 和许可证通知全部满足。当前 GitHub Tag Release 允许发布明确标记为 `unsigned-smoke` 的安装包；代码签名、公证和自动更新 channel 由后续独立变更处理。

## 验证

```sh
pnpm --filter @dsh-forge/profile-toolchain build
pnpm run typecheck
pnpm run lint
pnpm exec vitest run tests/compiler.test.ts tests/composer.test.ts tests/trust-release.test.ts
pnpm run catalog:verify
pnpm run docs:check
```

架构归属 [`../../docs/design/dsh-forge.zh.md`](../../docs/design/dsh-forge.zh.md)，稳定 service 和配置事实归属 [`../../docs/reference/foundation-contracts.zh.md`](../../docs/reference/foundation-contracts.zh.md)，源/产物边界归属 [`../../docs/engineering/foundation-boundaries.zh.md`](../../docs/engineering/foundation-boundaries.zh.md)。
