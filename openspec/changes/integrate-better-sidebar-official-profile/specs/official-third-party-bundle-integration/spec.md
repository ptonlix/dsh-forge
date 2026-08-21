## Purpose

定义官方发行版对经审计第三方 DSH bundle 的静态准入和默认加载契约，使构建产物可以复现其来源、版本、能力边界与信任模型。

## ADDED Requirements

### Requirement: 官方 profile 选择精确审计的第三方 bundle
官方 `dsh-forge-official` profile SHALL 选择 `dsh-better-sidebar@0.14.0`，并且其 DSH runtime SHALL 与该版本的 peer 依赖兼容。profile 不得以 `latest`、范围版本、分支、tag 或未发布 Git 提交替代该选择。

#### Scenario: 编译官方 profile
- **WHEN** 构建工具解析 `dsh-forge-official` profile
- **THEN** 解析结果包含精确版本 `dsh-better-sidebar@0.14.0` 和兼容的 DSH runtime

#### Scenario: 选择不兼容的 DSH runtime
- **WHEN** profile 的 DSH runtime 不满足已选择第三方 bundle 的 peer 依赖
- **THEN** 解析在生成安装或打包输入前失败并报告不兼容的包与版本

### Requirement: 官方第三方 bundle 必须具有完整静态审计记录
每个被官方 profile 选择的非 workspace 第三方 bundle SHALL 具有静态 catalog 条目，且该条目 MUST 记录精确来源、完整性、许可证、维护者、依赖及安装脚本摘要、能力摘要、验证平台和验证日期。条目 MUST 声明 `trusted-in-process` 与 `enforcement: unavailable`。

#### Scenario: 缺少审计记录
- **WHEN** 官方 profile 选择的第三方 bundle 没有匹配的 catalog 条目或审计字段不完整
- **THEN** profile 验证失败且不会产生可打包运行时

#### Scenario: 审计记录来源漂移
- **WHEN** 已解析第三方 bundle 的包名、精确版本或完整性与 catalog 记录不一致
- **THEN** profile 验证失败并指出发生漂移的审计字段

### Requirement: 官方 profile 只加载第三方 bundle 的唯一 patch
当第三方包自身声明有效的 `dsh.bundle.patch` 时，官方 profile SHALL 直接选择该包，且 MUST 不额外选择只用于重新挂载同一插件的空包装 bundle。启动后的 Loader tree SHALL 仅出现一次该插件的注册 entry。

#### Scenario: 启动官方 Host
- **WHEN** 桌面应用使用官方 profile 启动 Host
- **THEN** `better-sidebar` entry 仅激活一次且不产生重复 sidebar 或重复路由注册

