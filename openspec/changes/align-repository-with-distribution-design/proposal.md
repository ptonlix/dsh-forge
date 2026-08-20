## Why

`docs/design/dsh-forge.md` 已定义 DSH Forge 的目标架构，但基础实现完成后，核心代码仍集中在 `src/`，Electron 原生运行时没有形成独立提供方，且命令与文档示例没有以真实行为为准。设计必须是仓库的唯一目标状态；继续把偏差描述成另一套“当前布局”会让实现、公开接口和 Fork 路径长期分叉。

## What Changes

- 将生产代码迁移到设计指定的 `apps/desktop`、`packages/desktop-plugin`、`packages/bundles`、`tools`、`packages/features` 与 `packages/generators` 边界；删除作为生产实现根的 `src/`，不保留双轨目录。
- 建立内部 `desktopRuntime` 合同，并在 `apps/desktop/native-runtime.ts` 实现 Electron 提供方；launcher 只使用该合同，第三方插件继续只能依赖公开 desktop service。
- 落实 Electron 的单实例、loopback 导航 allowlist、新窗口拦截和外部链接由系统浏览器打开的运行时行为。
- 让 profile 相关命令显式接收并校验 profile 名称，令解析、验证、打包和检查均以选定 profile 及 `distribution.yml` 的默认值为唯一输入。
- 将公开 desktop contract 的模块入口固定为包 exports，禁止应用和工具从其他 workspace 包导入源码路径。**BREAKING**：内部模块路径不再是可导入接口。
- 修订设计及参考文档，使目录树、配置示例、公开类型和命令示例与已接受的架构和实际 schema 一致；文档不再描述替代布局或失效 API。
- 为目录边界、public exports、Electron 安全策略、profile 参数和文档示例增加可执行验证，并移除被替换目录中的旧实现。

## Capabilities

### New Capabilities

- `repository-architecture-alignment`: 规定设计目录的唯一所有权、允许的依赖方向和公开模块边界。
- `desktop-runtime-security`: 定义 `desktopRuntime` 提供方、单实例及 renderer 导航和外链安全行为。
- `profile-command-selection`: 定义 profile 命令的选择、默认、失败和产物隔离语义。
- `design-contract-accuracy`: 规定设计与参考文档中的路径、配置、公开接口和命令必须可验证且与实现一致。

### Modified Capabilities

无。基础契约尚未归档为仓库基线 spec；本变更以新增的收敛能力承接其实现后的目录和运行时缺口。

## Impact

- 受影响的生产代码包括 `apps/desktop`、现有 `src/*`、`packages/desktop-plugin`、`packages/bundles`、`scripts`、`package.json`、TypeScript 配置和 package exports。
- 受影响的用户接口包括 CLI 的 profile 参数、Electron 的单实例与导航行为，以及第三方仅可依赖的 desktop-plugin exports。
- `docs/design/dsh-forge.md`、`docs/reference/*`、工程边界文档、测试夹具和质量门禁将同步成为实现的一部分。
- 产物和缓存目录继续由构建生成；它们不会成为架构迁移的兼容实现或第二事实来源。
