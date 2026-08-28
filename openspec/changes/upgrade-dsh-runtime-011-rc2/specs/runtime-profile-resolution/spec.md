## Purpose

定义 DSH runtime 升级后 profile 与构建依赖使用的固定版本事实。

## MODIFIED Requirements

### Requirement: profile runtime 使用已验证的 DSH 版本

`RUNTIME_MATRIX`、官方 profile、developer profile 以及 profile-toolchain 的直接
DSH 依赖 SHALL 使用精确版本 `0.1.1-rc.2`。profile parser SHALL 继续拒绝任何与
该矩阵不一致的 `dshVersion`。

#### Scenario: 解析升级后的 profile

- **WHEN** profile 声明 `dshVersion: 0.1.1-rc.2`
- **THEN** profile resolve 和 verify 成功，并将该版本写入 resolved manifest。

#### Scenario: 拒绝旧版本漂移

- **WHEN** profile 声明 `dshVersion: 0.1.0-rc.8`
- **THEN** parser 以 `RUNTIME_MATRIX_DRIFT` 失败。

### Requirement: 锁文件闭包与直接依赖保持一致

根包和 profile-toolchain 的 DSH 直接依赖 SHALL 通过 pnpm lockfile 固定到
`0.1.1-rc.2` 的可复现解析结果；不得以未锁定的旧版本替代。
