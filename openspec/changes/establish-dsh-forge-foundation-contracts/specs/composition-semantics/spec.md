## Purpose

定义 DSH Forge 的配置覆盖优先级和 Cordis 激活语义，确保配置合成结果可预测，同时避免把 patch 顺序误当成插件启动顺序。

## ADDED Requirements

### Requirement: Patch 层优先级必须固定
系统 MUST 按 profile bundle 声明顺序应用 bundle patch，再应用 profile patch、DSH home patch和 launcher overlay；后层对同一行的写入 MUST 覆盖前层。

#### Scenario: 用户覆盖发行版默认值
- **WHEN** profile patch 与 product bundle 修改相同 Loader 行
- **THEN** 最终配置使用 profile patch 的完整值

#### Scenario: 机器级覆盖 profile
- **WHEN** DSH home patch 与 profile patch 修改相同 Loader 行
- **THEN** 最终配置使用 DSH home patch 的完整值

### Requirement: Desktop layer 由 launcher 临时注入
launcher MUST 在当前 generation 的 bundle 合成中把 desktop layer 放在 `dsh-web-app` 之后、发行版 product bundle 之前，并 MUST NOT 把该层写回用户 profile 的 bundle 列表。

#### Scenario: 启动普通 Web-capable profile
- **WHEN** launcher 启动直接包含 base 后接 Web bundle 的兼容 profile
- **THEN** 当前 generation 获得 desktop layer，磁盘上的 bundle 列表保持不变

#### Scenario: Profile 已持久包含 desktop layer
- **WHEN** 非 launcher 管理的 profile 把 desktop layer 写入自己的 bundle 列表
- **THEN** launcher 拒绝选择该 profile并报告 desktop layer 由 launcher 拥有

### Requirement: Launcher overlay 必须限制作用域
launcher overlay MUST 只提供本次启动的端口、路径、平台 provider 替换和其他启动事实，并 MUST NOT 静默覆盖模型、工具、权限或用户界面等产品配置。

#### Scenario: 注入随机端口
- **WHEN** launcher 为 Web Host 分配系统端口
- **THEN** overlay 可以向 Web 启动行提供该端口而不修改 profile 源文件

#### Scenario: Overlay 修改产品策略
- **WHEN** launcher overlay 尝试修改不属于启动事实的产品配置
- **THEN** 组合验证失败并指出越界的 Loader 行

### Requirement: Patch 顺序不得定义激活顺序
系统 MUST 将 bundle 顺序解释为配置覆盖顺序；插件激活 MUST 由 Cordis service 依赖和生命周期决定，依赖启动先后的插件 MUST 使用显式 injection。

#### Scenario: Loader 行顺序变化
- **WHEN** 两个互不覆盖的行只改变文本顺序但 service 依赖不变
- **THEN** 系统不得依赖该顺序改变它们的激活结果

#### Scenario: 必需 service 缺失
- **WHEN** 插件声明必需 injection 而 generation 没有对应 provider
- **THEN** 插件保持 pending 或使健康检查失败，不得通过调整 bundle 行顺序规避

### Requirement: 配置转储必须等价于启动配置
`profile:verify` 产生的结构化配置 MUST 使用与真实启动相同的 patch 解析和应用语义，并 MUST 报告未匹配 patch、重复关键 provider 和无法解析的插件。

#### Scenario: 验证通过后启动
- **WHEN** 相同 profile、home patch 和 launcher overlay 先通过配置验证再启动
- **THEN** 启动的 Loader 配置与验证结果在规范化后相同

