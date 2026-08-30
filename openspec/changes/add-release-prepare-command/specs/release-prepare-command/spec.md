## Purpose

定义发布准备命令对发行版本和 `dshForgeBuild` 的校验、更新与失败保护行为。

## ADDED Requirements

### Requirement: 发布准备命令必须严格校验版本输入

`pnpm run release:prepare -- <version>` SHALL 接受且仅接受一个精确 SemVer 参数；参数不得带
`v` 前缀、range、tag 或其他别名。命令 MUST 读取当前 `distribution.yml` 版本和根
`package.json` 的 `version` 与 `dshForgeBuild`，并拒绝无效配置或两个版本源不一致。

#### Scenario: 版本参数有效

- **WHEN** 维护者传入 `0.2.0` 或包含合法预发布/构建元数据的精确 SemVer
- **THEN** 命令继续比较目标版本并准备更新

#### Scenario: 版本参数无效

- **WHEN** 参数缺失、超过一个、带 `v` 前缀、不是精确 SemVer，或目标版本低于当前版本
- **THEN** 命令失败，说明用法或版本原因，且不修改 `distribution.yml` 和 `package.json`

### Requirement: 新版本和同版本重发必须使用明确的 build 规则

当目标版本高于当前版本时，命令 SHALL 将 `distribution.yml` 和根 `package.json` 的 `version` 更新为目标版本，
并将根 `package.json` 的 `dshForgeBuild` 设置为 `1`。当目标版本等于当前版本时，命令 SHALL 保持版本并将
`dshForgeBuild` 递增 `1`；溢出正安全整数范围时 MUST 失败且不写入文件。

#### Scenario: 准备新版本

- **WHEN** 当前版本为 `0.1.0`、build 为 `1`，目标为 `0.2.0`
- **THEN** `distribution.yml` 和根 `package.json` 的 `version` 变为 `0.2.0`，根 `package.json` 的 build 变为 `1`

#### Scenario: 准备同版本重发

- **WHEN** 当前版本为 `0.2.0`、build 为 `1`，目标为 `0.2.0`
- **THEN** 两个版本源保持 `0.2.0`，根 `package.json` 的 build 变为 `2`

### Requirement: 发布准备必须保留源文件格式并提供失败保护

命令 SHALL 只更新 `distribution.yml` 的顶层 `version`、根 `package.json` 的 `version` 和
`dshForgeBuild` 字段，不得重排或重新格式化其他内容。所有输入校验 MUST 在写入前完成；任一
校验或写入失败时，命令 MUST 返回非零退出码并尽可能恢复已写入文件。

#### Scenario: 所有校验通过

- **WHEN** 目标版本和当前 build 均有效，且目标不低于当前版本
- **THEN** 命令更新两个源字段，输出前后版本/build，并提示创建 `v<version>` annotated tag

#### Scenario: 根配置无效

- **WHEN** `distribution.yml` 缺少唯一顶层版本，或 `dshForgeBuild` 缺失、非正安全整数
- **THEN** 命令失败且不修改任一源文件

#### Scenario: 版本源不一致

- **WHEN** `distribution.yml.version` 与根 `package.json.version` 不同
- **THEN** 命令失败且不修改任一源文件
