# DSH Forge 文档

中文 | [English](README.md)

本地图将读者指向每个公开 DSH Forge 事实的唯一所有者。它只覆盖当前 Electron 发行版；不描述应用插件市场、运行时 profile UI 或在线安装流程。

## 从这里开始

- [`../README.zh.md`](../README.zh.md)：项目范围、环境要求和常用命令。
- [`design/dsh-forge.zh.md`](design/dsh-forge.zh.md)：发行版架构、所有权和运行时生命周期。
- [`reference/foundation-contracts.zh.md`](reference/foundation-contracts.zh.md)：配置和公开桌面 service contract。
- [`engineering/foundation-boundaries.zh.md`](engineering/foundation-boundaries.zh.md)：源/派生文件、恢复、安装和发布边界。

## 包文档

- [`../packages/desktop-services/README.zh.md`](../packages/desktop-services/README.zh.md)：Host 插件使用的公开 consumer API。
- [`../tools/profile-toolchain/README.zh.md`](../tools/profile-toolchain/README.zh.md)：profile 编译、验证和发布工具。

`../packages/desktop-services-local/README.zh.md` 与 [`engineering/foundation-verification.md`](engineering/foundation-verification.md) 是内部维护记录。它们保留在仓库中，但不是公开站点页面或第三方 consumer 文档。

## 语言维护

本地图中的每个页面都有英文源、中文兄弟文件和 `foo.i18n.yaml` 一致性记录。修改公开页面前先阅读 [`i18n/README.md`](i18n/README.md)。静态站投影这些 canonical 文件，不维护第二份正文。
