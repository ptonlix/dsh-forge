## MODIFIED Requirements

### Requirement: 官方 profile 选择精确审计的第三方 bundle

官方 `dsh-forge-official` profile SHALL 选择 `dsh-better-sidebar@0.14.0` 和
`dsh-dream-skin@8.28.0`。profile 不得以 `latest`、范围版本、分支、tag 或未发布 Git
提交替代任一选择。

#### Scenario: 编译官方 profile

- **WHEN** 构建工具解析 `dsh-forge-official` profile
- **THEN** 解析结果包含精确版本 `dsh-better-sidebar@0.14.0` 和
  `dsh-dream-skin@8.28.0`

### Requirement: 官方 profile 只加载第三方 bundle 的唯一 patch

当第三方包自身声明有效的 `dsh.bundle.patch` 时，官方 profile SHALL 直接选择该包，且
MUST 不额外选择只用于重新挂载同一插件的空包装 bundle。启动后的 Loader tree SHALL
仅出现一次每个第三方插件注册 entry。

#### Scenario: 启动官方 Host

- **WHEN** 桌面应用使用官方 profile 启动 Host
- **THEN** `better-sidebar` 和 `dream-skin` entry 均仅激活一次，且 desktop layer 仍不在
  持久 profile bundle 列表中
