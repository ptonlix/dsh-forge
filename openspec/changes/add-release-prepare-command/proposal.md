## Why

当前发布版本需要维护者手动修改 `distribution.yml` 的版本和根 `package.json` 的
`dshForgeBuild`，容易遗漏、误降级或在同一版本重发时重复使用 build。需要一个发布前命令
统一校验并更新这两个源文件。

## What Changes

- 新增 `pnpm run release:prepare -- <version>` 发布准备命令。
- 严格校验目标版本为精确 SemVer，并拒绝低于当前发行版本的目标。
- 新版本将 `distribution.yml` 与根 `package.json` 的 `version` 同步为目标版本，并将 `dshForgeBuild` 重置为 `1`。
- 同一版本重发时保持版本不变并将 `dshForgeBuild` 递增一个正安全整数。
- 校验两个版本源一致后才写入源文件；失败时输出可操作诊断且不修改文件。
- 输出本次版本/build 变化和下一步 annotated `v<version>` tag 提示。

## Capabilities

### New Capabilities

- `release-prepare-command`: 为 DSH Forge 发布维护者提供受校验的版本与 build 准备入口。

### Modified Capabilities

无。

## Impact

- 新增 `scripts/prepare-release.ts` 及对应测试。
- 根 `package.json` 增加 `release:prepare` script。
- 更新发布参考文档和 OpenSpec 使用说明。
- 不改变 Electron 运行时、OTA 协议、安装包下载或 GitHub Actions 发布权限。
