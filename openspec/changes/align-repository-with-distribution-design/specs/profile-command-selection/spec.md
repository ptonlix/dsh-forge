## Purpose

定义 profile 相关命令如何选择、验证和隔离发行版配置，使官方 profile 与 Fork profile 都能用同一命令稳定解析、验证、打包和检查。

## ADDED Requirements

### Requirement: profile 命令必须显式接受选择参数
解析、验证、配置转储、打包、产物检查、冒烟和发布门禁等 profile 范围命令 MUST 接受可选的 profile 名称。未提供名称时，命令 MUST 使用 `distribution.yml` 声明的默认 profile；提供名称时，命令 MUST 只处理该名称对应的 profile。

#### Scenario: 使用默认 profile
- **WHEN** 开发者未传递 profile 参数执行 profile 范围命令
- **THEN** 命令使用发行版默认 profile，并在结构化结果中报告实际选择的 profile

#### Scenario: 使用 Fork profile
- **WHEN** 开发者传递一个已存在且可验证的 Fork profile 名称
- **THEN** 命令仅解析、验证或打包该 profile，且不修改官方 profile 的源文件或产物

### Requirement: 显式 profile 选择必须严格验证
显式传入的 profile 名称 MUST 通过 profile schema 和目录存在性验证。名称不存在、非法、不可选择或与发行版 runtime 不兼容时，命令 MUST 失败；不得忽略参数、静默回退默认 profile 或改用最近一次产物。

#### Scenario: 传递不存在的 profile
- **WHEN** 开发者执行命令并指定不存在的 profile
- **THEN** 命令以非零结果结束，并输出该 profile 无法选择的固定诊断

#### Scenario: 传递无效 profile
- **WHEN** profile 配置未通过 schema 或 runtime 兼容性验证
- **THEN** 命令停止于解析或验证阶段，且不会写入或替换其他 profile 的产物

### Requirement: profile 产物必须按发行版和 profile 隔离
解析、打包、检查和发布门禁 MUST 从所选 profile 的 resolved manifest 和产物目录读取事实。不同 profile 的锁文件、输入摘要、运行时清单、SBOM、诊断和安装包输入 MUST 不互相覆盖或被隐式复用。

#### Scenario: 连续构建两个 profile
- **WHEN** 开发者先后解析或打包官方 profile 与 Fork profile
- **THEN** 两者均保留各自可验证的输入摘要和产物路径，后一次操作不改变前一次 profile 的已解析事实

### Requirement: 命令帮助和包脚本必须反映选择语义
CLI 帮助、`package.json` 脚本和用户文档 MUST 展示 profile 参数的传递方式、默认规则与失败行为。脚本包装器 MUST 将调用方提供的 profile 参数完整传给命令实现。

#### Scenario: 从包脚本传递参数
- **WHEN** 开发者执行带 profile 参数的 package script
- **THEN** CLI 收到同一 profile 名称，并在结果中报告该名称而非默认 profile
