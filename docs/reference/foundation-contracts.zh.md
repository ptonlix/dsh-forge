# DSH Forge 基础契约

中文 | [English](foundation-contracts.md)

本参考文档负责稳定配置和公开桌面 service 事实。发行版职责与生命周期设计见 [`../design/dsh-forge.zh.md`](../design/dsh-forge.zh.md)；源文件、恢复和发布维护边界见 [`../engineering/foundation-boundaries.zh.md`](../engineering/foundation-boundaries.zh.md)。

## 发行版与 Profile

`distribution.yml` 是发行版身份的唯一来源。它必须声明 `schema`、`id`、`name`、`packageScope`、`applicationId`、`version`、`defaultProfile` 和至少一个平台/架构目标。已有的 `channel`、`metadataUrl` 和 `trustRoot` 仅属于带信任根的更新元数据配置；完整安装包 OTA 不从 `distribution.yml` 读取它们。

`profiles/<name>/profile.yml` 声明固定 runtime 版本组和有序 `bundles`。顶层 `plugins` 字段会被拒绝。`@dsh-forge/desktop-layer` 由启动器为一个 generation 临时注入，不能出现在 `bundles` 中。同目录的 `cordis.patch.yml` 是最终 profile 覆盖层。

`profile:resolve` 在 `artifacts/<distribution>/<profile>/<input-digest>/` 下写出生成 profile、profile lockfile、`resolved-manifest.json`、`sbom.input.json`、许可证通知和 config dump。这些文件是解析证据。源文件、bundle、版本或构建脚本授权改变后，必须重新运行 `profile:resolve` 和 `profile:verify`。

## 完整安装包 OTA

根 `package.json` 的 `dshForgeBuild` 必须是正安全整数。打包脚本把它复制到应用的 `package.json`；同一 SemVer 重新发布时，维护者必须递增该值。已打包应用固定读取 `https://github.com/ptonlix/dsh-forge/releases/latest/download/version.json`，该 JSON 必须恰好包含 `windows`、`macos`、`ubuntu` 三个条目；每个条目包含精确 SemVer `version`、正安全整数 `build` 和 HTTPS `url`，扩展名依次为 `.exe`、`.dmg`、`.AppImage`。远端版本更高，或版本相同且远端 build 更高时才提供升级。

Windows 与 macOS 直接使用各自条目。Linux 只发布 Ubuntu AppImage，且必须同时满足 Ubuntu 22.04+、可写绝对常规文件 `APPIMAGE` 才使用该条目；其他发行版和其他启动方式不会检查或执行 OTA。确认前不下载；确认后的文件只写入用户数据目录受控暂存区，并由 `apps/desktop/platform` helper 在当前 Electron 退出后执行。

私有升级状态投影仅在下载期间报告 `receivedBytes`、`totalBytes` 和 `percent`。响应提供有效 `Content-Length` 时，设置页显示确定进度条和百分比；否则显示不确定进度条及已下载字节，不伪造百分比。页面不会获得更新 URL、暂存路径、命令或重启 token。

Windows 使用受控暂存 `cmd.exe` runner 等待 Electron 退出，避免 NSIS 持有正在替换的应用可执行文件。安装器零退出后 runner 会显式启动更新后的可执行文件，macOS 通过 `open -n` 启动更新后的 bundle，Ubuntu 则启动替换后的 AppImage。只有新进程完成 Host、loopback、窗口和 renderer 的就绪序列，并写入携带 helper 随机 token 的一次性受控回执后，重启才算成功。未收到回执时保留完整安装包用于诊断；若 macOS 或 Ubuntu 已开始替换，必须恢复旧应用。新的 Windows 应用会在写入回执后最佳努力清理暂存文件。有效 macOS 回执写入后，DMG 卸载、备份删除和暂存清理均为最佳努力，不能将已完成的重启改判为失败。

该清单和完整安装包没有摘要、签名或信任根校验。HTTPS、用户确认和 macOS 系统签名/公证不能替代可审计的通用更新信任通道；发布工作流会把三个平台安装包上传到同一 GitHub Release 的固定资产名，发布者仍需确认清单版本、build 与 Release tag 一致。

generation 就绪后会静默检查更新；当状态为 `available` 时，设置入口显示非阻塞的橙色“发现新版本”提示。
提示不会自动打开设置、弹出确认或下载，用户进入“升级管理”页后点击“立即升级”，由主进程重新检查并
显示原生确认。入口提示通过现有 Remote 状态投影工作，不暴露更新 URL、暂存路径或命令。设置面板
打开后，“升级管理”导航项会同步显示同一枚提示，帮助用户定位到升级页面。
该导航项还使用独立的更新/刷新图标替代通用设置齿轮，同时保留设置外壳的状态颜色和点击行为。

发布前可运行 `pnpm run release:prepare -- 0.2.0`。命令会校验并同步根 `distribution.yml` 的 `version`、根 `package.json` 的 `version` 与 `dshForgeBuild`：目标版本高于当前版本时将 build 重置为 `1`，同一版本重发时自动递增 build。两个版本源不一致、输入非法或版本降级会在写入前失败；命令不会创建 tag 或发布 Release。准备完成后提交变更并创建匹配的 annotated tag（例如 `v0.2.0`），CI 会继续校验 tag 与 `distribution.yml` 一致。

## 公开导入

`@dsh-forge/desktop-services` 是唯一公开的桌面 import。它为 Cordis `Context` 声明 `desktopProfiles`、`desktopPnpm` 和 `desktopServices`；consumer 必须在使用前调用 `assertDesktopServicesProtocol()`。当前协议是 `1`。

Local provider、Electron runtime、启动器路径、profile 目录和原始 pnpm 参数均为内部实现。第三方 bundle 不能导入 `@dsh-forge/desktop-services-local`，也不能假定普通 Web、headless 或测试 composition 已经挂载 desktop layer。

## `desktopProfiles`

`desktopProfiles.current` 是一个 generation 内不可变的名称快照。`snapshot()` 返回深度冻结的 profile 快照，`list()` 返回带 bundle、兼容性、可选择性和诊断事实的只读摘要。`select(name)` 持久化 pending 目标并重启 generation；它不能替换运行中的 Loader tree。

相同并发目标共享一个 operation。不同并发目标会失败，不会替换已持久化 pending 目标。generation dispose 后，任何保留 service 引用都会失败，不能影响新 generation。打包应用不会在 UI 中暴露 profile 选择。

## `desktopPnpm`

`desktopPnpm.run()` 只能接收以下判别 command：

| Command | 必填字段 | 含义 |
| --- | --- | --- |
| `inspect` | `query: 'list'` 或 `query: 'why'` | 读取 profile 依赖；`why` 需要 `packageName`。 |
| `reconcile` | 无 | 不执行生命周期脚本地同步 profile lockfile。 |
| `remove` | `packageName` | 通过 provider 移除一个精确 package。 |

`DesktopPnpmOperation` 提供 `stdout`、`stderr`、`done` promise 和幂等 `cancel()`。`done` 只有在受管进程树、reconcile、来源校验、健康检查、receipt 或恢复达到终态后才会结算。每个 generation 只允许一个 operation；已取消 signal、busy lease 或已关闭 generation 都会在启动进程前失败。

`install(request)` 只接受由 catalog 确认的不可变 `ConfirmedPluginInstall`。Registry 安装绑定 registry、tarball 和 integrity；Git 安装绑定完整 commit；workspace 条目只供展示，不能触发动态安装。provider 会将请求重新绑定到当前 catalog，并在提交 receipt 前比较 package 名称、精确版本、来源和 integrity。

## 信任与清单

Descriptor 和 catalog 使用 `executionMode: 'trusted-in-process'`。审核、授权和 enforcement 事实彼此分开；`enforcement: unavailable` 表示公开 API 不是 Node 或 Electron 安全边界。

`resolved-manifest.json` 记录 profile runtime、bundle、来源、integrity、许可证、脚本、`allowBuilds`、实际平台依赖闭包和输入摘要。输入摘要覆盖跨平台源输入与根锁文件的规范化 YAML 语义；按平台选择的 optional native 包属于证据，不改变摘要身份。`runtime-manifest.json` 还记录 Electron、Node、pnpm、native addon、构建目标、声明目标和签名事实。两种 manifest 都不能证明作者可信、许可证准确、签名有效或已执行代码安全。

## 验证

```sh
pnpm run profile:resolve -- dsh-forge-official
pnpm run profile:verify -- dsh-forge-official
pnpm run catalog:verify
pnpm run test:desktop-services-consumer
```

面向 consumer 的包指南见 [`../../packages/desktop-services/README.zh.md`](../../packages/desktop-services/README.zh.md)。其中提供可编译示例和包级维护命令。
