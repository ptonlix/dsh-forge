## ADDED Requirements

### Requirement: 已安装桌面应用必须比较 GitHub Release 的完整包版本

Windows、macOS 与 Ubuntu 22.04+ AppImage 已安装应用 SHALL 从
`https://github.com/ptonlix/dsh-forge/releases/latest/download/version.json` 读取严格 JSON 清单。清单
MUST 包含 `windows`、`macos` 和 `ubuntu` 对象，每个对象 MUST 包含精确 SemVer `version`、正安全
整数 `build` 和 HTTPS `url`；Windows URL MUST 指向 `.exe`，macOS URL MUST 指向 `.dmg`，Ubuntu URL
MUST 指向 `.AppImage`。`win32` 使用 `windows` 条目，`darwin` 使用 `macos` 条目；仅当
`/etc/os-release` 表明 `ID=ubuntu`、版本不低于 `22.04` 且 `APPIMAGE` 是可写的绝对常规文件时，
`linux` 才可使用 `ubuntu` 条目。其他 Linux 安装方式和平台不得尝试 OTA。

本地版本 MUST 来自 `app.getVersion()`，本地 build MUST 来自随应用打包的 `package.json` 的
`dshForgeBuild`。构建脚本 MUST 将根 `package.json` 中正安全整数 `dshForgeBuild` 写入 staging
应用元数据。远端仅在 SemVer 更大，或 SemVer 相等且 build 更大时才是可用更新；降级、同一 build
或任何清单/本地 build 格式错误均不得开始下载。

#### Scenario: 同一版本的较高 build 可升级

- **WHEN** 已安装版本为 `1.0.0`、build 为 `7`，远端 `windows` 条目为版本 `1.0.0`、build 为 `8`
- **THEN** Windows 应用报告有可用更新，且候选目标为该条目的 `.exe` URL

#### Scenario: 较低版本或 build 不可升级

- **WHEN** 远端版本低于已安装版本，或版本相同且 build 小于等于本地 build
- **THEN** 应用不显示升级确认，也不创建下载文件

#### Scenario: 无效清单或非支持平台

- **WHEN** 清单缺少字段、包含非 HTTPS URL、平台扩展名不符、版本/build 无效，或 Linux 未满足
  Ubuntu AppImage 条件
- **THEN** 检查以可诊断结果结束，当前 generation 继续运行，且不得启动下载或安装器

### Requirement: 完整安装包必须在明确确认后下载和交接

升级检查和下载 MUST 位于 `@dsh-forge/desktop-services-local` 的私有 launcher API 中；该 API
不得是公开 desktop service，也不得接受 renderer、第三方 bundle 或任意 shell 参数。Electron 主进程
MUST 在当前 generation 已就绪后展示原生确认对话框。只有明确接受才可下载完整安装包；拒绝、关闭
对话框、网络失败或写入失败必须保留当前应用运行。

下载 MUST 在用户数据目录的专用 staging 目录创建受控文件名，临时写入完成并关闭后才可进入平台
helper。helper 准备完成前不得 dispose generation；准备失败时 MUST 删除本次不完整暂存文件。运行中
generation 关闭或取消时 MUST 停止下载并以稳定错误结束。

#### Scenario: 用户拒绝升级

- **WHEN** 主进程显示可用更新且用户选择拒绝或关闭确认框
- **THEN** 应用不下载安装包，当前窗口与 generation 持续运行

#### Scenario: 用户确认后下载完整包

- **WHEN** 用户确认一个可用的 Windows、macOS 或 Ubuntu AppImage 更新，且 HTTP 下载成功完成
- **THEN** provider 返回唯一、关闭后的暂存安装包，主进程可为其创建平台 helper 并按受控退出路径
  释放当前 generation

#### Scenario: 下载或 helper 准备失败

- **WHEN** 下载中断、响应无效、写入失败或 helper 无法准备
- **THEN** 当前 generation 不退出；不完整文件被删除，错误不包含用户路径或凭据

### Requirement: 平台 helper 必须在成功安装后清理完整包

平台安装逻辑 MUST 仅位于 `apps/desktop/platform`，并只接受内部创建的绝对暂存路径。Windows helper
MUST 等待当前 Electron PID 退出、运行完整 NSIS `.exe` 并等待其退出码；只有退出码为零才删除该
`.exe`。macOS helper MUST 等待当前 PID 退出、挂载 `.dmg`、定位唯一 `.app`，使用保留 bundle 符号
链接的 macOS 复制方式复制到受控临时目录，并在替换前通过 `codesign --verify --deep --strict` 和
`spctl --assess --type execute` 验证；验证通过后才替换当前安装位置、启动新应用、卸载卷并删除
`.dmg`。Ubuntu helper MUST 等待当前 PID 退出，将完整 `.AppImage` 复制到
`APPIMAGE` 同目录的受控临时文件、设置可执行位、保留旧文件备份后原子替换并启动新 AppImage；只有
新版本成功启动后才删除备份和下载文件。

安装器、复制、启动、卸载或删除失败时 MUST 返回非零结果，保留尚未清理的完整包用于诊断或重试，
并不得声称升级已完成。所有命令参数必须由内部路径构成，不能来自 URL、renderer 或用户文本。

#### Scenario: Windows 安装器成功

- **WHEN** Electron 已退出，Windows helper 运行下载的 `.exe` 且安装器以零退出
- **THEN** helper 删除该 `.exe`，并以成功状态结束

#### Scenario: macOS 替换成功

- **WHEN** Electron 已退出，macOS helper 成功替换 `.app`、启动新应用并卸载 DMG
- **THEN** helper 删除该 `.dmg`，并以成功状态结束

#### Scenario: Ubuntu AppImage 替换成功

- **WHEN** Electron 已退出，Ubuntu helper 成功将完整 AppImage 原子替换 `APPIMAGE` 并启动新版本
- **THEN** helper 删除旧文件备份和下载的 `.AppImage`，并以成功状态结束

#### Scenario: 平台安装失败

- **WHEN** 安装器返回非零，macOS 的挂载、替换、启动或卸载失败，或 Ubuntu 的复制、替换或启动失败
- **THEN** helper 返回失败状态，完整安装包保留；Ubuntu 替换后的启动失败必须恢复旧 AppImage，且不得
  报告成功

#### Scenario: macOS bundle 复制或验证失败

- **WHEN** macOS `.app` 复制失败，或复制结果未通过代码签名/Gatekeeper 验证
- **THEN** helper 不移动旧应用，保留完整 DMG，并返回失败状态
