## Purpose

定义官方 profile 外部 bundle 升级后的精确版本与 catalog 审核事实。

## MODIFIED Requirements

### Requirement: 官方 profile 锁定已发布的精确插件版本

`dsh-forge-official` SHALL 继续按顺序选择 `@deepseek-ai/dsh-base`、
`@deepseek-ai/dsh-web-app`、`dsh-better-sidebar`、`dsh-dream-skin`。根依赖和
profile-local package SHALL 使用 `dsh-better-sidebar: 0.18.0-alpha.0` 与
`dsh-dream-skin: 8.30.1`。SHALL NOT 写入 `latest`、范围版本或 Git 浮动引用。

#### Scenario: 官方 profile 解析外部 bundle

- **WHEN** 编译 `dsh-forge-official`
- **THEN** 生成 profile 的 `package.json` 依赖为上述精确版本，且 lockfile
  integrity 与 catalog 条目一致。

### Requirement: catalog 记录升级后的 L1 审计事实

catalog 中同名 L1 条目 SHALL 更新精确版本、npm tarball、lockfile integrity、
直接依赖摘要、`verifiedAt` 和本次实际 `verifiedOn`。`executionMode` SHALL 保持
`trusted-in-process`，`enforcement` SHALL 保持 `unavailable`。npm lifecycle
scripts 为空时，`scripts` SHALL 为空数组。

#### Scenario: 拒绝未验证平台

- **WHEN** 本次只在当前 runner 完成打包与 smoke
- **THEN** catalog `verifiedOn` 只包含该 OS/架构，不得复制未运行平台。
