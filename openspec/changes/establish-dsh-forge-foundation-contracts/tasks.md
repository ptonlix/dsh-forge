## 1. 规范与测试夹具

- [x] 1.1 创建 `distribution.yml`、`profile.yml`、bundle manifest、resolved manifest 和 catalog 条目的 schema，并为未知字段、缺失字段和非法标识建立失败夹具。
- [x] 1.2 固定首版 DSH package family、Cordis peer、Electron、pnpm、Node engine、desktop protocol 和支持平台矩阵，记录版本来源与升级验证入口。
- [x] 1.3 创建官方 profile、最小第三方 bundle 和 Git commit 依赖夹具，覆盖 npm、Git monorepo subdirectory、许可证和 `allowBuilds`。
- [x] 1.4 建立测试辅助工具，能够比较规范化 JSON/YAML、输入摘要、resolved manifest 和结构化配置 dump。

## 2. 发行版与 Profile 编译器

- [x] 2.1 实现 `distribution.yml` 解析、规范化和身份投影，校验应用 ID、包作用域、默认 profile、平台、channel 和更新信任根。
- [x] 2.2 实现 `profile.yml` 解析，拒绝顶层可加载 `plugins` 列表，校验 bundle 名称、顺序和 runtime 版本组。
- [x] 2.3 实现 bundle manifest 解析和依赖闭包收集，验证 `dsh.bundle.patch`、peer 一致性、来源完整性、许可证和构建脚本。
- [x] 2.4 实现 profile 产物生成：`package.json`、`dsh.profile.bundles`、`cordis.patch.yml`、`pnpm-workspace.yaml`、`pnpm-lock.yaml`。
- [x] 2.5 实现 `profile:resolve`，在临时目录运行冻结 pnpm 解析，生成 resolved manifest、SBOM 输入和许可证通知输入。
- [x] 2.6 实现 `profile:verify`，检测源文件、锁文件、输入摘要、依赖完整性和工具版本漂移，并验证清理 artifacts 后可重复生成。
- [x] 2.7 为解析器补充浮动 Git、未授权 `allowBuilds`、无 bundle patch、重复 peer、非法 profile 名和锁文件漂移测试。

## 3. 组合器与配置验证

- [x] 3.1 封装上游 DSH 的 patch 解析和应用逻辑，生成与真实启动一致的结构化 `dump-config`，不维护第二套 Loader patch 算法。
- [x] 3.2 实现 bundle、临时 desktop layer、profile patch、home patch 和受限 launcher overlay 的固定优先级。
- [x] 3.3 实现 desktop layer 的注入规则，要求其位于 Web bundle 后、product bundle 前，且禁止写入用户 bundle 列表。
- [x] 3.4 为 launcher overlay 建立字段白名单，只允许端口、路径、平台 provider 和 generation facts，拒绝产品策略覆盖。
- [x] 3.5 实现未匹配 patch、重复 provider、缺失 bundle、必需 injection unresolved 和整行 config 替换的诊断。
- [x] 3.6 增加 dump 与真实 boot 的等价性测试，并证明 entry 激活由 service 依赖而非列表顺序决定。

## 4. Generation 状态与 Electron Launcher

- [x] 4.1 定义并实现版本化 profile 状态文件，包含 `active`、`pending`、`lastKnownGood`、generation ID 和失败事实。
- [x] 4.2 实现私有目录校验、符号链接拒绝、临时文件 `wx` 写入、原子 rename 和损坏状态恢复。
- [x] 4.3 实现 profile select 的持久化前置、同目标并发合并、不同目标拒绝和失败后可重试语义。
- [x] 4.4 实现 generation 启动状态机：preparing、host-ready、renderer-ready、committed、failed 和 manual-recovery。
- [x] 4.5 实现 Host entry settle、HTTP readiness、BrowserWindow sandbox 配置和 renderer boot report 的统一健康判定与 deadline。
- [x] 4.6 实现 last-known-good 提交、一次有界自动恢复、失败诊断、显式重试和恢复失败后的退出入口。
- [x] 4.7 实现窗口隐藏、显式退出、SIGTERM、崩溃记录、完整 Host dispose 和活动子进程有界 teardown。
- [x] 4.8 为状态迁移、并发选择、renderer 超时、旧 generation service、崩溃恢复和信号退出增加生命周期测试。

## 5. Desktop 公共服务

- [x] 5.1 创建 `desktopProfiles` 的版本化类型导出，包含不可变 current 快照、profile 摘要、不可选择诊断和重启式 select。
- [x] 5.2 创建 `desktopPnpm` 的版本化类型导出，使用 Node `Readable`、`exitCode`/`signal` 完成结果和幂等 cancel。
- [x] 5.3 实现 generation-scoped service provider，拒绝空参数、NUL、无效绝对路径、已取消 signal、busy operation 和已关闭 generation。
- [x] 5.4 实现完整 subprocess tree 的取消、dispose 等待和 operation gate，确保 `done` 不早于后代进程退出。
- [x] 5.5 实现 `runPlugin` 的 profile 初始化、相对 source anchoring、bundle reconcile 和普通操作失败诊断。
- [x] 5.6 实现独立的可恢复 `plugin add` operation，固定精确安装参数，创建恢复事务并封存成功 profile 配置与 receipt。
- [x] 5.7 实现安装后下一 generation 的 Loader/renderer 健康验证、配置恢复、receipt 清理和人工恢复状态。
- [x] 5.8 使用 profile-local 真实 package fixture 验证公开 service 注入、普通 DSH fallback、服务过期、busy、取消和部分安装失败。

## 6. 插件信任与来源审计

- [x] 6.1 定义 Host descriptor 和 catalog 的 `trusted-in-process` 执行模式字段及用户可见的非隔离说明。
- [x] 6.2 将 Host support、plugin request、user/policy grant、audit evidence 和 enforcement status 建模为独立字段。
- [x] 6.3 实现 L0/L1/L2 catalog schema，记录精确来源、完整性、许可证、维护者、依赖、脚本、能力、验证平台和时间。
- [x] 6.4 实现 catalog 快照验证，拒绝缺少完整 commit/tarball integrity、许可证或依赖摘要的 L0/L1 条目。
- [x] 6.5 实现启动期静态 catalog 读取和明确用户确认流程，禁止启动期间自动下载或执行 package manager。
- [x] 6.6 增加能力变化、版本变化、过期审核、未授权安装和“元数据不等于安全隔离”的验收测试。

## 7. 运行时闭包与打包

- [x] 7.1 生成 resolved runtime manifest，覆盖 Electron、DSH package family、Cordis peer、pnpm、Node ABI、bundle、native addon 和平台架构。
- [x] 7.2 配置 Electron Builder 的 ASAR 与 `app.asar.unpacked` 资源，并实现入口、package exports、native 文件和 helper 的物理存在性检查。
- [x] 7.3 为每个声明平台实现 native addon 架构、Electron ABI、执行权限和依赖闭包检查，至少覆盖 macOS 与 Windows 目标。
- [x] 7.4 实现许可证通知、SBOM、resolved manifest 和产物摘要的生成与一致性检查。
- [x] 7.5 建立未签名本地/CI smoke 与生产签名产物的明确标记，禁止未签名产物进入生产更新 channel。
- [x] 7.6 增加干净机器或等价隔离环境的安装包启动、profile 启动、renderer boot、退出和诊断导出 smoke。

## 8. 更新与发布门禁

- [x] 8.1 定义 channel 元数据、目标平台/架构、版本、产物摘要和发行版信任根的验证输入。
- [x] 8.2 实现更新下载暂存、签名验证、摘要验证、严格升级/降级策略和用户确认前置检查。
- [x] 8.3 实现更新期间的 generation dispose、平台安装器交接和失败后保留已验证版本的恢复策略。
- [x] 8.4 配置 macOS 签名/公证和 Windows Authenticode 的发布前检查；缺少平台身份时只允许 smoke。
- [x] 8.5 建立 `package:inspect` 和完整发布门禁，串联 profile verify、dump、Loader smoke、真实安装包、更新入口、SBOM、许可证和签名验证。
- [x] 8.6 编写官方 profile 独立构建、Fork 只改 distribution/profile、上游 runtime 升级和产物失败拒绝发布的端到端验收场景。

## 9. 文档与维护契约

- [x] 9.1 更新顶层设计文档，链接到各 capability spec，并删除“同进程插件无法访问 Electron/Node”之类不可实现的安全保证。
- [x] 9.2 为 `desktopProfiles`、`desktopPnpm`、profile schema、distribution schema 和 runtime manifest 编写中文公共参考文档。
- [x] 9.3 为源平面、产物平面、恢复事务和签名更新记录维护边界与失败限制，避免把锁文件或 SBOM 描述为可信证明。
- [x] 9.4 运行 Markdown 链接检查、文档格式检查、`git diff --check`、OpenSpec validate 和变更范围内的最小测试，并记录实际命令结果。
