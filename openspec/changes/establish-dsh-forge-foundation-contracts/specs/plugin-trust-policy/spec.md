## Purpose

定义第三方插件在 DSH Forge 中的信任、来源、兼容性和用户确认语义，避免把元数据审查或 Electron renderer sandbox 错误描述为 Node 插件隔离。

## ADDED Requirements

### Requirement: 首版插件执行模式必须标记为可信同进程
Host descriptor、catalog 和安装确认 MUST 将 Node 插件执行模式标记为 `trusted-in-process`，并 MUST 明确该模式不能阻止插件直接使用 Node 能力或尝试加载 Electron。

#### Scenario: 展示插件安装确认
- **WHEN** 用户准备启用一个第三方 Node 插件
- **THEN** 界面说明该插件与 Host 同进程运行，权限提示不是技术沙箱

#### Scenario: 插件未申请某项 Host service
- **WHEN** 同进程插件没有声明某项桌面 service
- **THEN** 系统可以拒绝通过公共 contract 授予该 service，但不得宣称已经阻止插件绕过 contract 访问进程能力

### Requirement: 兼容性、授权、审计和执行必须分开记录
系统 MUST 分别记录 Host 支持、插件请求、用户或发行策略授权、审计结果和技术 enforcement 状态；缺少技术隔离时 enforcement MUST 标记为未提供。

#### Scenario: 兼容但未授权
- **WHEN** Host 支持插件请求的能力但用户尚未确认
- **THEN** 插件状态为等待授权，不得显示为已启用

#### Scenario: 已授权但无隔离
- **WHEN** 用户授权 trusted-in-process 插件
- **THEN** 系统记录授权和审计事实，同时保持 enforcement 为未隔离

### Requirement: Catalog 必须保存可审计来源事实
每个 L0 或 L1 条目 MUST 记录包名、精确版本或完整 commit、来源、完整性、许可证、维护者、依赖、构建脚本、Host 能力、模型可见工具、验证平台、验证时间和执行信任模式。

#### Scenario: Catalog 条目缺少来源完整性
- **WHEN** L0 或 L1 插件没有可验证 tarball 完整性或完整 commit
- **THEN** 发布验证拒绝将其纳入对应层级

#### Scenario: 审核事实过期
- **WHEN** 插件版本、依赖闭包或请求能力变化
- **THEN** 旧验证结果不得自动沿用到新组合

### Requirement: 分层不得声称代码安全
L0 MUST 仅表示随包交付并默认启用且通过指定检查，L1 MUST 仅表示可发现并经过兼容性验证，L2 MUST 仅提供来源信息；任何层级 MUST NOT 被描述为恶意代码安全认证。

#### Scenario: L1 插件被发现
- **WHEN** 用户查看兼容的 L1 插件
- **THEN** 系统展示验证范围、时间和信任模式，但默认不安装或启用

### Requirement: 安装必须由明确操作触发
应用 MUST NOT 在启动时动态下载或安装 catalog 内容；安装前 MUST 展示名称、来源、精确版本、许可证、请求能力、执行信任模式、构建脚本和将修改的 profile。

#### Scenario: 普通应用启动
- **WHEN** catalog 包含可用更新或新插件
- **THEN** 应用可以展示静态信息，但不得自动执行 package manager

#### Scenario: 用户确认安装
- **WHEN** 用户确认所有安装事实
- **THEN** 系统才可以创建可恢复安装事务

