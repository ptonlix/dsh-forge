# DSH Forge 发行版架构

中文 | [English](dsh-forge.md)

## 范围

本文是 DSH Forge 桌面发行版的架构唯一权威来源，说明本仓库如何围绕上游 DeepSeek Harness（DSH）组合可审计 Electron 应用。项目提供两条发行路径：仓库维护者将经过审核的 bundle 和桌面专属能力组合为官方 profile 并发布，Fork 维护者则以同一套源码为底座加入其他或自定义插件并重新构建。桌面专属能力以 bundle/plugin 接入 DSH Host；当前包含升级管理，存储空间管理等能力须通过后续独立变更交付。DSH 负责 agent loop、会话协议、模型运行时、Host、Web Client 和 Cordis 语义；本仓库负责发行版身份、profile 组合、桌面宿主和发布证据。

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

发布门禁还检查安装包布局、动态导入、native 文件、SBOM 与许可证通知、平台证据和真实 smoke。tag 的 macOS universal 产物必须在 profile 闭包注入后完成 Developer ID 签名、Apple 公证、stapling 和本机验证；缺少凭据或任一步失败都会阻断汇总与 Release。未显式启用签名的本地、Windows 与 Linux 构建仍如实标记为 `unsigned-smoke`。Windows Authenticode 不属于当前流水线。

完整安装包 OTA 由 `apps/desktop` 与私有的 `@dsh-forge/desktop-services-local/launcher` 协作实现。已打包应用从固定 GitHub Release `version.json` 读取 Windows、macOS 和 Ubuntu AppImage 条目，按 SemVer 优先、`build` 次级比较；generation 就绪后由 `UpgradeCoordinator` 静默检查并每 12 小时调度一次，只有设置页发起的重新检查仍有更新且用户确认后才下载完整包并有序退出，平台 helper 再执行安装或替换。下载期间，固定 Typert Remote 只在响应给出有效总长度时投影字节数和百分比，使设置页能在不接触 URL、路径、命令或 token 的前提下显示确定或不确定进度。Windows 的受控暂存 `cmd.exe` runner 会等待 Electron 退出，使 NSIS 可以替换应用二进制；随后它显式启动更新后的 Windows 可执行文件、macOS bundle 或 Ubuntu AppImage，并等待仅在新 generation 完整就绪后写入的随机 token 回执；启动命令返回成功本身不代表升级完成。回执缺失时保留恢复证据，并恢复已替换的 macOS 或 Ubuntu 应用。macOS 仅在回执后执行最佳努力清理，因此 DMG 卸载失败不会把已完成的重启误报为失败。Ubuntu 只发布并支持 Ubuntu 22.04+ 且可写 `APPIMAGE` 的 AppImage，其他 Linux 启动方式不受支持。该通道不校验安装包摘要、清单签名或信任根，不能称为通用可信更新通道。

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

本文不声称真实 Apple 签名、公证、stapling 或 GitHub Pages 已执行；这些事实分别属于工程验证记录和文档站构建输出。
