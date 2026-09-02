## Purpose

定义 DSH runtime 升级后 profile 与构建依赖使用的固定版本事实。

## MODIFIED Requirements

### Requirement: profile runtime 使用已验证的 DSH 与 Cordis 版本

`RUNTIME_MATRIX`、官方 profile、developer profile 以及直接 DSH/Cordis 依赖 SHALL
使用精确版本 `dshVersion: 0.1.2-alpha.4` 与 `cordisVersion: 4.0.2`。profile parser
SHALL 继续拒绝任何与该矩阵不一致的 runtime 字段。

#### Scenario: 解析升级后的 profile

- **WHEN** profile 声明 `dshVersion: 0.1.2-alpha.4` 且 `cordisVersion: 4.0.2`
- **THEN** profile resolve 和 verify 成功，并将这些版本写入 resolved manifest。

#### Scenario: 拒绝旧版本漂移

- **WHEN** profile 声明 `dshVersion: 0.1.1-rc.2` 或 `cordisVersion: 4.0.1`
- **THEN** parser 以 `RUNTIME_MATRIX_DRIFT` 失败。

### Requirement: 锁文件闭包与直接依赖保持一致

根包、`profile-toolchain`、`desktop-services`、`desktop-services-local` 与
`desktop-layer` 的 DSH/Cordis 直接声明 SHALL 通过 pnpm lockfile 固定到
`0.1.2-alpha.4` / `4.0.2` 的可复现解析结果；不得以未锁定的旧版本替代。
