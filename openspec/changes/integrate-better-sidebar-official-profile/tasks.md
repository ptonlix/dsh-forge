## 1. Runtime 与准入

- [x] 1.1 将 DSH runtime matrix、官方 profile、根包和 toolchain 包同步升级到 `0.1.0-rc.8`，并更新锁文件。
- [x] 1.2 将精确的 `dsh-better-sidebar@0.14.0` 加入官方 profile 和受控构建依赖，保持 `desktop-layer` 只由 launcher 临时注入。
- [x] 1.3 新增该 bundle 的 L1 catalog 审计条目，并扩展 catalog/profile 验证以拒绝缺失、版本或完整性漂移的官方外部 bundle。

## 2. Profile 外部闭环

- [x] 2.1 扩展 compiler，区分 DSH 安装闭包与外部 bundle，并将外部 bundle 的精确依赖写入生成 profile。
- [x] 2.2 从 profile-local lockfile 校验外部 npm 来源和完整性，并让 resolved manifest、SBOM 与 notices 使用同一闭包事实。
- [x] 2.3 实现离线、冻结、allowBuilds 受控的 profile materialization，并为外部 bundle、锁文件漂移和未授权构建脚本添加定向测试。
- [x] 2.4 更新受管 profile 的闭包摘要与原子复制逻辑，只复制模板内可安全解引用的依赖目录，并在升级时保留可恢复备份。

## 3. Desktop Loader

- [x] 3.1 让 Host 使用受管 profile 的模块锚点导入外部 Cordis entry，并在依赖锚点缺失或不受信时于窗口创建前失败。
- [x] 3.2 为 launcher 注入的 `desktop-layer` 建立受限的 runtime fallback，且不改变 profile 的 bundle 列表或引入任意路径解析。
- [x] 3.3 增加真实 Loader 覆盖，验证 `better-sidebar` 只激活一次、外部 entry 可从 profile-local 闭包解析，以及 desktop layer 的所有权仍受保护。

## 4. 原生模块交付

- [x] 4.1 在桌面打包前为 materialized profile 执行受限的 Electron ABI 原生模块重建，并在失败或超时时中止当前目标。
- [x] 4.2 扩展 runtime manifest 与包检查，记录并验证最终应用中每个原生文件的安全相对路径、可执行位和 SHA-256，拒绝遗漏、缺失或摘要漂移。
- [x] 4.3 扩展 package smoke 和发布验证，写入当前平台的 native evidence，并将未提供的声明目标保留为发布阻断项。

## 5. 文档与验证

- [x] 5.1 更新发行版设计和官方 profile 文档，说明已发布第三方 bundle 的直接选择、构建时闭环、能力审计和 `trusted-in-process` 边界。
- [x] 5.2 运行定向单元测试、profile resolve/verify、catalog 验证、config dump、当前平台 package inspect 与 smoke；记录无法在本机执行的其他目标验证状态。
- [x] 5.3 修复受管 profile 对 pnpm 相对链接与完整闭包内容的摘要；补充源码漂移和重复安装回归测试。
- [x] 5.4 让 package smoke 和 release gate 按目标保存、汇总 native evidence，并覆盖 Windows `resources` 路径与完整目标矩阵。
- [x] 5.5 补全第三方 bundle 的直接依赖审计，并同步发行设计与验证记录中的跨平台证据边界。
