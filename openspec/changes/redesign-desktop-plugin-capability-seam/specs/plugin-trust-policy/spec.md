## MODIFIED Requirements

### Requirement: Catalog 必须保存可审计来源事实
每个 L0 或 L1 条目 MUST 记录包名、精确 SemVer 或完整 commit、可解析来源、完整性、许可证、维护者、依赖、构建脚本、Host 能力、模型可见工具、验证平台、验证时间和执行信任模式。来源事实 MUST 足以构造安装解析请求，并可与安装后的锁定解析结果逐项比较。

#### Scenario: Catalog 条目缺少来源完整性
- **WHEN** L0 或 L1 插件没有可验证 tarball 完整性或完整 commit
- **THEN** 发布验证拒绝将其纳入对应层级

#### Scenario: 审核事实过期
- **WHEN** 插件版本、来源、完整性、依赖闭包或请求能力变化
- **THEN** 旧验证结果不得自动沿用到新组合

#### Scenario: 安装解析来源漂移
- **WHEN** package manager 的实际解析结果与 catalog 的来源或完整性事实不匹配
- **THEN** 安装事务失败且不得生成成功 receipt

### Requirement: 安装必须由明确操作触发
应用 MUST NOT 在启动时动态下载或安装 catalog 内容；安装前 MUST 展示名称、来源、精确版本、完整性、许可证、请求能力、执行信任模式、构建脚本和将修改的 profile。明确确认 MUST 产生与 catalog 条目及目标 profile 绑定的安装请求，provider 只接受该请求。

#### Scenario: 普通应用启动
- **WHEN** catalog 包含可用更新或新插件
- **THEN** 应用可以展示静态信息，但不得自动执行 package manager

#### Scenario: 用户确认安装
- **WHEN** 用户确认所有安装事实
- **THEN** 系统才可以创建绑定该 catalog 条目和 profile 的可恢复安装事务

#### Scenario: 伪造来源标签
- **WHEN** 调用方提交未由确认流程派生的来源、版本或完整性字段
- **THEN** provider 在启动 package manager 前拒绝该请求
