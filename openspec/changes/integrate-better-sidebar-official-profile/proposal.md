## Why

`dsh-better-sidebar` 已提供可加载的 DSH bundle，但官方 profile 当前只能解析根安装锚点中的 bundle，无法把经过审核的外部 npm bundle 确定性地写入 profile 依赖、锁文件、SBOM 与桌面运行时。插件的 `node-pty` 原生模块还需要随 Electron ABI 和发布目标接受验证；否则即使开发态偶然启动成功，也无法作为可复现的官方发行内容。

## What Changes

- 将 DSH runtime 从 `0.1.0-rc.7` 升级到与 `dsh-better-sidebar@0.14.0` peer 依赖兼容的 `0.1.0-rc.8`，并同步锁定所有相关 DSH 包。
- 将 `dsh-better-sidebar@0.14.0` 以精确 npm 来源加入官方 profile，不为其创建空包装 bundle，也不使用 `latest`、分支或未发布的 Git 提交。
- 在静态 catalog 中记录该插件的 L1 审计事实、完整性、依赖和脚本摘要、能力范围、`trusted-in-process` 执行模式与目标平台验证要求。
- 让 profile 编译器将选择的外部 bundle 写入 profile-local 依赖、锁文件、SBOM 与运行时闭包，并在启动时允许受控地从该闭包解析 Cordis entry。
- 让桌面打包流程重建、发现并记录原生 addon，拒绝未被 runtime manifest 覆盖或未通过目标 ABI 冒烟的交付物。
- 更新官方发行版设计和验证文档，明确静态第三方 bundle 的准入、默认启用、能力边界与构建时使用方式。

## Capabilities

### New Capabilities

- `official-third-party-bundle-integration`: 官方 profile 对已审计、精确锁定的第三方 DSH bundle 的准入、选择与默认运行行为。
- `profile-external-bundle-resolution`: 外部 bundle 的 profile-local 依赖、锁定、SBOM、运行时闭包和受控模块解析。
- `packaged-native-addon-verification`: Electron 桌面包中原生 addon 的 ABI 重建、清单记录与目标平台发布验证。

### Modified Capabilities

无。

## Impact

- 影响 `profiles/dsh-forge-official`、`catalog/catalog.yml`、根依赖和 pnpm 锁文件，以及 profile compiler、桌面 Host loader、打包和 smoke 脚本。
- 新增针对外部 bundle 闭环、启动解析、catalog 审计、原生 addon manifest 和平台目标的定向测试。
- 官方发行版将默认加载具有文件、网络、Git 和可选终端能力的第三方插件；其执行模式仍是 `trusted-in-process`，不构成 Electron 或 Node 沙箱隔离。
