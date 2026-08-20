# 基础契约验证记录

本记录对应 OpenSpec 变更 `establish-dsh-forge-foundation-contracts` 以及后续的
`align-repository-with-distribution-design`。以下命令于 2026-08-19 在 macOS 开发环境执行；
结果覆盖当前工作区的 schema、profile 编译、真实 DSH 配置转储、generation/service 契约、
catalog、更新签名、目录边界和未签名 Electron 产物输入。

## 本地桌面开发启动

安装依赖后，可直接使用以下命令启动未打包的 Electron 桌面端：

```sh
pnpm dev
```

该命令会先编译 TypeScript 和 workspace 包，再执行 Electron。启动 profile 默认读取
`distribution.yml` 的 `defaultProfile`（当前为 `official`），因此开发启动不需要追加
`-- official`；`official` 参数只在需要显式选择 profile 的构建或验证命令中使用。

```sh
pnpm run check
pnpm run acceptance
pnpm run profile:resolve
pnpm run profile:verify
pnpm run dump-config -- official
pnpm run catalog:verify
pnpm run check:all
pnpm run boundaries:check
pnpm run profile:resolve -- developer
pnpm run profile:verify -- developer
pnpm run dump-config -- developer
pnpm run package:desktop -- official
pnpm run package:inspect -- official
pnpm run package:smoke -- official
pnpm run docs:check
git diff --check
openspec validate "align-repository-with-distribution-design" --type change --strict --no-interactive
```

已通过的本地证据包括 40 个测试、临时目录冻结 pnpm 锁解析、官方与 developer profile
产物隔离、真实 DSH patch dump、generation 恢复与进程树取消、静态 catalog、Ed25519 更新
元数据校验、Fork 身份投影、Markdown 链接检查、目录边界检查、OpenSpec 严格校验，以及
清理旧 `dist` 后的重新构建。Electron 目录产物的 `package:inspect` 和 `package:smoke` 均
已在当前 macOS arm64 环境通过。

当前没有 macOS 代码签名/公证身份或 Windows Authenticode 身份。`pnpm run package:signing -- darwin` 因缺少身份以退出码 2 结束，明确只允许 `unsigned-smoke`；`release:gate` 必须拒绝生产发布。

当前仍没有 macOS 代码签名/公证身份或 Windows Authenticode 身份；本次 Electron 产物明确标记为
`unsigned-smoke`，不能作为生产发布证据。Windows 目标、macOS 签名/公证、native ABI 和
更新发布链路仍需在对应平台构建机与平台身份上执行。
