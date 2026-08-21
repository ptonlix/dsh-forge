## MODIFIED Requirements

### Requirement: 只公开受支持的桌面服务
系统 MUST 通过版本化的公开服务定义包导出 `desktopProfiles`、`desktopPnpm` 和 `desktopServices` 的精确类型、协议常量与 Cordis `Context` 声明。公开 contract MUST NOT 暴露 Electron 对象、可执行路径、ABI 环境、launcher bootstrap facts、本地 provider、恢复文件实现或任意参数对象。

#### Scenario: 第三方插件编译
- **WHEN** 第三方 Host 插件只导入公开服务定义包并声明 Cordis injection
- **THEN** 它可以编译和消费桌面服务，而无需导入 Electron、launcher 或本地 provider 实现

#### Scenario: 使用内部接口
- **WHEN** 第三方插件依赖私有 provider、launcher bootstrap 或已移除的 desktop-plugin 路径
- **THEN** 兼容性验证拒绝该依赖，且项目不提供稳定性保证

### Requirement: desktopProfiles 必须提供 generation 快照
`desktopProfiles` MUST 提供 generation 内不可变的当前 profile 事实；`snapshot()` MUST 返回深度不可变快照，`list()` MUST 返回 profile 身份、存在性、bundle 摘要、Web 兼容性和不可选择原因，`select()` MUST 表示持久化后重启而不是修改运行中的 Loader tree。generation dispose 后的服务方法 MUST 以稳定错误失败，且不得影响新 generation。

#### Scenario: 列出损坏 profile
- **WHEN** 一个 profile 可发现但 manifest 无效
- **THEN** `list()` 返回带诊断的不可选择项且不修改该 profile

#### Scenario: 并发选择相同目标
- **WHEN** 同一 generation 并发选择相同 profile
- **THEN** 调用共享同一持久化和重启 operation

#### Scenario: 并发选择不同目标
- **WHEN** 已提交一个 pending 目标后又选择不同目标
- **THEN** 后续调用失败且不得覆盖已持久化目标

#### Scenario: 使用过期服务
- **WHEN** 已被 dispose 的 generation 调用 profile 服务方法
- **THEN** 调用以 generation 已关闭的稳定错误失败，且不会读取或修改 profile 状态

### Requirement: desktopPnpm 必须暴露类型化的完整操作结果
每个 package operation MUST 返回可读的 `stdout`、`stderr`、包含 `exitCode`、`signal` 和 `cancelled` 的完成结果，以及幂等取消方法。公开命令和安装请求 MUST 使用精确的判别联合与明确选项类型，不得以 `object` 或任意 pnpm 参数数组代替 contract。`done` MUST 等待受管完整进程树和该 operation 所有的 reconcile、安装验证、receipt 或恢复步骤完成。

#### Scenario: 命令正常失败
- **WHEN** package-manager 主进程以非零代码正常退出且没有遗留子进程
- **THEN** `done` 在完成该命令必要的清理后以该非零 `exitCode` 和空 signal 完成

#### Scenario: 操作被取消
- **WHEN** 调用方取消操作或 AbortSignal 触发
- **THEN** provider 终止完整进程树，完成必要恢复后由 `done` 报告终止结果

#### Scenario: 安装后验证失败
- **WHEN** package-manager 成功退出但 reconcile、下一 generation 健康检查或 receipt 提交失败
- **THEN** `done` 不得在恢复完成前结算，系统记录人工恢复事实并拒绝将安装报告为成功

### Requirement: Package operation 必须按 generation 串行化
每个 generation 同时 MUST 最多存在一个尚未完成的 package operation；operation 的占用期 MUST 覆盖子进程执行、reconcile、安装后验证、receipt 提交或恢复完成。generation 关闭、参数无效、调用目录无效或 signal 已取消时，服务 MUST 在启动子进程前失败。

#### Scenario: Generation 忙碌
- **WHEN** 一个 package operation 的 `done` 尚未结算时请求第二个 operation
- **THEN** 第二个请求同步失败并且第一个 operation 不受影响

#### Scenario: 子进程已退出但安装未提交
- **WHEN** 安装子进程已退出而 reconcile 或健康检查仍在运行
- **THEN** 后续 package operation 仍被拒绝，直到安装 receipt 提交或恢复完成

#### Scenario: Generation dispose
- **WHEN** service dispose 时 operation 仍活跃
- **THEN** service 取消并等待该 operation 的完整结算，之后拒绝所有新请求

### Requirement: 插件安装必须使用已确认的可恢复操作
公开安装操作 MUST 只接受由已验证静态 catalog 和明确用户确认派生的安装请求。请求 MUST 包含精确 SemVer 版本（允许 prerelease，禁止范围）、来源标识和完整性事实；provider MUST 将该来源用于解析并在提交 receipt 前校验解析结果。普通命令不得绕过此操作修改插件依赖或锁文件。

#### Scenario: 安装官方预发布包
- **WHEN** 已确认 catalog 条目指定精确的 `0.1.0-rc.7` 版本
- **THEN** 安装操作接受该请求，并仍拒绝版本范围或浮动标签

#### Scenario: 安装成功并通过重启验证
- **WHEN** 已确认的 bundle 安装成功、profile reconcile 完成且下一 generation 达到健康状态
- **THEN** 系统提交包含 catalog 身份、来源、完整性和已解析结果的 receipt，并清除恢复事务

#### Scenario: 来源或完整性不匹配
- **WHEN** package-manager 解析的来源、commit、tarball 完整性或版本与已确认 catalog 条目不一致
- **THEN** 系统恢复受保护文件、记录失败事实并拒绝安装结果

#### Scenario: 安装产生部分修改后失败
- **WHEN** package manager 失败但已修改受保护的 profile 文件
- **THEN** 系统封存失败状态、恢复安装前镜像并报告非零结果
