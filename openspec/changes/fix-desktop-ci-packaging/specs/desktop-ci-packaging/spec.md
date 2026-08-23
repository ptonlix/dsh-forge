## ADDED Requirements

### Requirement: native rebuild 必须使用可校验的 Electron headers

打包脚本 SHALL 将 `ELECTRON_REBUILD_DIST_URL` 传给 `@electron/rebuild`，默认值 SHALL 为
`https://www.electronjs.org/headers`，且不得复用只用于 Electron runtime 的镜像地址。

#### Scenario: Electron 43 headers 下载

- **WHEN** runner 首次为 Electron 43.4.0 重建 `node-pty`
- **THEN** node-gyp 使用 Electron headers 的 `SHASUMS256.txt` 完成校验，不因
  `remote undefined` 失败。

### Requirement: 首次原生构建必须有足够预算

每个目标架构的 native rebuild SHALL 使用不少于 15 分钟的超时；超时或非零退出 SHALL
返回 `ELECTRON_REBUILD_FAILED`，并保留有限 stdout/stderr、status、signal 和启动错误。

### Requirement: profile 物化必须区分锁解析与依赖下载

profile lock 解析 SHALL 保持 offline；物化安装 SHALL 使用 frozen lockfile，并根据
`DSH_FORGE_PROFILE_OFFLINE` 选择 `--offline` 或 `--prefer-offline`。CI 在缓存缺失时 SHALL
允许按 lockfile 下载，不得改变版本或完整性。

#### Scenario: pnpm store 缺少锁定 tarball

- **WHEN** CI 的 profile store 未包含 `@deepseek-ai/dsh` 或外部 bundle tarball
- **THEN** `profile:verify` 通过网络获取 lockfile 指定 tarball 后继续，不能直接返回
  `PNPM_NO_OFFLINE_TARBALL`。

### Requirement: CI 必须显式声明构建网络策略

工作流 SHALL 为所有 validate/package/summary 相关 profile 命令声明
`DSH_FORGE_PROFILE_OFFLINE=false` 和 `ELECTRON_REBUILD_DIST_URL`，并保留 frozen install。
package 矩阵任务 SHALL 设置不少于 60 分钟的总超时预算。
