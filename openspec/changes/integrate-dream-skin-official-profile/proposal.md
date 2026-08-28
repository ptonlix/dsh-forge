## Why

`dsh-dream-skin` 是带有有效 `dsh.bundle.patch` 和 Web client 声明的已发布
DSH bundle。用户要求将其作为官方桌面 profile 的默认视觉主题功能交付；若不将版本、
来源、完整性、能力与验证事实写入 profile 和静态 catalog，桌面包无法审计或复现该选择。

## What Changes

- 将 `dsh-dream-skin@8.28.0` 以精确 npm 来源加入 `dsh-forge-official` profile。
- 在根依赖、锁文件和静态 catalog 中固定该包的来源、完整性、许可证、能力和审核事实。
- 用真实 profile 组合与 Host Loader 测试验证该 bundle 只激活一次，且不改变 launcher
  对 `@dsh-forge/desktop-layer` 的临时注入所有权。

## Capabilities

### Modified Capabilities

- `official-third-party-bundle-integration`: 官方 profile 增加一个精确审计并默认启用的
  第三方视觉主题 bundle。

## Non-goals

- 不修改或 fork 上游 Dream Skin 源码。
- 不增加页面端插件安装、运行时下载或 profile 切换能力。
- 不将 `trusted-in-process` 描述为进程隔离或安全认证。
- 不将同一 document 内的 client HMR 作为官方桌面发行支持路径；正式 generation
  切换会销毁旧 `BrowserWindow`，因此该路径不跨 generation 保留 renderer 资源。

## Impact

- 修改 `package.json`、`pnpm-lock.yaml`、`profiles/dsh-forge-official/profile.yml`、
  `catalog/catalog.yml` 和对应的 profile/Loader 测试。
- 新增的 host half 持久化用户选择的皮肤与壁纸到 `$DSH_HOME/dream-skin.json`，并提供
  同源、受 Host authority 校验的 `/dream-skin/api` 路由。
