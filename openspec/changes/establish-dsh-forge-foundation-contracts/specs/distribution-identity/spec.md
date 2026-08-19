## Purpose

定义可 Fork 发行版的唯一身份源、平台声明和更新入口，使源码配置、安装包元数据、运行时显示和发布渠道保持一致并可验证。

## ADDED Requirements

### Requirement: 发行版身份使用版本化源文件
系统 MUST 只从仓库根目录的 `distribution.yml` 读取发行版身份，并 MUST 拒绝未知 schema、缺失必填字段、无效应用标识或无法解析的默认 profile。

#### Scenario: 有效身份配置
- **WHEN** `distribution.yml` 使用受支持的 schema，并提供唯一的发行版 ID、产品名称、包作用域、应用 ID 和默认 profile
- **THEN** 验证器接受配置并生成规范化身份清单

#### Scenario: 未知 schema
- **WHEN** `distribution.yml` 声明构建工具不支持的 schema 版本
- **THEN** 验证器在生成任何安装包输入前失败并报告实际版本和支持范围

### Requirement: 身份值必须一致投影
构建系统 MUST 将规范化身份投影到 Electron 应用、安装器、桌面插件和版本报告，并 MUST 检测与 `distribution.yml` 不一致的硬编码身份。

#### Scenario: 构建官方发行版
- **WHEN** 构建器处理一个通过验证的发行版
- **THEN** 应用名称、应用 ID、默认 profile、包作用域和更新 channel 与规范化身份清单一致

#### Scenario: Fork 修改身份
- **WHEN** Fork 只修改 `distribution.yml` 和品牌资源
- **THEN** 新安装包具有独立应用身份，且公共桌面框架中不残留官方发行版身份

### Requirement: 平台和更新入口必须显式声明
发行版 MUST 显式声明支持的操作系统与架构；启用更新时还 MUST 声明 channel、元数据地址和信任根标识，缺少任何一项时 MUST 禁止生产发布。

#### Scenario: 未配置更新的开发构建
- **WHEN** 发行版明确关闭更新并创建本地开发产物
- **THEN** 构建可以继续，但产物报告更新能力未启用

#### Scenario: 更新配置不完整
- **WHEN** 生产发行版启用更新但缺少元数据地址或信任根标识
- **THEN** 发布验证失败，且产物不能被标记为可发布

