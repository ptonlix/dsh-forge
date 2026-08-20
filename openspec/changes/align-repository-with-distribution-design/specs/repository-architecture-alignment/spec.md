## Purpose

定义 DSH Forge 生产代码的唯一目录所有权、跨包依赖方向与公开模块边界，确保 Fork 和第三方插件不会依赖实现细节或过渡目录。

## ADDED Requirements

### Requirement: 生产代码必须使用设计目录作为唯一所有权边界
仓库 MUST 将 Electron 应用代码置于 `apps/desktop`，桌面插件置于 `packages/desktop-plugin`，可复用 bundle 置于 `packages/bundles`，发行版工具置于 `tools`。`profiles`、`catalog`、`templates` 和 `schemas` MUST 保持各自的配置、审计、脚手架和 schema 职责；构建产物不得充当生产源码。仓库 MUST 不保留根级 `src/` 作为生产实现的第二个目录。

#### Scenario: 从干净工作树构建
- **WHEN** 开发者在不含构建产物的工作树执行项目构建
- **THEN** 所有生产模块均从设计目录解析，且构建输入不包含根级 `src/` 的实现文件

#### Scenario: 检查目录所有权
- **WHEN** 质量门禁扫描生产 TypeScript 文件与包脚本
- **THEN** 它拒绝生产代码、入口脚本或路径别名依赖已移除的根级 `src/` 实现

### Requirement: 跨包依赖必须遵循设计边界
Electron 应用 MUST 只依赖工具包的公开 exports 和 desktop-plugin 的公开 exports；发行版工具 MUST 不依赖 Electron 应用实现；bundle、feature 和 generator 包 MUST 不导入应用私有模块或原生运行时。跨 workspace 消费 MUST 使用包名和声明的 export 子路径，不得通过相对路径穿透其他包的源码。

#### Scenario: 应用消费 profile 工具
- **WHEN** Electron 启动器需要编译或读取 profile
- **THEN** 它通过工具包声明的模块入口获得该能力，且不导入工具包源码文件

#### Scenario: bundle 被独立解析
- **WHEN** profile 编译器在没有 Electron 安装环境的进程中解析 bundle
- **THEN** bundle 的加载不要求 Electron 应用或其私有运行时模块存在

### Requirement: 仅包 exports 构成第三方稳定接口
第三方插件和 Fork 扩展 MUST 仅依赖 package `exports` 明示的桌面 service contract、bundle contract 和工具接口。实现目录、Electron 原生提供方、启动事实和未导出的子路径 MUST 不构成兼容接口，并在兼容性检查中被拒绝。

#### Scenario: 第三方插件导入公开 contract
- **WHEN** 第三方 Host 插件编译并导入 `@dsh-forge/desktop-plugin/profile-service` 或 `@dsh-forge/desktop-plugin/pnpm`
- **THEN** 类型和运行时入口均可由 package exports 解析

#### Scenario: 第三方插件导入私有实现
- **WHEN** 依赖声明或源码导入未导出的 desktop-plugin、应用或工具内部路径
- **THEN** 兼容性验证失败并指出该路径不是公开接口

### Requirement: 目录迁移不得留下双轨实现
迁移完成后，项目脚本、TypeScript 配置、测试夹具和文档链接 MUST 全部指向设计目录。被替换的实现 MUST 被删除，不得以 re-export、复制文件或旧路径兼容层继续存在。

#### Scenario: 搜索旧目录引用
- **WHEN** 质量门禁搜索已移除生产目录及其历史导入路径
- **THEN** 仅允许迁移记录中的历史说明出现，运行时、构建、测试和公共文档均不得引用它们
