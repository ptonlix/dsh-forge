## Purpose

定义单个 Electron 进程内 Host 与 renderer generation 的启动、健康提交、重启、崩溃记录和 last-known-good 恢复行为。

## ADDED Requirements

### Requirement: 每次启动必须具有独立 generation 身份
launcher MUST 为每次 Host 启动创建不可复用的 generation ID，并 MUST 在 Loader 挂载前固定 profile、运行模式、运行时路径和恢复上下文。

#### Scenario: Profile 切换
- **WHEN** 用户选择另一个 profile
- **THEN** launcher 先持久化 pending 目标、完整 dispose 当前 generation，再以新 generation ID 启动目标 profile

#### Scenario: 旧 service 被保留
- **WHEN** 调用方在 generation dispose 后使用旧的 desktop service 引用
- **THEN** 调用明确失败且不会影响新 generation

### Requirement: Profile 选择状态必须原子持久化
launcher MUST 在 Electron 私有数据目录保存版本化的 `active`、`pending`、`lastKnownGood` 和最近失败事实，写入 MUST 原子完成并拒绝符号链接或非私有目标。

#### Scenario: 切换请求持久化失败
- **WHEN** pending 目标无法安全写入状态文件
- **THEN** 当前 generation 继续运行，且不得发起重启

#### Scenario: 状态文件损坏
- **WHEN** 启动时状态文件无法解析或版本不受支持
- **THEN** launcher 记录恢复诊断并选择可验证的默认或 last-known-good profile

### Requirement: 健康提交必须覆盖 Host 和 renderer
generation MUST 只有在 Loader 全部结算、所有必需 entry 激活、loopback URL 完成 readiness、沙箱化窗口挂载且 renderer 在 deadline 内报告成功后，才能提交为 last-known-good。

#### Scenario: 完整启动成功
- **WHEN** Host、Web carrier、窗口和 renderer 均在 deadline 内成功
- **THEN** launcher 原子提交 last-known-good，清除对应 pending 状态并开放交互命令

#### Scenario: Renderer 报告插件失败
- **WHEN** HTTP readiness 成功但 renderer 最终报告客户端插件加载失败
- **THEN** generation 不得提交为 last-known-good，并进入失败恢复

### Requirement: 失败恢复必须有界且可重试
pending generation 失败时，launcher MUST 保存目标和失败阶段，MUST 回到可验证的 last-known-good，MUST NOT 无限自动重启；用户 MUST 能对同一目标显式重试。

#### Scenario: Pending generation 首次失败
- **WHEN** 目标 profile 在健康提交前失败
- **THEN** launcher 保存失败事实并最多自动恢复到 last-known-good 一次

#### Scenario: Last-known-good 也失败
- **WHEN** 恢复 generation 仍无法达到健康状态
- **THEN** launcher 停止自动重启并提供诊断、配置修复、重试和退出入口

### Requirement: 关闭、退出和重启必须有不同语义
普通窗口关闭 MUST 只隐藏窗口；显式退出、系统信号、失败恢复和 profile 切换 MUST 等待 Host effects、活动子进程和持久化服务完成有界 teardown 后再退出或 relaunch。

#### Scenario: 用户关闭窗口
- **WHEN** 用户关闭主窗口且没有显式退出请求
- **THEN** Host generation 保持运行并可从托盘重新显示

#### Scenario: 子进程在退出时仍活跃
- **WHEN** generation dispose 时存在受管 package operation
- **THEN** launcher 请求终止完整进程树并等待有界完成后再提交退出

### Requirement: 非正常退出必须留下本地恢复证据
launcher MUST 在启动时创建活动运行记录，在健康退出时清除或完成该记录，并 MUST 在下次启动识别未完成记录；诊断内容 MUST 避免自动上传和明文保存已识别凭据。

#### Scenario: Electron 进程崩溃
- **WHEN** 上一次进程未完成健康退出记录
- **THEN** 下次启动将其标记为非正常退出并纳入恢复决策和本地诊断导出
