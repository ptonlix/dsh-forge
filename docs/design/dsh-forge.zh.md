# DSH Forge 发行版架构

中文 | [English](dsh-forge.md)

## 范围

本文是 DSH Forge 桌面发行版的架构唯一权威来源，说明本仓库如何围绕上游 DeepSeek Harness（DSH）组合可审计 Electron 应用。DSH 负责 agent loop、会话协议、模型运行时、Host、Web Client 和 Cordis 语义；本仓库负责发行版身份、profile 组合、桌面宿主和发布证据。

当前实现使用 Electron。Tauri、应用内插件市场、运行时 profile 切换和在线下载插件不属于本发行版；在写成产品能力前必须通过独立变更实现。

## 架构

```text
distribution.yml + profile.yml + bundle + catalog
                         |
                         v
                 profile-toolchain
                         |
                         v
       resolved profile / lockfile / SBOM / manifest
                         |
                         v
              Electron launcher + Host generation
                         |
                         v
                   sandboxed renderer
```

`distribution.yml` 是发行版身份源。每个 `profiles/<name>/profile.yml` 是手工维护的组合源。Bundle 声明 DSH manifest 和依赖。`catalog/catalog.yml` 保存静态来源、integrity、许可证、能力、平台和审核事实。`artifacts/` 下的生成 profile、lockfile、resolved manifest 和安装包是证据，不能成为第二套源代码。

## 运行时所有权

Electron 启动器拥有单实例锁、原生运行时、窗口、profile 绑定和进程 teardown。Host Cordis generation 拥有所选 profile 的 DSH service 和 loopback Web surface。Desktop layer 在 generation 内发布类型化 service。第三方 bundle 使用公开的 [`@dsh-forge/desktop-services`](../reference/foundation-contracts.zh.md) contract，不能获得原始 Electron 对象、启动器路径或任意 package manager 参数。

Renderer 固定使用 Chromium sandbox、context isolation 并关闭 Node integration。导航仅允许当前 generation 的 loopback authority；支持的 HTTP(S) 和 mail 外链交给操作系统。插件执行模式为 `trusted-in-process`：catalog 审核和用户确认属于审计与授权控制，不是 Node 或 Electron 进程沙箱。

## Generation 生命周期

1. 启动器获取单实例锁并解析构建绑定的 profile；开发态可以使用 `--profile` 选择仓库 profile。
2. 启动器准备共享 DSH Home 和 profile 路径，不把会话或凭据复制到 Electron `userData`。
3. 创建 Host generation 并注入 desktop layer。
4. Host 按 profile 顺序加载 bundle，绑定随机 loopback 端口并报告 readiness。
5. Electron 创建安全窗口并等待 renderer boot report。
6. Host、loopback、窗口和 renderer 都成功后，generation 才成为 `last-known-good`。

关闭窗口默认只隐藏。显式退出、信号、generation 失败和 profile 重启都会对 Host 及受管进程树执行有界 teardown。pending generation 失败会保留事实，并最多恢复到上一个已知良好目标一次；再次失败需要人工恢复。

## 组合与发布

编译器校验 runtime 兼容性、bundle manifest、peer 依赖、静态 catalog、完整 Git commit、生命周期脚本授权和依赖闭包。输入摘要覆盖跨平台源输入和根锁文件的规范化 YAML 语义；按 runner 平台裁剪的实际依赖闭包仍保留在 resolved manifest 与 SBOM 证据中。组合器运行真实 DSH loader 生成 config dump；只有健康 dump 才能通过 verify 和打包。

发布门禁还检查安装包布局、动态导入、native 文件、SBOM 与许可证通知、平台证据和真实 smoke。当前 GitHub Tag Release 允许发布明确标记为 `unsigned-smoke` 的安装包；代码签名、公证和自动更新 channel 不属于当前流水线，后续单独实现。运行时更新若启用，仍必须遵守更新元数据的信任校验。

## Fork 契约

Fork 维护者修改发行版身份、添加 profile、在静态 catalog 中审核外部 bundle，并从源文件重新构建。不能复制 DSH 核心、第三方插件源码、生成产物或私有 provider。源/产物、安装、恢复和发布边界见 [`../engineering/foundation-boundaries.zh.md`](../engineering/foundation-boundaries.zh.md)；配置和公开 service 细节见 [`../reference/foundation-contracts.zh.md`](../reference/foundation-contracts.zh.md)。

## 验证

按变更范围使用根脚本：

```sh
pnpm run profile:resolve -- dsh-forge-official
pnpm run profile:verify -- dsh-forge-official
pnpm run package:desktop -- dsh-forge-official
pnpm run package:inspect -- dsh-forge-official
pnpm run package:smoke -- dsh-forge-official
```

本文不声称平台签名、公证或 GitHub Pages 已部署；这些事实分别属于工程验证记录和文档站构建输出。
