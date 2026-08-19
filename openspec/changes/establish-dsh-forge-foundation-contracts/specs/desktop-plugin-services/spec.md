## Purpose

定义第三方 Host 插件可以稳定依赖的桌面 profile 与包管理服务，并规定 generation、并发、取消和可恢复安装的可观察行为。

## ADDED Requirements

### Requirement: 只公开受支持的桌面服务
桌面插件包 MUST 通过版本化导出公开 `desktopProfiles` 和 `desktopPnpm` 类型；`desktopRuntime`、Electron 对象、可执行路径、ABI 环境和 launcher bootstrap facts MUST 保持内部接口。

#### Scenario: 第三方插件编译
- **WHEN** 第三方 Host 插件只导入公开 contract 路径
- **THEN** 它可以声明 Cordis injection，而无需导入 Electron 或 launcher 实现

#### Scenario: 使用内部接口
- **WHEN** 第三方插件依赖内部 runtime 或 bootstrap 路径
- **THEN** 兼容性验证拒绝该依赖，且项目不提供稳定性保证

### Requirement: desktopProfiles 必须提供 generation 快照
`desktopProfiles.current` MUST 在 generation 内保持不可变；`list()` MUST 只读返回 profile 身份、存在性、bundle 摘要、Web 兼容性和不可选择原因；`select()` MUST 表示持久化后重启，而不是修改运行中的 Loader tree。

#### Scenario: 列出损坏 profile
- **WHEN** 一个 profile 可发现但 manifest 无效
- **THEN** `list()` 返回带诊断的不可选择项且不修改该 profile

#### Scenario: 并发选择相同目标
- **WHEN** 同一 generation 并发选择相同 profile
- **THEN** 调用共享同一持久化和重启 operation

#### Scenario: 并发选择不同目标
- **WHEN** 已提交一个 pending 目标后又选择不同目标
- **THEN** 后续调用失败且不得覆盖已持久化目标

### Requirement: desktopPnpm 必须暴露类型化进程结果
每个 package operation MUST 返回可读的 stdout、stderr、一个包含 `exitCode` 与 `signal` 的完成结果以及幂等取消方法；完成状态 MUST 等待受管完整进程树退出。

#### Scenario: 命令正常失败
- **WHEN** package-manager 主进程以非零代码正常退出且没有遗留子进程
- **THEN** `done` 以该非零 `exitCode` 和空 signal 完成

#### Scenario: 操作被取消
- **WHEN** 调用方取消操作或 AbortSignal 触发
- **THEN** provider 终止完整进程树，`done` 在进程树退出后报告终止结果

### Requirement: Package operation 必须按 generation 串行化
每个 generation 同时 MUST 最多存在一个 package operation；generation 关闭、参数为空、参数包含 NUL、调用目录无效或 signal 已取消时，服务 MUST 在启动子进程前失败。

#### Scenario: Generation 忙碌
- **WHEN** 一个 package operation 尚未完成时请求第二个 operation
- **THEN** 第二个请求同步失败并且第一个 operation 不受影响

#### Scenario: Generation dispose
- **WHEN** service dispose 时 operation 仍活跃
- **THEN** service 取消并等待该 operation，之后拒绝所有新请求

### Requirement: Plugin add 必须使用可恢复安装操作
普通 `runPlugin()` MUST NOT 接受 `add`；公开安装操作 MUST 在执行固定的精确版本安装参数前创建恢复事务，并 MUST 在报告成功前封存安装后的 profile 配置状态。

#### Scenario: 安装成功并通过重启验证
- **WHEN** bundle 安装成功、profile reconcile 完成且下一 generation 达到健康状态
- **THEN** 系统提交安装 receipt 并清除恢复事务

#### Scenario: 安装产生部分修改后失败
- **WHEN** package manager 失败但已修改受保护的 profile 文件
- **THEN** 系统封存失败状态、恢复安装前镜像并报告非零结果

### Requirement: 安装恢复范围必须明确
恢复事务 MUST 保护 `package.json`、`pnpm-lock.yaml` 和 `pnpm-workspace.yaml`，MUST NOT 声称恢复 `node_modules`；若无法证明 profile 恢复为一致状态，系统 MUST 进入人工修复状态并停止自动启动该目标。

#### Scenario: 启动验证失败
- **WHEN** 新安装后的 generation 未通过 Host 或 renderer 健康检查
- **THEN** 系统恢复受保护文件，记录未恢复的依赖目录风险并回到 last-known-good

