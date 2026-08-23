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

### Requirement: Universal native 依赖必须按架构隔离

macOS Universal SHALL 为 profile staging 安装 lockfile 声明的 arm64 和 x64 optional native
依赖。合并器 SHALL 只对一份 arm64 Mach-O 和一份 x86_64 Mach-O 执行 lipo；相同架构文件或
架构专属 package 路径不得重复合并。

#### Scenario: sharp optional package

- **WHEN** profile 同时包含 `@img/sharp-darwin-arm64` 和 `@img/sharp-darwin-x64`
- **THEN** Universal 产物保留两套 package，并按 Electron `process.arch` 选择对应文件；不因
  同一 staging 中的相同架构文件触发 lipo 失败。

### Requirement: builder 不得重复重建 native addon

生成的 electron-builder 配置 SHALL 设置 `npmRebuild: false`。受控 native rebuild 失败时必须
先阻止 builder，builder 不得自行改变 profile 闭包或重写 native evidence。

### Requirement: package job 不得隐式发布

electron-builder SHALL 使用 `--publish never`。Tag package job 只生成并上传 artifact，发布
动作 SHALL 由独立 Release job 负责。

#### Scenario: Tag 构建

- **WHEN** workflow 从 `v*` Tag 进入平台 package job
- **THEN** electron-builder 不得尝试创建或更新 GitHub Release；package job 只输出本平台产物。

### Requirement: 跨平台产物必须使用安全可执行文件名

electron-builder 配置 SHALL 使用不含 `@`、`/` 等 scope 字符的发行版 id 作为
`executableName`；Linux SHALL 同时设置相同的 `desktopName`。

### Requirement: profile 安装必须容纳首次下载

profile 物化、verify 临时安装和冻结安装 SHALL 使用不少于 15 分钟的进程预算；超时或非零
退出必须保留 status、signal 以及 stdout/stderr 的头尾诊断。

electron-builder 的安装包生成 SHALL 使用不少于 45 分钟的进程预算，以覆盖 macOS
Universal 双架构复制、合并和压缩；超时必须返回 `ELECTRON_BUILDER_FAILED` 并保留
`ETIMEDOUT`/signal 诊断。

### Requirement: profile 物化必须区分锁解析与依赖下载

profile lock 解析 SHALL 保持 offline；物化安装 SHALL 使用 frozen lockfile，并根据
`DSH_FORGE_PROFILE_OFFLINE` 选择 `--offline` 或 `--prefer-offline`。CI 在缓存缺失时 SHALL
允许按 lockfile 下载，不得改变版本或完整性。

#### Scenario: pnpm store 缺少锁定 tarball

- **WHEN** CI 的 profile store 未包含 `@deepseek-ai/dsh` 或外部 bundle tarball
- **THEN** `profile:verify` 通过网络获取 lockfile 指定 tarball 后继续，不能直接返回
  `PNPM_NO_OFFLINE_TARBALL`。

### Requirement: Electron 应用与 profile runtime 必须物理分离

打包脚本 SHALL 生成只包含 Electron 主进程 production dependency closure 的独立 staging；
不得把 workspace 根 `node_modules` 再复制到第二个 runtime 目录。builder 阶段的 profile
资源 SHALL 只包含配置文件，完整 profile `node_modules` SHALL 在最终应用生成后复制一次。
打包应用启动时，DSH runtime SHALL 从 `dsh-forge/profile/node_modules` 解析。

### Requirement: Universal native staging 必须限制在原生模块

Universal staging SHALL 只复制和保存 node-pty 等原生模块的架构输出；架构专属的 sharp、
ripgrep、koffi 等 optional package SHALL 保持独立路径。`node-pty/build/Release` 等 host-specific
输出 SHALL 在完成重建后删除，避免覆盖另一架构。

### Requirement: builder 配置必须仅声明当前目标平台

打包脚本 SHALL 只向 electron-builder 输出当前 runner 的平台配置段。macOS Universal SHALL
设置 `mergeASARs: false`，并以一个 `x64ArchFiles` minimatch 字符串覆盖按目录隔离的原生包；
不得使用数组。该规则 SHALL 覆盖目录名已编码 Darwin 架构的包、所有 `prebuilds/darwin-*` 与
已 universal 的文件，避免 `@electron/universal` 对 `app.asar.unpacked` 内相同路径的文件再次
执行 lipo。

#### Scenario: macOS Universal 配置校验

- **WHEN** `darwin-universal` 打包生成 electron-builder 配置
- **THEN** 配置只包含 `mac` 平台段，不包含 `linux`、`win`，且 `x64ArchFiles` 为覆盖 native
  package 路径的单个字符串，并通过当前 electron-builder 版本的 schema 校验与 Universal 合并。

### Requirement: Windows native rebuild 必须使用短路径 staging

Windows 打包 SHALL 在系统临时目录的短路径副本中执行 `node-pty` 原生重建。重建成功后，脚本
SHALL 只回写对应 `node-pty/build` 输出至正式 profile，临时副本不得替代正式 profile 的
lockfile、配置或其余依赖；成功、失败和超时路径均 SHALL 清理临时目录。

#### Scenario: Windows MSBuild 中间文件

- **WHEN** profile artifact 路径包含长 digest 且 `node-pty` 需要为 Electron 重建
- **THEN** MSBuild 的输出路径位于短临时 staging，不因正式 artifact 的嵌套路径写入 C1258 或
  FTK1011 失败。

### Requirement: Linux Debian 包必须携带 FPM 元数据

独立 desktop-deploy 的 package metadata SHALL 保留项目 `homepage`。Linux builder 配置 SHALL
从 distribution branding 提供非空 `maintainer` 与 `vendor`，使 `.deb` 目标不依赖根 package
的个人 author 邮箱。

#### Scenario: Ubuntu Deb 打包

- **WHEN** `linux-x64` 请求 `deb` 格式
- **THEN** electron-builder FPM 能读取项目 URL、维护者和 vendor，并继续创建 Debian 控制文件。

### Requirement: CI 必须显式声明构建网络策略

工作流 SHALL 为所有 validate/package/summary 相关 profile 命令声明
`DSH_FORGE_PROFILE_OFFLINE=false` 和 `ELECTRON_REBUILD_DIST_URL`，并保留 frozen install。
package 矩阵任务 SHALL 设置不少于 60 分钟的总超时预算。

### Requirement: 分发格式必须从已注入 profile 的短路径应用封装

打包脚本 SHALL 先在仓库受控的 `.desktop-work/<target>` 短路径生成单一已解包 Electron
应用。完整 profile `node_modules` 闭包、runtime manifest 和 package evidence SHALL 基于该
已解包应用生成。请求 DMG、ZIP、NSIS、AppImage 或 DEB 时，脚本 SHALL 使用
electron-builder 的 `--prepackaged` 从该已解包应用封装分发格式；不得在复制 profile 闭包前
生成任何请求的分发格式。

工作目录 SHALL 保留至当前 runner 的 `package:inspect` 与 `package:smoke` 完成，不得写入
发布 artifact；下次相同目标构建可以覆盖该目录。

#### Scenario: Windows ConPTY helper 进入 NSIS 和 ZIP

- **WHEN** `win32-x64` profile 中的 `node-pty` 包含 ConPTY `OpenConsole.exe`
- **THEN** 已解包应用及其 profile 闭包位于 `.desktop-work/win32-x64` 的短路径
- **AND** `package:inspect` 不因该 helper 返回 `NATIVE_FILE_MISSING`
- **AND** NSIS 与 ZIP 均从该已注入闭包的应用封装。
