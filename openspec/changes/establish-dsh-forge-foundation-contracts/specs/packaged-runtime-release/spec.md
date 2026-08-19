## Purpose

定义发行包必须封装和验证的运行时闭包、原生平台依赖、供应链证据与签名更新行为，使可发布状态建立在真实产物而非源码测试之上。

## ADDED Requirements

### Requirement: 发行包必须封装精确运行时闭包
每个安装包 MUST 包含固定版本的 Electron、DSH package family、Cordis peer、pnpm、已解析 bundle 和运行依赖，并 MUST 生成包含精确版本、来源和完整性的 resolved runtime manifest。

#### Scenario: 干净机器启动
- **WHEN** 用户在没有系统 Node.js 或 pnpm 的受支持机器安装发行包
- **THEN** 应用可以启动 Host、打开 Web renderer 并执行受管 profile 操作

#### Scenario: 运行时依赖缺失
- **WHEN** 打包后的依赖闭包缺少 Loader 可解析的必需包
- **THEN** package inspection 失败且产物不得发布

### Requirement: 原生文件必须按平台和 ABI 验证
构建系统 MUST 为每个声明平台验证 native addon、辅助可执行文件、CPU 架构、执行权限、Electron ABI 和物理文件位置；需要真实文件系统路径的内容 MUST 位于可执行的 unpacked runtime 中。

#### Scenario: macOS universal 产物
- **WHEN** 发行版声明 macOS arm64 与 x64
- **THEN** 验证器确认每个必需 native 文件包含相应架构且辅助程序保留执行权限

#### Scenario: Windows 原生依赖不完整
- **WHEN** Windows 安装包缺少必需 DLL、Node addon 或辅助程序
- **THEN** 平台 package inspection 失败

### Requirement: 生产产物必须具有平台身份
生产 macOS 产物 MUST 通过签名和公证验证，生产 Windows 产物 MUST 通过 Authenticode 发布者验证；未签名产物只能标记为本地或 CI smoke，MUST NOT 进入生产更新 channel。

#### Scenario: 未签名 smoke 产物
- **WHEN** CI 构建未签名安装包用于结构验证
- **THEN** 验证报告明确标记非生产，发布命令拒绝上传到生产 channel

### Requirement: 更新必须验证来源并防止降级
更新器 MUST 验证 channel 元数据签名、目标版本、平台、架构、产物摘要和发行版信任根，MUST 拒绝无效签名、错误身份、摘要不符和未授权降级。

#### Scenario: 合法升级
- **WHEN** 元数据和产物均由当前信任根验证，且版本严格高于已安装版本
- **THEN** 应用可以在用户确认后下载并交给平台安装器

#### Scenario: 摘要不匹配
- **WHEN** 下载内容的摘要与已验证元数据不同
- **THEN** 更新器删除或隔离下载内容并拒绝执行安装器

### Requirement: 更新不得修改运行中的 generation
更新器 MUST 在独立暂存位置完成下载和验证，并 MUST 通过完整退出和平台安装器切换版本；它 MUST NOT 替换当前 generation 已加载的 Node 或 native 文件。

#### Scenario: 更新下载完成
- **WHEN** 用户同意应用已验证更新
- **THEN** 当前 Host 先有界 dispose，再由平台安装流程替换应用

### Requirement: 发布必须验证真实产物
每个平台发布 MUST 运行安装包结构检查、真实 profile 启动、Host 与 renderer 健康检查、退出、更新入口和恢复冒烟，并 MUST 生成 SBOM、许可证通知和验证报告。

#### Scenario: 源码测试通过但安装包启动失败
- **WHEN** 单元测试和 Loader smoke 通过，而真实安装包无法达到健康状态
- **THEN** 发布门禁失败，产物不得被标记为可发布

