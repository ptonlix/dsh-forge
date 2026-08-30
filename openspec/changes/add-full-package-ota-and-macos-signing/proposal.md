## Why

当前桌面发行包没有运行时升级路径，用户只能自行定位新安装包。macOS 安装包也一直以
`unsigned-smoke` 形式发布，无法满足 Gatekeeper 与 Apple 公证要求。需要增加一个由用户确认
触发的完整安装包升级流程，并让 GitHub tag Release 在 macOS 上使用仓库配置的 Apple 凭据签名
和公证最终应用。Ubuntu 22.04+ 的 AppImage 用户也需要通过完整 AppImage 获得同样可确认的升级路径。

## What Changes

- 在 `@dsh-forge/desktop-services-local` 增加私有的 OTA 检查、版本比较和完整安装包下载能力。
  固定从 `https://github.com/ptonlix/dsh-forge/releases/latest/download/version.json` 获取更新清单。
- 定义 `version.json` 的 `windows`、`macos` 和 `ubuntu` 条目，按 SemVer 优先、`build` 次级的
  规则判断是否有新版本；本地 build 来自根 `package.json` 的必填 `dshForgeBuild` 正整数，并由打包
  脚本写入应用的 `package.json`。
- 在 Electron 主进程显示升级确认；确认后下载完整 `.exe`、`.dmg` 或 `.AppImage`，交给仅位于
  `apps/desktop` 的平台 helper。Windows helper 在当前进程退出后执行安装器；macOS helper 替换当前
  `.app`；Ubuntu helper 原子替换 `APPIMAGE`。安装成功后删除下载文件，失败时保留可诊断文件和旧版本。
- 在 DeepSeek Harness 的设置中增加独立“升级管理”页面。应用启动后静默检查一次，并在每次检查结束
  12 小时后再次检查；页面通过固定的 Typert Remote 显示状态、手动检查并由用户主动开始升级。
- 在 GitHub Actions 的 macOS tag package job 中，仅使用
  `APPLE_API_ISSUER`、`APPLE_API_KEY_ID`、`MACOS_CERTIFICATE_P12_BASE64`、
  `MACOS_CERTIFICATE_PASSWORD` 和 `MACOS_NOTARY_API_KEY_P8_BASE64` 创建临时签名材料；最终
  universal `.app` 必须完成 Developer ID 签名、Apple 公证和 stapling，才可进入 DMG/ZIP、artifact
  和 Release。
- 增加 macOS 签名、公证和 stapling 的结构化证据，并在发布前验证 `codesign`、`spctl` 与
  `stapler`。缺少或无效 Apple 凭据、签名、公证或验证失败必须阻断 macOS package job 和整个
  Release。

## Capabilities

### Added Capabilities

- `full-package-ota`: 已安装的 Windows、macOS 和 Ubuntu 22.04+ AppImage 桌面应用可检查 GitHub
  Release 清单，在“升级管理”页面由用户主动请求升级、原生确认后下载并执行完整安装包升级。
- `upgrade-management`: 桌面应用在设置页展示完整包 OTA 的当前版本、检查状态、可用版本与支持条件；
  它只通过固定 Typert Remote 调用主进程协调器，不向 renderer 暴露安装包 URL、文件路径或命令参数。
- `macos-signed-release`: GitHub tag Release 为最终 macOS universal 应用进行 Developer ID 签名、
  Apple 公证和 stapling，并保存可验证证据。

## Non-goals

- 不实现差分更新、后台静默升级、自动下载、启动时升级弹窗、页面端 profile 切换或在线插件安装。
- 不增加安装包或 `version.json` 的摘要、签名或信任根校验。完整性与发布者身份只由 HTTPS、
  macOS 代码签名和用户确认承担；这不是可审计的通用更新信任通道。
- 不发行 Ubuntu `.deb`；Linux 只发布并升级 Ubuntu 22.04+ 的 AppImage，不支持其他 Linux 安装方式。
- 不实现 Windows Authenticode 或 macOS 以外的平台签名。
- 不把 Apple 证书、私钥、API key、密码、base64 内容或解码文件写入仓库、安装包、artifact、
  日志或运行时配置。

## Impact

- 修改根 `package.json`、`scripts/package-desktop.ts`、`packages/desktop-services-local/`、
  `apps/desktop/`、`.github/workflows/release-desktop.yml` 和相关 release/runtime 测试。
- 修改私有 provider README、发行架构/工程验证文档以及 GitHub Release OpenSpec 的当前 unsigned
  描述，使其与实际行为一致。
- macOS production Release 依赖上述五个 GitHub Actions secrets，且 P12 必须包含可用于公证的
  `Developer ID Application` 身份。
