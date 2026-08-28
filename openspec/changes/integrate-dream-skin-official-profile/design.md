## Context

`dsh-dream-skin@8.28.0` 是 npm 发布的标准双面 DSH bundle。其 patch 仅注册
`dream-skin` entry；host half 使用 `webServer` 和 `webRuntime` 提供受同源与 authority
检查保护的状态 API，client half 注册主题与设置项。

当前官方 profile 已支持精确锁定的外部 bundle：compiler 将它们写入 profile-local
依赖、锁文件、SBOM 和物化闭包，desktop Host 从受管 profile 解析 entry。Dream Skin
不含原生模块或 npm runtime dependencies，因此不需要新增原生 addon 交付逻辑。

## Decisions

### 1. 直接选择发布包

官方 profile 在 `@deepseek-ai/dsh-web-app` 后加入 `dsh-dream-skin@8.28.0`。不创建
wrapper bundle，也不使用 Git 分支、tag、范围版本或 `latest`。launcher 仍在 Web bundle
之后临时注入 `@dsh-forge/desktop-layer`，不写入 profile。

### 2. 以 L1 catalog 记录官方准入事实

catalog 将记录 npm registry、tarball、`sha512` integrity、MIT、维护者、空 runtime
dependency 与空 lifecycle-script 摘要、实际能力和当前已验证平台。该条目使用
`trusted-in-process` 与 `enforcement: unavailable`；L1 是构建准入和兼容性记录，不是
第三方作者可信或进程隔离证明。

### 3. 将同页 HMR 限定为开发态残余风险

`8.28.0` client bundle 在 Cordis plugin factory 外创建全局 `MutationObserver`，没有
`disconnect()`；上游 client HMR 在同一 document 重载该 bundle 时会累积观察器。Forge
的 profile 切换、失败回退和完整重启先销毁旧 `BrowserWindow`，因此 observer 不跨桌面
generation 继续存活。正式发行资源不会由 HMR watcher 改写；开发态 HMR 不作为此官方
desktop 功能的支持或验收路径。

## Risks

- 插件可将用户选择的皮肤、壁纸和导入主题包写入 `$DSH_HOME/dream-skin.json`；壁纸可
  包含个人图片数据。状态文件由插件以 owner-only 模式写入，但该行为仍属于
  `trusted-in-process` 的文件写入能力。
- client bundle 可读取用户选择的本地文件以设置壁纸，并通过同源 API 读写状态；catalog
  必须如实记录 browser storage、用户选取文件、文件写入与 loopback HTTP 能力。
- HMR 重载若被后续桌面开发流程开启，会出现 observer 与 style 累积；上游修复后应重新
  审计版本、integrity 与能力事实。

## Verification

运行 `pnpm run catalog:verify`、`pnpm run profile:resolve -- dsh-forge-official`、
`pnpm run profile:verify -- dsh-forge-official`、`pnpm run dump-config -- dsh-forge-official`，
以及覆盖 profile bundle 顺序、profile-local 物化与真实 Host Loader 的定向测试。
