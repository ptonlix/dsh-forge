## Purpose

定义桌面启动器与原生提供方之间的内部边界，以及单实例、loopback 页面、导航和外部链接的安全行为，避免 renderer 获取未授权的桌面能力。

## ADDED Requirements

### Requirement: 原生运行时必须通过内部能力合同提供
桌面启动器 MUST 只经由内部原生运行时能力合同申请应用生命周期、窗口、路径、外链和平台能力；Electron 对象及其原生实现 MUST 不从 desktop-plugin 的公开 exports 暴露。替换宿主时，既有 bundle 和第三方插件的公开 service contract MUST 保持不变。

#### Scenario: 选择替代宿主提供方
- **WHEN** 发行版以另一种受支持的桌面宿主实现启动
- **THEN** 启动器可以满足同一内部能力合同，而无需修改 bundle 或第三方插件对公开 service 的依赖

#### Scenario: 第三方插件请求原生对象
- **WHEN** 第三方插件尝试通过公开模块取得原生窗口、IPC 或运行时路径
- **THEN** 模块解析或兼容性验证失败，因为这些能力不属于公开 contract

### Requirement: 应用必须保持单实例语义
桌面应用 MUST 在启动 Host 前取得单实例锁。第二个启动请求 MUST 将已运行实例切换到可见状态并退出自身，不得再创建 Host、窗口或 profile generation。

#### Scenario: 用户重复启动应用
- **WHEN** 已健康运行的应用收到第二个启动请求
- **THEN** 原有窗口被显示或聚焦，且进程中仍只有一个活动 generation

### Requirement: renderer 只能保留在允许的 loopback authority
主窗口 MUST 使用 Chromium sandbox、context isolation 和禁用 Node integration。主窗口初始 URL 必须是当前 generation 报告并通过 readiness 的 loopback URL；后续导航只有在 scheme、host 和端口均匹配该 authority 时才允许，其他导航 MUST 被取消。

#### Scenario: 页面请求同源导航
- **WHEN** renderer 导航到当前 generation 的同一 loopback authority
- **THEN** 导航保持允许且不授予额外 Node 或原生能力

#### Scenario: 页面请求外部导航
- **WHEN** renderer 或页面脚本请求导航到其他 origin、非 HTTP(S) scheme 或不同端口
- **THEN** 主窗口取消该导航，且不会在应用窗口内加载目标页面

### Requirement: 新窗口和外部链接必须经受控处理
主窗口 MUST 拒绝 renderer 创建新的应用窗口。用户触发的 HTTP、HTTPS 或 mail 链接 MUST 由系统默认处理程序打开；不受支持的 scheme MUST 被拒绝，且不得传递给系统或 renderer。

#### Scenario: 页面打开 HTTPS 链接
- **WHEN** 用户在 renderer 中触发一个 HTTPS 链接
- **THEN** 应用拒绝创建新窗口，并请求系统默认浏览器打开该链接

#### Scenario: 页面打开未知协议
- **WHEN** renderer 请求打开未允许的协议
- **THEN** 应用拒绝请求并保留当前窗口与 generation
