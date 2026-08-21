## Purpose

定义 profile 对外部 DSH bundle 的独立依赖闭环与受控解析规则，确保构建、启动、SBOM 和打包不会依赖根工作区的偶然 hoist 状态。

## ADDED Requirements

### Requirement: 外部 bundle 形成 profile-local 依赖闭环
profile compiler SHALL 将每个被选择且不由 DSH 内置提供的 bundle 写入生成 profile 的显式依赖，并在 profile-local lockfile 中锁定其完整解析闭包。编译器 MUST 不把根 `node_modules` 是否存在该包作为运行时正确性的前提。

#### Scenario: 在干净环境解析外部 bundle
- **WHEN** 构建工具在没有根工作区第三方 bundle hoist 的环境中编译 profile
- **THEN** 生成 profile 仍包含该 bundle 的显式依赖并可通过其 profile-local 安装闭包解析

#### Scenario: 外部 bundle 无法被确定性安装
- **WHEN** 选择的外部 bundle 缺少可固定的包来源或 lockfile 不能复现该来源
- **THEN** 编译失败且不生成部分 profile 输出

### Requirement: 外部 bundle 被记录在发行证据中
已解析的外部 bundle 及其闭包 SHALL 同时出现在 resolved manifest、SBOM 和包前验证输入中，且记录的包名、版本、来源与完整性 MUST 与 profile-local lockfile 一致。

#### Scenario: 生成发行证据
- **WHEN** profile 编译成功
- **THEN** resolved manifest 与 SBOM 都能追溯每个外部 bundle 的锁定来源和版本

#### Scenario: 证据与锁文件不一致
- **WHEN** 生成的解析清单或 SBOM 与 profile-local lockfile 对同一外部包记录不同来源、版本或完整性
- **THEN** 验证失败并拒绝进入打包阶段

### Requirement: Host 只从受控锚点解析外部 Cordis entry
桌面 Host SHALL 在 DSH 安装锚点和当前已验证 profile 的依赖锚点中解析 bundle entry，并且 MUST 拒绝超出这两个锚点的裸模块解析。依赖锚点不可用或 entry 不可解析时，Host MUST 在创建窗口前失败。

#### Scenario: 从 profile 依赖启动外部 bundle
- **WHEN** 外部 bundle 仅存在于已验证 profile 的依赖目录
- **THEN** Host 能够解析并激活该 bundle 的 Cordis entry

#### Scenario: entry 只能从未受控路径解析
- **WHEN** bundle entry 不在 DSH 安装锚点或当前 profile 的依赖锚点中
- **THEN** Host 启动失败且不创建 Electron 窗口

