## Purpose

定义发行版 profile 意图到上游 DSH profile 目录的确定性编译规则，消除 `profile.yml`、bundle、依赖清单和锁文件之间的第二事实来源。

## ADDED Requirements

### Requirement: Profile 意图具有唯一源文件
每个仓库 profile MUST 以 `profiles/<name>/profile.yml` 表达运行时版本和有序 bundle 集合，并 MAY 使用同目录 `cordis.patch.yml` 表达该 profile 的最终用户覆盖；加载插件 MUST 通过 bundle 表达，`profile.yml` MUST NOT 维护独立的可加载插件列表。

#### Scenario: 编译 bundle 组合
- **WHEN** profile 声明官方 base、Web、发行版和可选功能 bundle
- **THEN** 编译器按声明顺序生成上游 DSH `dsh.profile.bundles`，且不生成第二份插件顺序

#### Scenario: 声明独立插件列表
- **WHEN** profile 使用未受支持的顶层 `plugins` 字段表达可加载插件
- **THEN** 编译器失败并要求通过现有或新增 bundle 表达该插件

### Requirement: 编译结果必须符合上游 DSH profile 格式
编译器 MUST 生成包含 `package.json`、`cordis.patch.yml`、`pnpm-workspace.yaml` 和 `pnpm-lock.yaml` 的可启动 DSH profile，其中 `package.json` MUST 包含精确依赖与有序 `dsh.profile.bundles`。

#### Scenario: 生成可启动 profile
- **WHEN** 所有 bundle、版本和依赖均可解析
- **THEN** 生成目录可由固定版本的 `dsh --profile`、`--dump-config` 和 Loader smoke 直接使用

#### Scenario: Bundle 没有 patch 声明
- **WHEN** profile 引用的包没有有效 `dsh.bundle.patch`
- **THEN** 编译在安装包生成前失败并报告包名和来源

### Requirement: 锁文件是机器生成的解析证据
`pnpm-lock.yaml` 和 resolved manifest MUST 由解析器生成并可提交审查，但 MUST NOT 被解释为人工组合意图；`profile:verify` MUST 在源清单与锁定结果漂移时失败。

#### Scenario: 锁定结果未变化
- **WHEN** 相同输入、工具版本和依赖源被再次解析
- **THEN** 生成的 profile、锁文件和 resolved manifest 在规范化后完全一致

#### Scenario: 源清单改变但未重新解析
- **WHEN** bundle 版本或来源已变化，而提交的锁文件仍对应旧输入
- **THEN** `profile:verify` 失败并指出需要重新解析的 profile

### Requirement: 版本和构建脚本必须受策略约束
编译器 MUST 验证 DSH package family、Cordis peer、desktop protocol、profile schema、Electron ABI 和 Node 引擎兼容性；Git 来源 MUST 固定完整 commit，安装脚本 MUST 在 `allowBuilds` 中逐项授权。

#### Scenario: 浮动 Git 来源
- **WHEN** bundle 依赖使用 branch、tag、`main` 或其他非完整 commit 来源
- **THEN** 生产 profile 解析失败

#### Scenario: 未授权构建脚本
- **WHEN** 依赖需要生命周期构建脚本但 profile 没有对应 `allowBuilds` 决策
- **THEN** 解析或安装失败并报告需要审查的精确依赖键

### Requirement: 源平面和产物平面必须分离
编译器 MUST 将可启动 profile 和安装包暂存到 `artifacts/`，并 MUST 支持从仓库 profile 源重新生成；构建和运行时 MUST NOT 回写 `profile.yml` 或源 `cordis.patch.yml`。

#### Scenario: 清理后重建
- **WHEN** 删除所有 `artifacts/` 后重新执行解析和打包
- **THEN** 系统仅依赖仓库源文件和锁定依赖即可重建等价产物

