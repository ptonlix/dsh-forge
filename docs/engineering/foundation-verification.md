# 基础契约验证记录

本记录对应 OpenSpec 变更 `establish-dsh-forge-foundation-contracts`。以下命令于 2026-08-19 在 macOS 开发环境执行；结果覆盖当前工作区的 schema、profile 编译、真实 DSH 配置转储、generation/service 契约、catalog、更新签名和未签名产物输入。

```sh
pnpm run check
pnpm run acceptance
pnpm run profile:resolve
pnpm run profile:verify
pnpm exec tsx src/cli/index.ts dump-config
pnpm run catalog:verify
pnpm run format:check
git diff --check
openspec validate "establish-dsh-forge-foundation-contracts" --type change --strict
```

已通过的本地证据包括 31 个 Node 测试、临时目录冻结 pnpm 锁解析、profile 产物重建、真实 DSH patch dump、generation 恢复与进程树取消、静态 catalog、Ed25519 更新元数据校验、Fork 身份投影、Markdown 链接检查和 OpenSpec 严格校验。

当前没有 macOS 代码签名/公证身份或 Windows Authenticode 身份。`pnpm run package:signing -- darwin` 因缺少身份以退出码 2 结束，明确只允许 `unsigned-smoke`；`release:gate` 必须拒绝生产发布。

本轮 `pnpm run package:inspect` 因尚未生成真实 Electron `.app` 正确停止，未将其记录为通过。真实 Electron `.app` 的启动、renderer boot、退出和诊断导出需要在允许 GUI 与 loopback 监听的本机终端执行 `pnpm run package:desktop`、`pnpm run package:inspect` 和 `pnpm run package:smoke`。这不是签名、公证、Windows ABI 或更新发布证据；这些生产门禁只能由对应平台构建机和平台身份完成。
