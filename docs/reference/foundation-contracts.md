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

`@dsh-forge/desktop-plugin/profile-service` 公开 protocol `1` 的 profile service 类型。`current` 是 generation 内不可变的名称快照；`snapshot()` 返回深度冻结的 profile 快照；`list()` 只读返回 profile 摘要、可选择性和诊断；`select(name)` 先原子持久化 pending，再完整 dispose 当前 generation 后重启。

同一 generation 并发选择同一个目标共享同一 operation；选择不同目标会失败，且不会覆盖已持久化 pending。generation dispose 后的 service 引用必须失败，不能影响新 generation。

## desktopPnpm

`@dsh-forge/desktop-plugin/pnpm` 公开受管 package operation。operation 提供 Node `Readable` 的 `stdout` 与 `stderr`、包含 `exitCode`、`signal` 和 `cancelled` 的 `done` Promise，以及返回 Promise 的幂等 `cancel()`。`done` 在完整受管进程树退出后才完成。

第三方插件只能依赖上述 exports；Electron `desktopRuntime`、host provider、原生路径和启动事实均为内部实现。

每个 generation 同时最多一个 operation。空参数、NUL、无效绝对路径、已取消 signal、busy 状态或已关闭 generation 都会在启动子进程前失败。`runPlugin()` 禁止 `add`；安装必须调用独立 `installPlugin()`，使用精确版本和恢复事务。

恢复事务只保护 `package.json`、`pnpm-lock.yaml` 与 `pnpm-workspace.yaml`。它不承诺回滚 `node_modules`；下一 generation 健康失败或无法证明 profile 一致时，状态会标记为人工恢复。

## 信任与运行时清单

Host descriptor 和 catalog 条目的 `executionMode` 固定为 `trusted-in-process`。Host support、插件请求、用户/策略授权、审计事实和 enforcement status 分开保存。`enforcement: unavailable` 表示公共 API 不是 Node 或 Electron 安全边界。

`resolved-manifest.json` 记录 profile runtime、bundle、来源、完整性、许可证、脚本、`allowBuilds`、平台和输入摘要。`runtime-manifest` 在此基础上记录 Electron、Node、pnpm、native addon、已构建目标、声明目标和签名状态；它是运行时闭包检查的输入，不是签名、来源可信度或恶意代码安全证明。

macOS 产物将完整 pnpm runtime 放在 `Contents/Resources/dsh-forge/runtime/node_modules`。DSH 必须以该目录中 `@deepseek-ai/dsh` 的真实路径解析依赖，不能以根软链接作为解析锚点，否则 pnpm virtual store 中的 peer 依赖会被错误地报告为缺失。
