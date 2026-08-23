## Context

当前 `scripts/package-desktop.ts` 将 `https://npmmirror.com/mirrors/electron/` 同时用于
Electron runtime 和 node-gyp headers。该镜像的 `SHASUMS256.txt` 不包含 node-gyp 需要的
headers 文件名，导致 `remote undefined`。另外 profile compiler 的物化阶段固定使用
`--offline`，而 Actions 的 pnpm store 缓存不是完整依赖镜像。

macOS Universal 还有一个独立问题：profile 首次物化发生在 arm64 runner，复制目录后只重建
`node-pty`，导致 `@img/sharp-darwin-arm64` 被错误地同时出现在两个 staging 中。lipo 不能把
两份相同架构文件合并；若没有 x64 optional 包，最终 Universal 应用也无法在 x64 上运行。

后续 CI 验证还暴露了两个构建系统边界：electron-builder 26 会校验配置中的全部平台段，
而 `mac.x64ArchFiles` 只接受单个 glob。即使 `mergeASARs: false`，`@electron/universal` 仍会
处理 `app.asar.unpacked` 内的 Mach-O 文件，因此必须用该规则跳过已按目录隔离的 native 副本；
Windows 的 MSBuild 则会在 `node-pty/build` 写入分析与追踪文件，artifact digest 与嵌套依赖
路径超过其可用路径上限时会以 C1258/FTK1011 失败。

Linux 的 `.deb` 目标还会进入 electron-builder 的 FPM 元数据校验。独立 desktop-deploy 的
package metadata 未携带 `homepage`，且根 package 没有带邮箱的 author；若不提供 Linux
maintainer，FPM 会在应用目录已生成后拒绝生成 Debian 控制文件。

## Decisions

1. Electron runtime 下载与 native headers 下载分离。builder 继续使用
   `ELECTRON_MIRROR`；rebuild 使用 `ELECTRON_REBUILD_DIST_URL`，默认值为
   `https://www.electronjs.org/headers`。替代镜像必须提供按版本目录组织的 headers 和
   `SHASUMS256.txt`。
2. native rebuild 每个架构使用 15 分钟预算。首次 Universal 构建允许下载、编译和 lipo
   合并，超时仍失败，不把部分 `.node` 视为成功。
3. lockfile 解析保持 offline，防止重新解析依赖；profile 物化由
   `DSH_FORGE_PROFILE_OFFLINE` 控制，默认 `true` 以保留本地可复现行为，CI 设置为 `false`
   并使用 `--prefer-offline --frozen-lockfile`，缺包时只下载锁定输入。
4. CI 的 package、validate 和 summary job 使用同一 profile 安装策略，并在 workflow 中
   明确 headers URL；package 矩阵总预算为 90 分钟，不向 PR 注入签名凭据。
5. 打包先生成独立 `desktop-deploy` staging，只复制 Electron 主进程的 production
   dependency closure；profile 在 builder 阶段只携带配置文件，最终应用生成后再复制一次
   完整 profile 闭包。Universal 使用同一份 profile lockfile 和 pnpm 11 的重复
   `--cpu=arm64 --cpu=x64` 选项物化 optional 依赖；native staging 只保存 node-pty 的两个
   架构输出，并写入对应 `prebuilds`，不再复制完整 profile 两份或对 sharp 等架构专属文件
   执行 lipo。host-specific `node-pty/build/Release` 输出必须删除。
6. 生成的 electron-builder 配置设置 `npmRebuild: false`。native addon 已由脚本按目标 ABI
   重建，builder 只负责打包和格式生成，避免二次 rebuild 受 workspace 依赖扫描影响。
7. builder 命令固定传入 `--publish never`。Tag 只决定 workflow 是否进入 package job，实际
   Release 由后续 job 统一发布，避免构建阶段因 GitHub 权限或隐式发布状态失败。
8. builder 配置显式使用 `distribution.id` 作为 `executableName` 和 Linux `desktopName`，
   不从带 scope 的根 package 名称推导文件名。profile 的 pnpm 物化和 verify 临时安装共用
   15 分钟超时，并在失败时保留头尾诊断。
9. native rebuild/profile 安装与 electron-builder 使用分离预算：前者为 15 分钟，后者为
   45 分钟。后者覆盖 Universal 临时应用复制、双架构合并、asar 生成和 DMG/zip 压缩。
10. 发布运行时不再提供 `dsh-forge/runtime` 的根 node_modules 副本；DSH runtime 只从
    `dsh-forge/profile/node_modules` 解析，主进程依赖只存在于 app.asar 的 production closure。
11. electron-builder 配置只生成当前 runner 对应的 `mac`、`win` 或 `linux` 段。Universal
    使用 `mergeASARs: false`，并设置单个 `x64ArchFiles` brace glob 覆盖目录名已编码 Darwin
    架构的包、所有 `prebuilds/darwin-*` 与已 universal 的文件；`@electron/universal` 因而保留
    两套架构文件，不会对相同路径的副本再次执行 lipo。
12. Windows 重建前将 profile 解引用复制到系统临时目录的短根路径。重建成功后，按相对目录
    逐个替换正式 profile 中对应 `node-pty/build`，不使用临时副本覆盖 lockfile、配置或其他
    依赖；无论成功、失败或超时都清理临时目录。
13. 根 package 声明项目主页，desktop-deploy 保留该元数据；Linux 配置从
    `distribution.branding.publisher` 写入 `maintainer` 与 `vendor`。这满足 FPM 的 URL 和
    维护者要求，不要求为发行身份捏造个人 author 邮箱。
14. electron-builder 分两阶段运行。第一阶段只请求 `dir`，输出到仓库受控的
    `.desktop-work/<target>/unpacked` 短路径；脚本在此目录注入完整 profile 闭包、生成
    runtime manifest 和 package evidence。第二阶段以该应用目录为 `--prepackaged` 输入，
    仅在 artifact 的 `desktop-dist` 输出 DMG/ZIP、NSIS/ZIP 或 AppImage/DEB。工作目录保留到
    当前 job 的 inspect/smoke 结束，由下次同目标构建覆盖、由 CI runner 在 job 结束时清理。
    因此分发格式不会在 profile 闭包尚未存在时被提前生成，Windows 的 `OpenConsole.exe`
    也始终位于短路径的已解包应用中。
15. `executableName` 同时决定 macOS 的 `productFilename`，因此已解包 `.app` 定位统一使用
    `distribution.id`，不能使用展示名称 `branding.productName`。这使第一阶段的
    `dsh-forge-official.app` 能被稳定作为 `--prepackaged` 输入。
16. package inspect 与 smoke 从 runtime manifest 或 distribution 配置读取 `distribution.id`，
    并按平台计算唯一主程序路径。Linux `.so` 文件可能设置执行位，不能以“目录中唯一可执行
    文件”作为 runner 判据；动态 Cordis 导入仍必须在真实 Electron runtime 中执行。
17. Windows Builder 的 ZIP 阶段两次在新下载 `7zip-win-x64.tar.gz` 后仍以 `ENOENT` 找不到
    electron-builder 缓存中的 `7za.exe`。`windows-2022` 镜像已预装 7-Zip，package job 因此先
    验证 `%ProgramFiles%\7-Zip\7z.exe` 能执行，再写入 `ELECTRON_BUILDER_7ZIP_PATH`。Builder
    直接使用该受控路径，不再解压临时 7-Zip；工作流也不缓存 electron-builder 的工具目录，避免
    把不完整工具状态带入后续 job。
18. Linux package smoke 会执行 `app.whenReady()`、创建受 sandbox 和 context isolation 约束的
    `BrowserWindow`，因此不能在无 `DISPLAY` 的 Ubuntu runner 直接启动。Linux workflow step 使用
    `xvfb-run --auto-servernum` 创建只供该命令使用的 Xvfb display，并关闭 TCP 监听；不以
    `--headless`、`--no-sandbox` 或跳过窗口替代真实 renderer 健康握手。
19. runtime manifest 的目标架构使用跨平台名称 `x64`，但 macOS `lipo -archs` 返回 Mach-O 名称
    `x86_64`。inspect 在 Darwin 上比较 native 文件切片时将前者映射为后者；路径已编码
    `darwin-x64` 的 node-pty 预构建只验证 x86_64 切片，仍保留摘要、路径、平台和 arm64 预构建
    的独立校验。

## Risks

- 官方 headers 服务不可达时，构建会失败；可通过同样提供 SHASUMS 的镜像覆盖环境变量。
- CI 允许补下载会增加首次运行时间，但避免把不完整缓存误判为依赖或代码错误。
- 已解包工作目录只在构建 runner 生命周期内有效；跨 job 的 release 汇总继续以各平台
  inspect/smoke 证据与最终分发包为输入，不能将本机 `packageRoot` 当作可迁移路径。
- `windows-2022` 若移除预装 7-Zip，预检会在打包前以明确路径失败；升级 runner 时必须先确认
  对应镜像继续提供可执行的 7-Zip，不能回退到 Builder 的临时下载作为静默后备。
- `ubuntu-22.04` 若不再提供 `xvfb-run`，Linux smoke 会在启动前以明确缺失命令失败；升级 runner
  时必须恢复等价的隔离显示服务，而不能把 BrowserWindow smoke 改为无窗口检查。
