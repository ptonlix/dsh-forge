## Why

本地上游 `deepseek-harness` 已发布 `0.1.1-rc.2`。当前 DSH Forge 仍固定在
`0.1.0-rc.8`，会使 profile runtime、构建依赖和安装锁文件继续解析旧的 DSH
依赖闭包。

## What Changes

- 将 DSH runtime matrix、根包和 `profile-toolchain` 的直接 DSH 依赖升级到
  `0.1.1-rc.2`。
- 将 developer/official profile 与 DSH bundle 测试夹具同步到同一版本。
- 重新生成 pnpm 锁文件，使根依赖和可升级的 DSH 子包闭包切换到上游发布版本；
  对上游元数据仍声明旧 peer 的传递包保留 pnpm 的真实解析结果。
- 使用现有 profile、Loader 和工具链测试验证升级后的公开行为与失败语义。

## Capabilities

### Modified Capabilities

- `runtime-profile-resolution`：profile 允许的固定 DSH runtime 组合更新为
  `0.1.1-rc.2`。

## Impact

影响根 `package.json`、`tools/profile-toolchain`、两个 profile、测试夹具和
`pnpm-lock.yaml`。不改变桌面 service 协议、插件准入、Electron 安全边界或发行版
profile 的 bundle 顺序。

## Non-goals

- 不升级 Cordis、Electron 或第三方 bundle。
- 不修改已完成变更的历史 OpenSpec 记录。
- 不执行提交、推送、签名或发布操作。
