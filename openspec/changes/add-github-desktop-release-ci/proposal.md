## Why

仓库已有可审计的 Electron 目录打包、profile 解析、native smoke 和
`release:gate`，但没有 GitHub Actions 编排，开发者无法在声明的 macOS 和 Windows
目标上得到一致、可追溯的 desktop 产物。现在引入 CI 矩阵可以把现有本地门禁搬到对应
平台执行，并让每个架构的产物、runtime manifest、SBOM 和 smoke evidence 一起归档。

## What Changes

- 新增 GitHub Actions 工作流，按 `darwin-universal`、`win32-x64` 和 `linux-x64` 矩阵构建
  desktop 包；macOS 只发布一个同时包含 arm64/x64 的 universal 包，Linux 面向 Ubuntu LTS。
- 在构建前执行 profile resolve/verify、config dump、catalog 校验和仓库静态门禁；构建
  后执行 package inspect、平台 smoke 和 `release:gate` 所需的证据收集。
- 扩展 desktop 打包入口，使 CI 能为当前平台生成可下载的安装包/归档，同时保留现有
  `artifacts/<distribution>/<profile>/...` 证据布局和确定性命名。
- 将每个矩阵目标的安装包、runtime manifest、package evidence、native verification
  和 smoke report 上传为独立 GitHub Actions artifact，并在同一工作流中汇总索引。
- 对 tag 发布增加版本与 profile 身份检查；只有所有声明目标证据齐全且
  `release:gate` 通过时才创建 GitHub Release。没有签名身份时只能保留 CI smoke artifact，
  不得进入生产更新发布。
- 将官方 profile 使用的外部 bundle `dsh-better-sidebar` 的 catalog tier 与编译器契约对齐为
  `L1`，使 CI 的 profile resolve/verify 能在固定输入上运行；不改变 bundle 版本、来源或执行模式。
- **不包含**代码签名、公证、Authenticode 证书或自动更新通道的实现；这些仍由现有发布
  契约约束，并需要独立的凭据与变更。

## Capabilities

### New Capabilities

- `github-desktop-release-ci`: 定义 GitHub Actions 的平台矩阵、universal macOS 构建、
  Ubuntu Linux 构建、产物证据归档、手动/tag 触发和生产 Release 门禁。

### Modified Capabilities

无。现有 Electron 打包和 `release:gate` 的运行时契约保持不变；本变更只提供其 CI 编排
和可下载产物出口。

## Impact

- 新增 `.github/workflows/` 工作流和必要的 CI 辅助脚本/配置。
- 修改根 `package.json` 的 CI 打包命令及 `scripts/package-desktop.ts` 的目标/格式参数，
  不改变 profile、公开 desktop service 或运行时 generation API。
- 修改 `catalog/catalog.yml` 中现有外部 bundle 的 tier 事实，以满足官方 profile 的既有审计要求。
- 可能更新 `docs/engineering/foundation-verification.md` 与发布参考，记录 CI 证据、平台
  覆盖和签名缺口。
- GitHub Actions 需要仓库 `contents: write`（仅 tag Release job）以及平台签名/公证凭据
  时才允许使用对应 secret；普通构建 job 不读取发布凭据。
