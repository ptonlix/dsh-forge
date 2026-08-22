# 术语表

本表固定公开文档中的核心词汇。英文 API、包名和配置字段不翻译。

| 中文 | English | 说明 |
| --- | --- | --- |
| 发行版 | distribution | 由 `distribution.yml` 描述的桌面应用身份和平台范围。 |
| 配置档 | profile | 构建期选择的 runtime 与有序 bundle 组合。 |
| 包组合 | bundle | 带有 `dsh.bundle` manifest 和 `cordis.patch.yml` 的可复用 DSH 包。 |
| 静态目录 | catalog | 记录来源、版本、integrity、许可证与审核事实的静态输入，不是插件市场。 |
| 宿主 | Host | 承载 DSH Cordis generation 的进程角色。 |
| 代际 | generation | 由启动器创建并拥有运行时资源生命周期的一次 Host 实例。 |
| 公开服务 | public service | `@dsh-forge/desktop-services` 暴露给第三方 consumer 的类型化 service。 |
| 私有 provider | private provider | `@dsh-forge/desktop-services-local`，只能由 desktop layer 和启动器使用。 |
| 已信任的进程内执行 | trusted-in-process | 插件执行模式；不表示 Node 或 Electron 的技术隔离。 |
| 解析产物清单 | resolved manifest | profile 编译后记录输入闭包与运行时事实的生成物。 |
| Git blob hash | Git blob hash | 以 `blob <length>\\0<content>` 计算的 Git 内容对象 SHA-1。 |
