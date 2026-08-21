## Context

参见 [proposal.md](proposal.md) 的动机和三个新增规范。`dsh-better-sidebar@0.14.0` 已经是带有 `dsh.bundle.patch` 的 npm bundle；其 patch 注册 `better-sidebar` entry，且包内包含 Web 资源和 `node-pty` 原生依赖。当前 profile compiler 仅把测试夹具写入生成 profile 的 `dependencies`，桌面 Host 的裸模块导入锚点也固定为 DSH 安装包，因此无法可靠加载 profile-local 的外部 entry。

上游 `@deepseek-ai/dsh-app-boot` 已有两段式 bundle 解析：先从 DSH 安装锚点查找内置 bundle，再从 profile `package.json` 查找外部 bundle。它的 Loader 裸模块导入仍只接受一个 base URL，故 desktop Host 必须将其指向受管 profile；否则第三方 patch 虽能被读取，entry 仍无法被导入。受管 profile 当前刻意不复制 `node_modules`，打包后的 runtime manifest 也没有记录实际原生文件。

## Goals / Non-Goals

**Goals:**

- 以精确 npm 包、静态审计和确定性 lockfile 使 `dsh-better-sidebar@0.14.0` 成为官方 profile 的默认 bundle。
- 保持 DSH 内置 bundle 与 launcher 注入的 desktop layer 的所有权边界，同时让 Loader 能在受控 profile 闭包中导入外部 entry。
- 让 profile 的依赖、SBOM、打包资源、原生 addon、runtime manifest 和发布验证描述同一闭包。
- 将 DSH 升级为 `0.1.0-rc.8`，满足该插件的 peer 依赖，并用定向测试覆盖拒绝路径。

**Non-Goals:**

- 不将第三方插件隔离到单独进程、VM 或 Electron sandbox；它仍是 `trusted-in-process`。
- 不为插件复制源码或创建只做重复 Loader 注册的包装 bundle。
- 不提供应用内动态下载、安装或更新该官方 bundle；版本变更必须走 profile、catalog 和发行流程。
- 不把用户启用终端视作权限隔离，亦不为其写死特定平台的 shell 路径。

## Decisions

### 1. 精确 npm 包直接作为官方 bundle

官方 profile 顺序为 `@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app`、`dsh-better-sidebar`；`desktop-layer` 继续由 launcher 在 Web bundle 后临时插入。根构建依赖和 profile-local package 都使用 `dsh-better-sidebar: 0.14.0`，并将 DSH package family 全部升级为 `0.1.0-rc.8`。

选择已发布的 `0.14.0` 而非 Git `main` 的原因是 npm tarball 可用完整性锁定，且主分支的 `0.14.1` 尚未发布。选择直接 bundle 而非本仓库 wrapper 的原因是包自身已有 patch；双重选择会重复注册 `/sidebar/api` 和 sidebar entry。

考虑过以 `0.13.1` 保持 rc.7，但这只是开发期兼容路径，会把官方 DSH 升级和第三方维护节奏永久分叉，因此拒绝。也考虑过把第三方代码复制进 workspace，但这会使审计、升级和许可证归属失真。

### 2. catalog 是官方外部 bundle 的准入事实来源

新增 `dsh-better-sidebar` L1 条目，锁定 npm registry、tarball、`sha512` integrity、MIT、维护者、直接依赖和生命周期脚本摘要、能力摘要、验证日期和已验证平台。条目明确 `executionMode: trusted-in-process`、`enforcement: unavailable`，并将文件读写、上传、Git、HTTP/WS、终端和可选模型终端工具列为能力事实。

compiler 将所有非 workspace 且非 DSH 安装闭包提供的 profile bundle 与 catalog 一一匹配，比较包名、精确版本、npm 来源和 lockfile integrity。fixture 继续通过显式 fixture root 绕过正式 catalog，生产 profile 不得绕过。catalog 的 `verifiedOn` 只记录已经实际验证的平台；发布 gate 根据发行版声明目标检查证据，缺少目标时拒绝将其标为可发布，而不是伪造验证记录。

考虑过仅在 README 记录审计，或仅依赖根 `pnpm-lock.yaml`；两者不能表达 profile 组合的准入决定，也不能阻止依赖来源漂移，因此拒绝。

### 3. 编译结果包含可物化的 profile-local 闭包

compiler 使用 DSH 安装锚点判断内置 bundle，其他已选择 bundle 以精确版本写入生成 profile 的 `package.json`。它以 `pnpm install --lockfile-only --offline --ignore-scripts` 生成和冻结 lockfile，并从 profile-local lockfile 读取外部包的实际 tarball integrity 以比对 catalog。resolved manifest、SBOM 和 notices 都从同一解析结果生成。

新增独立的 profile materialization 步骤：在冻结 lockfile 后，在 profile 目录执行离线、冻结安装，仅允许运行经 allowBuilds 授权的构建脚本。此步骤产生可随发行物复制的 `node_modules`，而非在用户启动时下载依赖。受管 profile 更新时，模板中的依赖目录以受限、可追溯的方式物化到 `~/.dsh/profiles/<name>`；依赖摘要覆盖闭包内的全部普通文件、权限位和链接目标，marker 记录该摘要，因此 lockfile、模块源码或闭包链接变化都会触发原子更新与备份。

受管 profile 只接受闭包内相对、安全的 pnpm 链接，复制时保留相对链接文本并拒绝绝对、悬挂或越出闭包的目标，避免构建机 pnpm store 或工作区路径在用户 Home 中成为隐式运行时依赖。package builder 在复制到 Electron 资源目录前单独解引用已验证闭包，确保最终安装包不依赖链接拓扑。生成器、受管 profile 和 package builder 共用同一个 materialized profile，而不是各自再执行一次解析。

考虑过仅在根工作区安装包，并让 profile lockfile 作为记录。这样开发态的 hoist 会掩盖缺依赖，打包或干净用户环境会失败，故拒绝。也考虑过启动时 `pnpm install`，但这会引入网络和生命周期脚本时序，违反静态官方发行物的启动边界。

### 4. Host 按 profile 锚点导入外部 entry，并保留 launcher 边界

Host 继续用上游 `loadProfile()` 的安装锚点优先、profile 锚点次之策略读取 bundle patch。调用 `boot()` 时，裸模块 base URL 改为受管 profile 的 `package.json`：外部 entry 先从该 profile 的 materialized `node_modules` 解析，内置 DSH 包通过 `$DSH_HOME/profiles/node_modules` 的安装闭包 fallback 解析。

launcher 在该 fallback 中只链接其自身注入的 `@dsh-forge/desktop-layer` 及其已验证运行时闭包；它不是 profile bundle，也不改变 profile 的持久选择。链接源必须来自当前受验证桌面 runtime，且包名和内容摘要不匹配时在创建窗口前失败。Host 还会核对当前 profile 的 resolved manifest 与 materialized dependency metadata，拒绝从环境、根工作区或任意用户路径补齐外部 bundle。

考虑过把 `desktop-layer` 写入 profile，或让第三方 bundle 从应用根裸模块解析。前者违反 launcher 所有权，后者重新引入偶然 hoist 依赖；因此拒绝。也不修改上游 loader 的解析优先级，避免 fork DSH boot 语义。

### 5. 原生 addon 在 materialized profile 中为 Electron 重建并进入证据

打包前使用 profile 的 materialized 依赖目录执行与当前 Electron 版本、OS、架构一致的 `electron-rebuild`（或等价受控实现）。脚本在 60 秒内失败即中止，不允许以 Node ABI 的偶然可加载性继续。打包完成后扫描最终应用的 unpacked runtime，收集每个 `.node` 文件和可执行 helper 的相对路径、可执行位与 SHA-256。

`RuntimeManifest` 的当前目标写入实际扫描到的原生文件；类型和检查器要求路径安全、摘要存在且与磁盘一致，并拒绝声明不存在、漏记或摘要不一致的文件。打包 smoke 以 `native-verification.<os>-<arch>.json` 和 `package-smoke.<os>-<arch>.json` 写入带平台、架构、Electron ABI、manifest 摘要和结果的独立 evidence；release gate 汇总 artifact 中的所有目标 evidence，再逐项比对发行版声明目标。macOS ARM64、macOS x64、Windows x64 使用 CI 目标矩阵独立执行；本地只把当前主机结果计入已验证平台。

考虑过继续依赖 `asarUnpack: ['**/*.node']`。它只影响文件位置，不能证明 Electron ABI、文件完整性或目标覆盖，故不足以满足发布要求。

## Risks / Trade-offs

- [第三方拥有文件、网络、Git 与终端能力] → catalog、设计文档和用户可见准入信息明确 `trusted-in-process`；不把设置开关描述成隔离边界。
- [DSH rc.8 的公开接口或 patch 行为变化] → 先更新 runtime matrix 和锁文件，再执行 profile dump、真实 Loader 激活测试与桌面 smoke；失败时停止在升级提交，不混用 rc.7/rc.8。
- [profile module copy 放大安装包并遇到 pnpm 链接] → 仅 materialize 选中外部闭包，复制前验证链接目标和闭包摘要，并复用该闭包作为 package resource。
- [node-pty 缺少当前 Electron 预构建产物] → 离线 materialization 后强制 Electron rebuild；重建失败、manifest 漏项或 smoke 失败均阻断当前目标。
- [跨平台 runner 不可用] → catalog 只记录真实完成的平台；release gate 将缺少的平台作为阻断项，不生成“已验证”的错误结论。
- [第三方版本更新] → 更新必须同时变更精确 profile 版本、catalog 来源/完整性/能力事实、根锁文件和目标平台证据；任何事实变化触发重新审计。

## Migration Plan

1. 升级根 runtime、profile runtime matrix 和相关锁定依赖至 rc.8，先通过现有 profile 和 desktop loader 回归。
2. 增加 catalog 准入与 compiler 的外部 bundle 分类、锁文件完整性比对及 materialization 测试，然后把 `dsh-better-sidebar@0.14.0` 写入官方 profile。
3. 更新受管 profile 的 marker 与原子复制逻辑，使已安装官方 profile 在下一次启动时备份并替换为含受控闭包的版本；无归属目录仍拒绝覆盖。
4. 切换 Host 的裸模块 base URL 并添加 DSH Forge launcher fallback，验证 entry 只激活一次、desktop layer 仍不在持久 profile 中。
5. 加入 Electron rebuild、native manifest 摘要、package inspection 和当前平台 smoke；在三种发布 runner 收集真实 evidence 后才允许发布。

回滚时恢复前一版 root/runtime 锁和 profile 组合，受管 profile 由已有备份目录恢复；不删除用户自定义 profile 或 DSH Home 数据。若外部 entry 失败，Host 在窗口创建前失败并保留 generation 的失败诊断，不降级为从未验证路径加载。
