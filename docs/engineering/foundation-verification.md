# 基础契约验证记录

本记录对应 OpenSpec 变更 `establish-dsh-forge-foundation-contracts` 以及后续的
`align-repository-with-distribution-design`。以下命令于 2026-08-19 在 macOS 开发环境执行；
结果覆盖当前工作区的 schema、profile 编译、真实 DSH 配置转储、generation/service 契约、
catalog、更新签名、目录边界和未签名 Electron 产物输入。

## 本地桌面开发启动

安装依赖后，可直接使用以下命令启动未打包的 Electron 桌面端：

```sh
pnpm dev
```

该命令会先编译 TypeScript 和 workspace 包，再执行 Electron。启动 profile 默认读取
`distribution.yml` 的 `defaultProfile`（当前为 `dsh-forge-official`），因此开发启动不需要追加
profile 参数。需要启动仓库中的其他 profile 时，使用 `pnpm dev -- --profile <name>`；启动器会将
已选 profile 写入 `~/.dsh/profiles/<name>`，但拒绝覆盖没有 DSH Forge 归属标记的同名目录。

```sh
pnpm run check
pnpm run acceptance
pnpm run profile:resolve
pnpm run profile:verify
pnpm run dump-config -- dsh-forge-official
pnpm run catalog:verify
pnpm run check:all
pnpm run boundaries:check
pnpm run profile:resolve -- developer
pnpm run profile:verify -- developer
pnpm run dump-config -- developer
pnpm dev -- --profile developer
pnpm run package:desktop -- developer
pnpm run package:inspect -- developer
pnpm run package:smoke -- developer
pnpm run package:desktop -- dsh-forge-official
pnpm run package:inspect -- dsh-forge-official
pnpm run package:smoke -- dsh-forge-official
pnpm run docs:check
git diff --check
openspec validate "align-repository-with-distribution-design" --type change --strict --no-interactive
```

已通过的本地证据包括 40 个测试、临时目录冻结 pnpm 锁解析、官方与 developer profile
产物隔离、真实 DSH patch dump、generation 恢复与进程树取消、静态 catalog、Ed25519 更新
元数据校验、Fork 身份投影、Markdown 链接检查、目录边界检查、OpenSpec 严格校验，以及
清理旧 `dist` 后的重新构建。Electron 目录产物的 `package:inspect` 和 `package:smoke` 均
已在当前 macOS arm64 环境通过。

当前没有 macOS 代码签名/公证身份或 Windows Authenticode 身份。`pnpm run package:signing -- darwin` 因缺少身份以退出码 2 结束，明确只允许 `unsigned-smoke`；`release:gate` 必须拒绝生产发布。

## 文档站实施验证（2026-08-22）

本次双语文档与静态站变更实际运行了以下门禁：

```sh
pnpm exec vitest run tests/bilingual-docs.test.ts tests/website-docs.test.ts
pnpm run docs:check
pnpm run docs:build
DOCS_BASE=/dsh-forge/ pnpm run docs:build
./node_modules/.bin/tsc -p tsconfig.json --noEmit
pnpm dlx @fission-ai/openspec@latest validate redesign-bilingual-documentation-site --type change --strict --no-interactive
git diff --check
```

文档站构建输出 14 个双语路由、raw Markdown twin 和 `llms.txt`，并通过站内链接、fragment、发布清单与 GitHub Pages base path 检查。构建只使用仓库内容和 website workspace 依赖，不读取 Electron、DSH Home、profile 产物或外部插件状态。

`pnpm run check:all` 曾在文档站变更期间运行但未通过：当时既有运行时测试要求官方外部 bundle
`dsh-better-sidebar` 的 catalog tier 为 `L1`，而 `catalog/catalog.yml` 记录为 `L0`，因此
compiler、composer、acceptance 和 profile selection 测试在该事实冲突处失败。当前发行 CI 变更已
按编译器契约将该外部 bundle 记录修正为 `L1`，本段保留历史验证事实，不代表当前门禁状态。

本次没有执行 GitHub Pages 实际部署、token/凭据验证、平台签名、公证、Authenticode 或生产发布 smoke；这些能力不属于本变更的授权范围。

当前仍没有 macOS 代码签名/公证身份或 Windows Authenticode 身份；本次 Electron 产物明确标记为
`unsigned-smoke`，不能作为生产发布证据。Windows 目标、macOS 签名/公证、native ABI 和
更新发布链路仍需在对应平台构建机与平台身份上执行。

## 官方 profile 发行验证（2026-08-21）

在本机 macOS arm64 对 `dsh-forge-official` 执行了 `profile:resolve`、`profile:verify`、config
dump、catalog 验证、`package:desktop`、`package:inspect` 和 `package:smoke`。当前方案先生成
独立 `desktop-deploy` staging，只复制 Electron 主进程所需的 production closure；profile 配置在
builder 阶段进入资源，`node_modules` 仅在最终应用生成后复制一次。产物中的
`Contents/Resources/dsh-forge/profile/node_modules` 是 profile 的完整闭包；Windows 产物对应路径为
可执行文件同级的 `resources/dsh-forge/profile/node_modules`。package inspect
在打包 Electron runtime 中通过 Cordis Loader 导入每个 profile entry，覆盖
`dsh-better-sidebar` 对 `@deepseek-ai/dsh-llm` 等 peer 的动态解析链。

本次 native evidence 以 `native-verification.darwin-arm64.json` 和
`package-smoke.darwin-arm64.json` 保存，记录 Electron `43.4.0`、ABI `148`，并引用同一 runtime
manifest 的 SHA-256 `f340ff5fc1afb36b76433611836e8087cacc797b7f67f3e08b653000891462e1`。manifest 与
evidence 均保存在对应 profile artifact 中，记录所有最终 `.node` 文件和 native helper 的安全相对路径、
可执行位与 SHA-256。`release:gate` 汇总 artifact 内按目标命名的 smoke evidence，并要求每个声明目标
都有独立的通过记录。

`darwin-x64` 与 `win32-x64` 没有本机 native evidence，仍是发布门禁。它们不得因本次
`darwin-arm64` smoke 通过而标记为已验证；`release:gate` 会继续拒绝缺少声明目标 evidence 的发布。

## GitHub Desktop Release CI（2026-08-22）

`add-github-desktop-release-ci` 引入 `.github/workflows/release-desktop.yml`，使用三个原生
runner 目标：`macos-14` 构建一个同时包含 `arm64/x64` 的 `darwin-universal`，`windows-2022`
构建 `win32-x64`，`ubuntu-22.04` 构建面向 Ubuntu 22.04 及以上 LTS 的 `linux-x64`。对应输出为
`universal.dmg`/zip、Windows x64 `nsis`/zip 和 Linux x64 `AppImage`/deb；每个目标还上传
`runtime-manifest.json`、`package-evidence.json`、native verification、smoke report、resolved
manifest、SBOM 输入和许可证通知。

工作流分为 `validate`、原生 `package` 矩阵和 `summary`/`release`。Pull request 与
`workflow_dispatch` 只执行 `validate`，不会启动 macOS、Windows 或 Linux runner；只有与
`distribution.yml.version` 一致的 `v*` tag 才启动三平台 package 和 summary。summary 使用
`pnpm run release:index` 检查三个目标是否齐全，并比较 distribution、version、profile、input
digest 及文件 SHA-256；缺少或漂移的 evidence 会阻止后续 job。普通 job 只有
`contents: read`，tag 打包只产生 run-scoped artifact。生产 Release 默认关闭；只有仓库变量
`DSH_FORGE_PRODUCTION_RELEASE=true`、签名/公证证据齐全且 `release:gate` 通过时，受保护的
release job 才会请求 `contents: write`。

工作流固定使用 Node.js `22.14.0` 和 pnpm `11.7.0`。pnpm 11.7 的 engine 下限为 Node
`>=22.13`，Node 20 缺少其使用的 `node:sqlite`，不能作为仓库安装或 CI runtime。

当前仍未配置或执行代码签名、公证和 Windows Authenticode。unsigned smoke artifact 可以用于
诊断和平台验证，但 `release:gate` 会拒绝未签名或缺少更新信任根的生产 Release。Linux 只承诺
Ubuntu LTS x64；未覆盖 ARM Linux、其他发行版和跨平台交叉编译。

### 跨平台打包入口诊断（2026-08-22）

桌面打包脚本不直接执行 pnpm 的 `node_modules/.bin` shim。profile composer 通过
`@deepseek-ai/dsh` 的 package manifest 解析真实 JS bin，Electron ABI 检查使用 Electron
package 返回的真实 runtime，electron-builder 使用其真实 JS CLI。ABI 子进程会清理继承的
`NODE_OPTIONS`，启动失败保留状态、signal、错误码以及截断后的 stdout/stderr；首次构建和
Universal 合并允许较长的 builder 超时。

本机 macOS ARM64 已验证 Electron `43.4.0` 输出 ABI `148`，并越过 ABI 检查进入 Universal
native rebuild。完整 Universal 构建未在本机完成，因为环境缺少 Xcode Command Line Tools；
GitHub `macos-14` runner 仍需执行 native rebuild 和真实安装包 smoke。Windows 的真实 runner
验证同样仍需通过 CI 完成。

### 三平台打包稳定性修复（2026-08-23）

此前 native rebuild 失败不是 `node-pty` ABI 本身不兼容，而是把 Electron runtime 镜像误用作
node-gyp headers 源。`npmmirror.com/mirrors/electron/` 的版本目录没有提供 node-gyp 需要的
匹配 headers 校验项，日志因此出现 `local checksum ... not match remote undefined`。当前脚本
将两类下载源分开：`ELECTRON_MIRROR` 仍可用于 Electron runtime，`ELECTRON_REBUILD_DIST_URL`
默认使用 `https://www.electronjs.org/headers`，替代地址必须提供同版本 headers 和
`SHASUMS256.txt`。

首次下载、`node-pty` 编译以及 macOS Universal 的两个架构重建共使用每架构 15 分钟预算；
超时仍失败，并记录有限 stdout/stderr、退出状态、signal、启动错误和 headers 地址。

profile lockfile 投影继续离线执行。profile 物化默认保持 `--offline --frozen-lockfile`；GitHub
Actions 显式设置 `DSH_FORGE_PROFILE_OFFLINE=false`，改用
`--prefer-offline --frozen-lockfile`，缓存缺失时只补下载 lockfile 指定 tarball，不重新解析
版本。该策略修复了 Windows runner 因 pnpm store 不完整而出现的
`PNPM_NO_OFFLINE_TARBALL`，也适用于首次运行的 macOS/Linux runner。

Universal staging 不能复用 arm64 profile 的 optional 依赖；打包脚本使用 pnpm 11 的
`--os=darwin --cpu=arm64 --cpu=x64` 在同一份 profile 中物化两套 optional 依赖。Universal
native staging 只暂存 node-pty 的 `pty.node`/`spawn-helper` 并写入对应 `prebuilds`，删除
`build/Release` 的 host-specific 输出；`@img/sharp-darwin-arm64/x64` 等架构专属包保持独立，
不再对完整 profile 或架构专属文件执行 `lipo`。native addon 完成受控
重建后，electron-builder 设置 `npmRebuild: false` 并传入 `--publish never`，避免重复扫描
profile 或因 Tag 隐式发布失败；Actions artifact 由独立 release job 处理。

### 跨平台 input digest（2026-08-24）

`inputDigest` 不再摘要当前 runner 已物化的 `dependencyClosure`。pnpm 会根据 OS/架构裁剪
`sharp`、`koffi` 等 optional native 包，直接摘要 node_modules 会让 macOS、Windows 和
Linux 的同一 profile 产生不同目录。现在摘要由 distribution、profile、bundle、构建授权和
根 `pnpm-lock.yaml` 的规范化 YAML 语义摘要组成，因此 checkout 换行符不会造成漂移，三个目标共享同一 profile artifact 路径；各平台实际
闭包仍写入对应的 `resolved-manifest.json`、SBOM 和许可证证据，profile verify 继续逐文件检查
同一 runner 上的真实闭包和锁文件。Release gate 在 Ubuntu 汇总 runner 上复核 Linux 目标的
resolved/SBOM/许可证证据，同时使用 macOS runtime manifest 和三个目标的 native/smoke evidence。

跨平台 builder 不再从根 package 的 `@dsh-forge/core` 名称推导可执行文件名，而是统一使用
`distribution.branding.productName`，Linux 的 `desktopName` 也使用该值。发行安装包文件名仅使用
稳定的 `distribution.id`、版本、平台和架构，不重复 profile 名称。profile verify 的临时 pnpm 安装预算
同步提高到 15 分钟，并保留安装进程的超时、signal 和头尾诊断，避免首次 CI 下载在 60 秒时被
误判为解析失败。

electron-builder 另使用 45 分钟预算。macOS Universal 会先生成架构临时应用，再合并应用资源并
压缩 DMG/zip；profile 闭包只在最终应用生成后复制一次。15 分钟预算可能在第二阶段触发
`ETIMEDOUT`（status 143），这不代表 native addon 编译失败。

### CI schema 与 Windows 路径修复（2026-08-23）

后续 Tag CI 证明前一轮修复仍有两个实现缺口。macOS 的配置同时包含 Linux/Windows 段，且将
只接受单个 glob 的 `mac.x64ArchFiles` 写为数组；electron-builder 26 因 schema 校验在打包前
停止。现在配置生成器只写入本次 runner 的平台段；Universal 保留 `mergeASARs: false`，同时以
单个 brace glob 设置 `x64ArchFiles`，覆盖 `app.asar.unpacked` 内目录名已编码 Darwin 架构的
native 包、所有 `prebuilds/darwin-*` 与已 universal 的文件。该规则避免 `@electron/universal`
将两份临时应用中相同路径的架构副本再次交给 lipo；profile closure 仍在 builder 完成后复制。

Windows 的 node-pty 重建此前直接在带 artifact digest 的 profile 路径执行，MSBuild 创建
native code analysis 与 file tracker 中间文件时出现 C1258/FTK1011。现在脚本将 profile 解引用
复制到系统临时目录的短路径，仅在该副本中重建；成功后只回写每个 `node-pty/build` 目录到正式
profile，且在成功、失败或超时后清理临时目录。该修复不改变 lockfile、profile 配置或安装包内
其他依赖。

本次仅能在本机完成 TypeScript、聚焦测试、electron-builder 配置 schema 和静态门禁验证；尚未
重新运行 GitHub 的 macOS/Windows 原生 runner。因此真实 Universal 安装包、Windows MSBuild
重建和三平台 smoke 仍需由下一次 `v*` Tag CI 作为验收证据。

### 短路径两阶段封装（2026-08-23）

profile 闭包注入发生在 electron-builder 生成已解包应用之后；若此时才生成 NSIS、ZIP、DMG、
AppImage 或 DEB，安装包不会遗漏 `dsh-forge/profile/node_modules`。脚本现先以 `dir` 目标在
仓库 `.desktop-work/<target>/unpacked` 中生成已解包应用，再在该短路径写入完整 profile 闭包、
runtime manifest 和 package evidence，最后以 electron-builder `--prepackaged` 封装请求的
分发格式。该目录对 Windows 的 ConPTY `OpenConsole.exe` 等深层 helper 保持在安全路径预算内，
并在当前 runner 中保留至 `package:inspect`、`package:smoke` 完成。

electron-builder 会递归主应用 package 的依赖，在 pnpm workspace 中可能将 profile 运行时再次写入
`app.asar`。脚本从已解析 profile 的 dependency closure 生成 builder 排除规则；DSH 与 profile
bundle 因此只由 `dsh-forge/profile/node_modules` 提供，主应用仍按 `desktop-deploy/package.json` 的
受控 production closure 解析。属于主应用 closure 的包不会被排除，避免削弱 launcher 或主进程。

electron-builder 设置 `executableName` 后会以该值生成 macOS `.app` 文件名。脚本、inspect 与
smoke 都从 `distribution.branding.productName` 使用同一个名称定位 `DSH Forge.app` 及其主程序，
避免 Universal `dir` 阶段成功后被错误报告为缺少应用。

同一应用名称也用于 Linux 的 package inspect 与 smoke 主程序定位。Electron 的 `libEGL.so`
等共享库可能带执行位，因此不得通过“目录中唯一可执行文件”推断 runner；检查只启动
`linux-unpacked/DSH Forge`，缺少该文件才报告 runner 缺失。

`.desktop-work/` 不进入 Git 或 Actions release artifact；它只承载本平台构建阶段的可执行
验证。跨 job 汇总继续传递最终安装包、runtime manifest、package evidence 与平台 smoke
evidence，不能将 `packageRoot` 视为另一台 runner 上可访问的路径。

### Linux Debian FPM 元数据修复（2026-08-23）

Linux 应用目录已能生成时，`.deb` 的 FPM 阶段仍会要求项目 URL 和维护者。独立
`desktop-deploy/package.json` 此前没有保留 `homepage`，根 package 也没有带邮箱的 author，
因此 electron-builder 在控制文件生成前停止。根 package 现在声明项目主页，staging 保留该字段；
Linux builder 从 `distribution.branding.publisher` 写入 `maintainer` 与 `vendor`，无需将个人邮箱
伪造为发行维护者。该变更仍须通过下一次 Ubuntu runner 的 AppImage/deb 实际构建验证。

### Windows Builder 7-Zip（2026-08-23）

Windows package job 两次在下载 `7zip-win-x64.tar.gz` 后，于 ZIP 阶段找不到
electron-builder 缓存内的 `7za.exe`。下载进度表明未命中工具 archive cache，而 Builder 对解压
目录只检查非空，不能确保预期可执行文件存在。随后将预装 `%ProgramFiles%\7-Zip\7z.exe` 提供给
Builder，日志仍在 Node `execFile` 启动该文件时返回 `ENOENT`；PowerShell 成功自检不能证明该执行
模型可用。workflow 现在下载 electron-builder 26.15.7 声明的 `7zip-win-x64.tar.gz`，用源码中的固定
SHA-256 校验下载结果，再以 `tar.exe` 解包到本次 workspace 下带 run id 的受控目录，并通过 Node
`spawnSync` 验证 `bin/7za.exe`。`pnpm install` 后和每次 Builder 调用前都会重复记录文件摘要、cwd、
Node 架构、`SystemRoot` 和启动结果；只有探针成功才继续调用 Builder。工作流仍不缓存
electron-builder 工具目录；Electron runtime 与 headers 缓存保持不变。该修复仍须由下一次 Windows
tag runner 实际生成 NSIS 和 ZIP 验收。

### Linux package smoke 显示服务器（2026-08-23）

Linux 的已打包应用会等待 Electron ready、创建 BrowserWindow 并等待 renderer 健康报告。无图形会话
的 Ubuntu runner 直接执行 smoke 时，Ozone X11 以 `Missing X server or $DISPLAY` 退出，这不是
安装包或 renderer 失败。workflow 对 `linux-x64` 改用 `xvfb-run --auto-servernum` 启动 smoke，并为
虚拟 X server 关闭 TCP 监听；macOS 和 Windows 仍直接使用各自原生显示会话。该修复保留 sandbox、
context isolation 和真实窗口加载，仍须由下一次 Linux tag runner 产生 AppImage/DEB 与 smoke evidence
验收。

### Linux launcher fallback（2026-08-23）

Xvfb 修复后，Linux smoke 已经能创建 Electron 窗口，但 DSH Host 从隔离的 DSH Home 加载 profile 时仍找不到
`@dsh-forge/desktop-services-local`。打包 profile 模板包含该 provider，受管 profile 的复制逻辑却会有意忽略
launcher 临时 fallback；启动时原本尝试建立到 `app.asar` 内 package 的文件系统链接。`app.asar` 是 Electron
虚拟文件系统，不能作为该链接和 ESM loader 的可靠解析根。现在打包将 desktop layer 与 local provider 放到
`resources/dsh-forge/launcher-fallback`，启动时从该真实目录复制到当前受管 profile。provider 的 Cordis、工具链
等依赖仍只从 profile 的闭包解析，避免重新携带 DSH runtime。该修复须由下一次 Linux package smoke 验收。

### macOS optional native inspect（2026-08-23）

macOS Universal profile 的 optional 依赖可同时包含 Linux musl、FreeBSD 与 OpenBSD 的预构建 `.node` 文件。
这些文件仍属于安装包闭包，必须保留路径、存在性和 SHA-256 校验，但不是 macOS Mach-O。此前 inspect 只识别
`darwin`、`win32` 和带分隔符的 `linux`，遗漏了 `linuxmusl`、`freebsd`、`openbsd`，因而错误调用 `lipo` 并报告
`NATIVE_ARCHITECTURE_MISMATCH`。现在它们被明确识别为非当前 target 平台，只有当前平台或未声明平台的 native
文件参与架构校验。该修复须由下一次 macOS Universal `package:inspect` 和 smoke 验收。

### macOS Universal native inspect（2026-08-23）

Universal profile 将 `node-pty` 的 arm64 与 x64 输出分别保存在 `prebuilds/darwin-arm64` 和
`prebuilds/darwin-x64`。runtime manifest 使用跨平台名称 `x64`，但 macOS `lipo -archs` 将对应
Mach-O 切片报告为 `x86_64`；此前 inspect 直接比较两者，因而把正确的 x64 预构建报为
`NATIVE_ARCHITECTURE_MISMATCH`。现在 Darwin inspect 仅在调用 lipo 时做该名称映射，仍逐一验证
每个预构建的摘要、相对路径、声明平台和实际切片。该修复须由下一次 macOS Universal CI 的
package inspect 与 smoke 验收。
