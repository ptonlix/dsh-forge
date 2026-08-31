## Context

`@dsh-forge/desktop-services-local` 是私有 Node provider，不能向 bundle 暴露 Electron 或平台
对象。`apps/desktop` 拥有应用退出、原生对话框和安装器执行。Ubuntu 22.04+ 发行版只生成
AppImage，因为它是可以由应用原子替换的单文件分发格式。当前打包流程先创建未签名的
目录应用，再注入完整 profile 闭包，最后生成分发格式；若只在初始 builder 调用中签名，注入
闭包会使签名失效。当前 GitHub Release 允许 `unsigned-smoke`，也没有可供运行时读取的发布
清单。

用户指定以 GitHub Release 的固定资产发布 `version.json`，并明确选择不为该清单或安装包增加
摘要和签名。该选择降低了实现复杂度，但不满足现有通用更新信任模型；本变更必须如实保留该
限制，不能将其称为可信更新通道。

## Goals / Non-goals

**Goals:**

- 在 Windows、macOS 和 Ubuntu 22.04+ AppImage 的已安装桌面应用中提供可拒绝的、完整安装包 OTA。
- 让相同 SemVer 的重建包可通过单调递增 build 被识别为更新。
- 在最终 profile 闭包进入 macOS `.app` 后完成签名、公证与 stapling，并只发布已验证的包。
- 让 GitHub Actions 签名材料仅在受信任 tag 的 macOS package job 中以受限临时文件形式存在。

**Non-goals:**

- 不绕过用户确认，不在 renderer 或第三方 Cordis bundle 中执行更新。
- 不使 `desktop-services-local` 成为公开更新 API，也不将 Electron 对象传入 Cordis service。
- 不把缺失 signing secret 降级为可发布 unsigned 产物。
- 不修改归档 OpenSpec 来伪造历史发布结论。
- 不发行 Ubuntu `.deb`，也不支持其他 Linux 发行版或不是由 AppImage 启动的 Linux 应用。

## Decisions

### 1. 版本清单与比较规则

GitHub Release 永远附带名为 `version.json` 的资产，运行时从
`https://github.com/ptonlix/dsh-forge/releases/latest/download/version.json` 请求它。清单为严格
JSON，字段如下：

```json
{
  "windows": {
    "build": 1,
    "version": "1.0.0",
    "url": "https://github.com/ptonlix/dsh-forge/releases/download/v1.0.0/dsh-forge-windows.exe"
  },
  "macos": {
    "build": 1,
    "version": "1.0.0",
    "url": "https://github.com/ptonlix/dsh-forge/releases/download/v1.0.0/dsh-forge-macos.dmg"
  },
  "ubuntu": {
    "build": 1,
    "version": "1.0.0",
    "url": "https://github.com/ptonlix/dsh-forge/releases/download/v1.0.0/dsh-forge-ubuntu.AppImage"
  }
}
```

平台键映射为 `win32 -> windows`、`darwin -> macos`、满足 Ubuntu 22.04+ 运行时条件的
`linux -> ubuntu`。Linux 运行时必须通过 `/etc/os-release` 确认为 `ID=ubuntu` 且版本不低于
`22.04`，并要求 `APPIMAGE` 是可写的绝对常规文件；不满足任一条件不检查 OTA。`version` 必须是
精确 SemVer，`build` 必须是安全整数且大于零，`url` 必须是 HTTPS URL，Windows/macOS/Ubuntu 的
文件扩展名必须分别为 `.exe`/`.dmg`/`.AppImage`。比较顺序是先比较 SemVer，再比较 build；远端仅
在前者较大，或前者相等且 build 较大时才可升级。预发布版本按现有 `semver` 规则排序。更低版本或
同版本同/更低 build 均不下载。

根 `package.json` 增加 `dshForgeBuild`，它是每次发布同一 SemVer 重建时必须递增的正安全整数。
打包脚本将其写入 staging `package.json`，Electron 从 `app.getAppPath()/package.json` 读取它；开发态
从仓库根 `package.json` 读取同一字段。缺失或非法 build 会让升级检查失败并保持当前应用运行，
不会猜测为零。

### 2. 私有下载器、升级协调器与设置页分离

`desktop-services-local` 负责解析清单、比较版本、以受限文件名在用户数据目录的专用 staging
目录下载文件，并暴露只含版本、平台、URL、临时文件和错误结果的私有 launcher API。它不显示
对话框、不退出应用、不执行 shell、不引用 Electron，且任何 generation 关闭后请求都会被拒绝。

`apps/desktop` 创建 generation 所有的 `UpgradeCoordinator`。它持有当前版本/build、最近检查完成时间、
检查/准备状态、可用版本、稳定失败 code 与平台是否支持；状态绝不包含 URL、暂存文件路径、命令或
凭据。启动完成后协调器静默检查一次，在每次检查结束后安排 12 小时后的下一次检查。自动检查不下载、
不显示对话框；无更新和检查失败不显示通知。手动检查和定时检查共用一项 in-flight Promise，避免并发
请求。generation 释放时协调器取消检查/下载并清除 timer，迟到的结果不能写回已经释放的 generation。

`desktop-layer` 注册“升级管理”设置页，并通过 `upgradeManager/status`、`upgradeManager/check`、
`upgradeManager/startUpgrade` 三个无参数 Typert Remote 方法访问协调器。Remote 不接受版本、URL、路径、
命令或其他 renderer 选择的升级候选。页面显示本地版本/build、上次检查、检查状态、可用版本和平台
支持状态。非 Ubuntu、Ubuntu 版本过低、`.deb`、非 AppImage 或不可写 `APPIMAGE` 都显示“当前安装方式
不支持 OTA”，且不尝试网络检查或下载。

用户点击“立即升级”时，主进程必须重新检查，不信任页面已有候选；只有仍有更新时才由
`dialog.showMessageBox` 获得明确确认。取消、关闭对话框或网络/解析失败时继续当前应用且不下载。
用户确认后才开始下载；下载必须写入新文件，流结束且关闭后才成为可交给安装器的完整暂存文件。没有
renderer IPC、第三方 bundle 或自动确认入口。

### 3. 平台安装和清理语义

安装器始终由 `apps/desktop/platform` 创建的 helper 执行，调用参数由内部生成的绝对路径组成，
不会把 URL、文件名或用户文本拼入 shell。准备 helper 失败时删除本次暂存文件并保留当前应用。

Windows helper 等待 Electron PID 退出后以正常交互方式运行下载的 NSIS `.exe`，等待其正常返回；
返回码为零才删除 `.exe`。macOS helper 等待 PID 退出后挂载 DMG、定位唯一 `.app`，使用 macOS
`ditto` 保留 Electron framework 的相对符号链接、资源叉和 ACL，并在移动旧应用前执行
`codesign --verify --deep --strict` 与 `spctl --assess --type execute` 验证；验证通过后才替换当前安装
位置、启动新应用、卸载卷并删除 DMG。复制或验证失败时旧应用不被移动，完整包保留。Ubuntu helper 等待 PID 退出后，将下载的 `.AppImage` 完整复制
到与 `APPIMAGE` 同目录的受控临时文件、设置可执行位、保留旧文件备份后原子替换目标并启动新版本；
新版本成功启动后才删除备份和下载文件。任何复制、安装器、卸载或删除失败必须返回非零状态并留下
可诊断暂存文件；替换后的启动失败必须恢复旧 AppImage。当前 generation 在 helper 准备好后才按受控
退出路径 dispose。

本清单和安装包不带摘要或签名校验。下载 URL 被 HTTPS 保护但仍可因发布端错误或密钥泄露而替换；
只有 macOS 平台的系统签名/公证验证会在安装阶段提供额外发布者识别。

### 4. 最终 macOS 应用的签名与公证

macOS 初始 `--dir` 构建仍保持未签名，以允许 profile 闭包注入。注入完成后，打包脚本在显式的
`DSH_FORGE_MACOS_SIGNING=1` 模式下对最终 universal `.app` 执行受控签名与公证流程，再以
`--prepackaged` 生成 DMG/ZIP。该模式必须验证 P12 导入后的唯一 Developer ID Application identity，
使用 hardened runtime、timestamp 和适用于 Electron helper/framework 的签名顺序；不得只对顶层
bundle 进行浅层签名。

公证输入是包含最终 `.app` 的 ZIP。流程使用 `xcrun notarytool submit --wait` 的 API key 模式，只有
Accepted 后才能 `xcrun stapler staple`。随后以 `codesign --verify --deep --strict`、
`spctl --assess --type execute` 和 `xcrun stapler validate` 验证最终 `.app`。runtime manifest 将
macOS 目标标记为 `macos-developer-id-notarized`；任何一步失败都不能继续生成、上传或 Release
DMG/ZIP。

本地打包和 Windows/Linux CI 不启用该模式，继续把未签名状态明确写为 `unsigned-smoke`；它们不能
作为 macOS 签名成功的替代证据。

### 5. GitHub Actions 临时凭据与发布门禁

仅 tag 触发的 macOS package matrix entry 可读取这两个 Variables 和三个 Secrets。工作流在 `$RUNNER_TEMP` 创建
随机命名的 P12、`.p8` 和临时 keychain，以最小权限导入 P12；P8 设为 owner-only。之后只向打包
进程传递临时文件路径、密码和 Apple API 标识，绝不输出秘密值或其 base64 内容。`always()` cleanup
必须锁定/删除临时 keychain、P12、P8 和 notarization ZIP。

tag macOS job 在构建前检查五个值均非空。缺任一值、P12 没有唯一可用 identity、notary 认证失败、
签名验证失败或 cleanup 失败都会让该 job 失败，因此 summary 和 release 也失败。PR、普通分支
`workflow_dispatch` 与非 macOS 矩阵任务不得引用这些签名配置。Release job 仍只拥有发布所需的
`contents: write`，不接触 Apple credentials。

## Risks / Trade-offs

- [未签名 OTA 清单] -> 用户已选择不校验摘要或签名；实现只支持 HTTPS、用户确认和严格的 URL/平台
  校验，不能承诺抗篡改更新。
- [Release 资产缺失或命名漂移] -> Release 工作流会在上传前从三个平台产物中各选出唯一安装包，复制为
  `dsh-forge-windows.exe`、`dsh-forge-macos.dmg` 和 `dsh-forge-ubuntu.AppImage`；任一平台找不到唯一
  产物都会使发布失败。
- [证书类型不正确或 Apple 服务不可用] -> macOS job 失败且不发布，而不是回退 unsigned；失败诊断不得
  包含凭据。
- [macOS 替换正在运行的 app] -> helper 必须在当前 PID 退出后才复制，并在任一操作失败时保留原应用。
- [Ubuntu AppImage 没有可写启动位置] -> `APPIMAGE` 缺失、不是常规文件、无写权限或 `/etc/os-release`
  不是 Ubuntu 22.04+ 时不提供 OTA；不提供替代 Linux 安装包。
- [本机无法完成公证] -> 本地验证可以覆盖纯逻辑和签名模式配置；Developer ID、公证、stapling 真实
  证据只由配置完整签名材料的 GitHub macOS runner 产生。

## Migration Plan

1. 合并并运行新的版本/build、OTA 和签名流程测试；未配置 Apple 签名材料的本地和 PR 检查不进入
   signing 模式。
2. 在 GitHub 仓库配置两个 Variables 和三个 Secrets，P12 使用 Developer ID Application 证书，API key 具有 Notary
   服务权限。
3. 将 `distribution.yml.version` 与 annotated `v*` tag 对齐，增加 `dshForgeBuild`，确认 GitHub
   Release 工作流会生成三个固定名称的安装包资产后，再触发 tag Release。
4. 使用 GitHub macOS runner 的真实 evidence 确认签名、公证与 stapling 后，再将该 Release 的
   `version.json` 作为 latest update feed。

## Open Questions

无。`version.json` 的 GitHub Release 地址、字段、无摘要/签名取舍、build 排序规则和 GitHub
secrets 名称均由本变更固定。
