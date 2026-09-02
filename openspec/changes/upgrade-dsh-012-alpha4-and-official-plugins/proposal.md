## Why

本地上游 `deepseek-harness` 已发布 `@deepseek-ai/dsh@0.1.2-alpha.4`。当前 DSH Forge
仍固定在 `0.1.1-rc.2` 与 Cordis `4.0.1`，会使 profile runtime、构建依赖和安装锁文件
继续解析旧的 DSH 闭包。官方 profile 的外部 bundle `dsh-better-sidebar@0.14.0` 与
`dsh-dream-skin@8.28.0` 也落后于已发布的精确 npm 版本。

## What Changes

- 将 `RUNTIME_MATRIX`、两个 profile、根包、`profile-toolchain`、desktop-services
  相关包和 DSH bundle 测试夹具升级到 DSH `0.1.2-alpha.4`。
- 将 Cordis 精确版本同步为 `4.0.2`，因为该 DSH 发布依赖 `@deepseek-ai/cordis@^4.0.2`。
- 将官方 profile 外部 bundle 升级为 `dsh-better-sidebar@0.18.0-alpha.0` 与
  `dsh-dream-skin@8.30.1`，并更新 catalog 的版本、integrity、依赖摘要和审核日期。
- 重新生成 pnpm 锁文件，使直接依赖与可升级的 DSH 子包闭包切换到上游发布版本。

## Capabilities

### Modified Capabilities

- `runtime-profile-resolution`：允许的固定 DSH/Cordis runtime 组合更新为
  `0.1.2-alpha.4` / `4.0.2`。
- `official-profile-plugins`：官方 profile 外部 bundle 使用已发布的精确 npm 版本
  `0.18.0-alpha.0` 与 `8.30.1`。

## Impact

影响 runtime 矩阵、两个 profile、公开/私有桌面包的 Cordis peer、catalog、根锁文件、
相关测试夹具和 README 示例版本。不改变桌面 service 协议、Electron 安全边界、官方
profile 的 bundle 顺序，也不把页面端插件市场写成当前产品能力。

## Non-goals

- 不升级 Electron、pnpm 或 Node engine。
- 不把未发布 Git 来源写入 official。
- 不修改已完成变更的历史 OpenSpec 记录。
- 不执行提交、推送、签名或发布操作。
