# DSH Forge 基础契约参考

本文面向发行版维护者和 DSH Host 插件作者，说明当前实现的配置、公共 service 与运行时清单。它不替代 OpenSpec capability spec 的验收语义。

## 发行版与 Profile

仓库根目录的 `distribution.yml` 是发行版身份唯一来源。它必须声明 `schema`、`id`、`name`、`packageScope`、`applicationId`、`version`、`defaultProfile` 和至少一个平台/架构目标。更新启用时还必须声明 `channel`、`metadataUrl` 与 `trustRoot`；缺少其中任一项时不能标记为生产发布。

`profiles/<name>/profile.yml` 只声明固定 runtime 版本组和有序 `bundles`。顶层 `plugins` 字段被拒绝。`@dsh-forge/desktop-layer` 也不能写入 bundles，它由 launcher 在当前 generation 临时注入。profile 同目录的 `cordis.patch.yml` 是该 profile 的最终覆盖层。

`profile:resolve` 在 `artifacts/<distribution>/<profile>/<input-digest>/` 生成：

- `profile/package.json` 与 `profile/dsh.profile.bundles`；
- `profile/cordis.patch.yml`、`profile/pnpm-workspace.yaml` 和 `profile/pnpm-lock.yaml`；
- `resolved-manifest.json`、`sbom.input.json`、`THIRD-PARTY-NOTICES.txt` 和 `config-dump.json`；
- `package-input/`，作为 Electron Builder 的受检输入。

锁文件和 resolved manifest 是解析证据，不是人工组合意图。修改 source profile、bundle、版本或授权后必须重新执行 `profile:resolve` 与 `profile:verify`。

## desktopProfiles

`@dsh-forge/desktop-services` 是唯一公开 import。它以 Cordis `Context` 声明
`desktopProfiles`、`desktopPnpm` 和 `desktopServices`，并通过
`assertDesktopServicesProtocol()` 协商 protocol `1`。`desktopProfiles.current` 是
generation 内不可变的名称快照；`snapshot()` 返回深度冻结的 profile 快照；`list()`
只读返回 profile 摘要、可选择性和诊断；`select(name)` 先原子持久化 pending，再完整
dispose 当前 generation 后重启。

同一 generation 并发选择同一个目标共享同一 operation；选择不同目标会失败，且不会覆盖已持久化 pending。generation dispose 后的 service 引用必须失败，不能影响新 generation。

## desktopPnpm

公开 `DesktopPnpm` 只接受判别 command 或 catalog confirmation 派生的
`ConfirmedPluginInstall`，不接受原始 pnpm 参数数组或任意 `object` options。operation
提供 Node `Readable` 的 `stdout` 与 `stderr`、包含 `exitCode`、`signal` 和 `cancelled`
的 `done` Promise，以及返回 Promise 的幂等 `cancel()`。`done` 直到完整进程树、
reconcile、来源验证、健康检查和 receipt 或恢复完成才结算。

第三方插件只能依赖上述 exports；Electron `desktopRuntime`、host provider、原生路径和启动事实均为内部实现。

每个 generation 同时最多一个 operation。已取消 signal、busy 状态或已关闭 generation
都会在启动子进程前失败。registry 安装必须使用 catalog 确认的 registry、tarball 和
integrity；Git 安装必须使用完整 commit。provider 在提交 receipt 前比较 lockfile 的名称、
精确版本、来源与完整性。

恢复事务只保护 `package.json`、`pnpm-lock.yaml` 与 `pnpm-workspace.yaml`。它不承诺回滚 `node_modules`；下一 generation 健康失败或无法证明 profile 一致时，状态会标记为人工恢复。

## 信任与运行时清单

Host descriptor 和 catalog 条目的 `executionMode` 固定为 `trusted-in-process`。Host support、插件请求、用户/策略授权、审计事实和 enforcement status 分开保存。`enforcement: unavailable` 表示公共 API 不是 Node 或 Electron 安全边界。

`resolved-manifest.json` 记录 profile runtime、bundle、来源、完整性、许可证、脚本、`allowBuilds`、平台和输入摘要。`runtime-manifest` 在此基础上记录 Electron、Node、pnpm、native addon、已构建目标、声明目标和签名状态；它是运行时闭包检查的输入，不是签名、来源可信度或恶意代码安全证明。

macOS 产物将 launcher runtime 放在 `Contents/Resources/dsh-forge/runtime/node_modules`，并将解引用的
profile 闭包放在 `Contents/Resources/dsh-forge/profile/node_modules`。DSH Host 必须以 profile 的
`package.json` 为模块锚点解析 DSH、外部 bundle 与 peer 依赖；launcher runtime 只能为临时注入的
`@dsh-forge/desktop-layer` 提供受限 fallback，不能成为 profile bundle 的解析来源。
