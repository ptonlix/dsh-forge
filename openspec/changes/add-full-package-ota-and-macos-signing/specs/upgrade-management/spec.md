## ADDED Requirements

### Requirement: 设置页必须通过固定 Typert Remote 管理升级

桌面发行包 SHALL 在 DeepSeek Harness 设置中注册独立的“升级管理”页面。页面 MUST 只调用
`upgradeManager/status`、`upgradeManager/check` 与 `upgradeManager/startUpgrade` 三个无参数 Typert
Remote 方法。它不得使用 Electron IPC、renderer Node 能力、任意 HTTP 路由，也不得传递版本、URL、
文件路径、命令或安装包候选。

页面 MUST 显示本地版本与 build、上次检查完成时间、检查/准备状态、可用版本（若有）及 OTA 支持
状态。Windows 与 macOS 可用时显示正常状态；Ubuntu `.deb`、非 Ubuntu、Ubuntu 22.04 以下、非 AppImage
及不可写 `APPIMAGE` MUST 显示“当前安装方式不支持 OTA”，并禁用检查和升级操作。

#### Scenario: 用户从设置页检查更新

- **WHEN** 用户在支持 OTA 的安装方式中点击“检查更新”
- **THEN** 页面调用无参数 `upgradeManager/check` 并展示主进程返回的最新状态，且不下载完整安装包

#### Scenario: 不支持的 Linux 安装方式

- **WHEN** 应用运行于 Ubuntu `.deb`、非 Ubuntu、Ubuntu 22.04 以下、非 AppImage 或不可写 AppImage
- **THEN** 页面明确显示“当前安装方式不支持 OTA”，不会发起版本清单请求、下载或安装器

### Requirement: 升级协调器必须静默调度并在关闭时结算

`apps/desktop` SHALL 创建 generation 所有的 `UpgradeCoordinator`。generation 就绪后，它 MUST 立即
静默检查一次，并在每一次检查结算后 12 小时再安排下一次检查。自动检查发现更新、无更新或失败时
都不得显示升级确认或通知，也不得下载。

手动检查、定时检查与用户开始升级前的重新检查 MUST 合并为同一项 in-flight 检查。协调器必须保存
可投影的版本/build、最近检查完成时间、状态、可用版本、失败 code 和支持状态；不得保存或返回 URL、
暂存文件路径、命令或凭据。generation 释放时 MUST 清理 timer、取消当前检查或下载，且迟到的异步
结果不得修改已释放 generation 的状态。

#### Scenario: 自动检查不打断用户

- **WHEN** generation 已成功就绪且 12 小时调度到期
- **THEN** 协调器静默执行一次检查；即使发现可用更新也只更新设置页可见状态，不显示确认或下载

#### Scenario: 重叠检查合并

- **WHEN** 自动检查仍在执行时，用户点击“检查更新”或“立即升级”
- **THEN** 所有调用等待同一项检查，且只请求一次 `version.json`

#### Scenario: generation 关闭时取消检查

- **WHEN** generation 在 manifest 请求或完整包下载期间释放
- **THEN** 协调器取消对应请求、清理 timer，并且当前或后续 generation 不会收到旧结果

### Requirement: 用户主动升级必须重新检查并保留原生确认

设置页的“立即升级”操作 MUST 仅在主进程重新检查后继续；页面中显示的版本不能作为安装依据。只有
重新检查仍返回可用完整包时，主进程才 MUST 使用现有 Electron 原生确认对话框。用户拒绝、关闭确认或
检查失败时，应用必须继续运行且不下载。用户确认后，既有完整包下载与平台 helper 流程保持不变。

#### Scenario: 旧候选不能直接安装

- **WHEN** 设置页显示旧的可用版本，用户点击“立即升级”，而重新检查结果变为无更新
- **THEN** 应用不显示原生确认、不下载并将页面状态更新为当前版本

#### Scenario: 用户主动确认升级

- **WHEN** 重新检查仍有可用更新，且用户在原生确认对话框中接受
- **THEN** 应用下载完整安装包、准备平台 helper，并且只有 helper 准备成功后才按受控路径退出
