# DSH Forge

中文 | [English](README.md)

DSH Forge 是围绕 DeepSeek Harness（DSH）构建可审计桌面发行版的可 Fork 工具链。它把发行版身份、构建期 profile、bundle、依赖解析、桌面 service 和发布证据组合为可复现的 Electron 输入。

它不是 DSH agent loop、会话协议、模型运行时或第三方插件源码的替代实现。上游 DSH 负责这些事实；本仓库负责发行版组合、桌面宿主和构建验证。

## 当前范围

- 使用 Chromium sandbox、context isolation 且关闭 Node integration 的 Electron 宿主。
- 由 `distribution.yml` 描述身份，由 `profiles/<name>/profile.yml` 描述构建期组合。
- 生成依赖闭包、lockfile、SBOM 输入、许可证通知和发布检查。
- 以静态 catalog 保存来源、integrity、许可证、能力和审核事实。
- 为受控 Host 集成提供公开的 `@dsh-forge/desktop-services` contract。

打包应用在构建期绑定一个 profile。开发命令可以使用 `--profile` 选择 profile；已交付 UI 没有运行时 profile 切换、插件市场或在线安装插件。当前声明的平台是 macOS `arm64`/`x64` 和 Windows `x64`；此检出目录没有生产签名和公证身份。

## 快速开始

### 环境要求

- Node.js `>=20.0.0`。
- pnpm `11.7.0`。
- 能运行 Electron 的 macOS 或 Windows 环境。

安装依赖并启动默认开发 profile：

```sh
pnpm install --frozen-lockfile
pnpm dev
```

使用其他开发 profile：`pnpm dev -- --profile developer`。profile 解析和打包使用 `distribution.yml`、`profiles/`、`catalog/` 和 `packages/bundles/` 中的源文件；`artifacts/` 下的生成文件是可删除的证据，不是手工维护输入。

## 常用命令

```sh
pnpm run profile:resolve -- dsh-forge-official
pnpm run profile:verify -- dsh-forge-official
pnpm run package:desktop -- dsh-forge-official
pnpm run package:inspect -- dsh-forge-official
pnpm run package:smoke -- dsh-forge-official
```

质量和文档检查命令：

```sh
pnpm run check:all
pnpm run docs:check
pnpm run docs:build
```

## 公开桌面 contract

第三方 bundle 和 Fork 只能导入 [`@dsh-forge/desktop-services`](packages/desktop-services/README.zh.md)。该包发布类型化的 `desktopProfiles`、`desktopPnpm` 和 `desktopServices` service。[`desktop-services-local`](packages/desktop-services-local/README.zh.md) 是启动器和 desktop layer 使用的私有 provider，不是 consumer API。

## 文档导航

公开文档地图见 [`docs/README.zh.md`](docs/README.zh.md)。架构归属 [`docs/design/dsh-forge.zh.md`](docs/design/dsh-forge.zh.md)，稳定配置和 service 事实归属 [`docs/reference/foundation-contracts.zh.md`](docs/reference/foundation-contracts.zh.md)，源/产物和恢复边界归属 [`docs/engineering/foundation-boundaries.zh.md`](docs/engineering/foundation-boundaries.zh.md)。profile 编译器见 [`tools/profile-toolchain/README.zh.md`](tools/profile-toolchain/README.zh.md)。

每篇公开页面都由英文 `foo.md`、中文 `foo.zh.md` 和 `foo.i18n.yaml` hash 记录组成。双语治理规则见 [`docs/i18n/README.md`](docs/i18n/README.md)。

## Fork 边界

Fork 应修改 `distribution.yml`、创建自己的 profile、在静态 catalog 中审核每个外部 bundle，并在打包前重新构建 profile。不要把生成产物、DSH 核心或第三方插件源码复制为第二套源代码。
