## Purpose

定义桌面 capability 的公开消费接口与本地实现边界，使 Fork 和 Host 插件可以依赖稳定服务，而不需要了解 Electron、launcher 或 profile 管理实现。

## ADDED Requirements

### Requirement: 桌面 capability 必须分离公开定义与本地 provider
系统 MUST 提供一个 ESM 公开服务定义包，供第三方导入 `desktopProfiles`、`desktopPnpm`、`desktopServices` 的精确类型、协议常量和 Cordis `Context` 声明。桌面 layer 加载的本地 provider 与 launcher 组装 API MUST 是私有 workspace 接口，且不得构成第三方稳定入口。

#### Scenario: 第三方插件消费桌面服务
- **WHEN** 第三方 Host 插件只安装公开服务定义包并声明所需 Cordis service
- **THEN** TypeScript 可以解析全部公开类型，运行时无需解析 Electron、launcher 或本地 provider 包

#### Scenario: Fork 导入私有实现
- **WHEN** Fork 或第三方插件导入本地 provider、launcher factory 或历史 desktop-plugin 路径
- **THEN** package exports 或兼容性门禁拒绝该导入，并指出它不是受支持接口

### Requirement: desktop layer 必须是本地 provider 的唯一 bundle 所有者
`desktop-layer` 的 package manifest MUST 直接依赖本地 provider，且其 `cordis.patch.yml` MUST 是注册桌面 provider 的唯一 bundle patch。应用根 package 可以为 launcher 导入和发行物打包直接依赖本地 provider，但这不得使其他 bundle 获得 provider 所有权。

#### Scenario: 启用 desktop layer
- **WHEN** launcher 为一个 desktop generation 临时注入 desktop layer
- **THEN** desktop layer 的 patch 注册本地 provider，并在该 generation 发布公开桌面服务

#### Scenario: 仅加载持久 profile
- **WHEN** profile 未经 launcher 注入而被加载
- **THEN** 它不包含 desktop layer 或本地 provider，且不会发布桌面服务

#### Scenario: 检查 bundle 所有权
- **WHEN** 依赖边界或 composition 测试检查 bundle manifest 与 patch
- **THEN** 它确认只有 desktop layer 声明本地 provider 依赖和 provider patch，且拒绝违反该边界的变更

### Requirement: 默认 profile 必须只选择实际生效的产品层
官方与开发 profile MUST 显式按顺序选择 `@deepseek-ai/dsh-base` 与 `@deepseek-ai/dsh-web-app`，以确定 DSH 运行基线。launcher MUST 在 Web bundle 后临时注入 desktop layer，且不得将它写回 profile。没有实际 patch、产品默认值或发行策略的 bundle MUST NOT 被默认 profile 选择；产品策略 bundle 只有在同一变更中声明实际覆盖及其偏离理由时才可以加入。

#### Scenario: 编译官方 profile
- **WHEN** 编译 dsh-forge-official profile
- **THEN** 持久 bundle 顺序只包含 `dsh-base` 和 `dsh-web-app`，运行时 composition 在二者之后插入 desktop layer

#### Scenario: 引入产品策略 bundle
- **WHEN** 发行版需要在上游基线外应用产品默认值或策略
- **THEN** 变更同时提供非空 patch、完整覆盖值、偏离理由和对应验证，再将该 bundle 加入 profile

### Requirement: Cordis 必须发布版本化桌面服务描述
当桌面 layer 激活时，系统 MUST 在同一 Cordis generation 发布 profile 服务、package 服务和只读服务描述。服务描述 MUST 包含协议主版本与 `trusted-in-process` 执行模式；公开帮助函数 MUST 在协议主版本不兼容时产生确定性失败。

#### Scenario: 兼容的桌面 provider 激活
- **WHEN** launcher 注入受支持协议的私有桌面 capability 且 desktop layer 成功加载
- **THEN** 依赖桌面服务的 Cordis 插件可以读取三个已声明服务

#### Scenario: 协议主版本不兼容
- **WHEN** 消费者要求的协议主版本与已发布描述不一致
- **THEN** 它在执行桌面操作前以稳定诊断失败，不得猜测或降级到未声明接口

### Requirement: 包导出和文档必须描述同一公共接口
公开服务定义包及本地 provider 包 MUST 使用 ESM，并且 package exports 的类型入口 MUST 指向构建生成的 declarations。每个包 MUST 提供中文 README，分别说明消费者可依赖的服务、provider 的所有权与限制、配置/注入前提、失败语义和验证命令；README 中的公开 TypeScript 示例 MUST 通过类型检查。

#### Scenario: 构建后的外部 TypeScript 消费者
- **WHEN** 干净的 NodeNext TypeScript 夹具导入公开服务定义包
- **THEN** 夹具解析构建产物中的声明，且获得与运行时 exports 一致的类型

#### Scenario: 文档中的公开示例
- **WHEN** 文档检查处理桌面服务包 README 的 TypeScript 示例
- **THEN** 每个示例可解析其声明的公开包路径，且不引用私有模块
