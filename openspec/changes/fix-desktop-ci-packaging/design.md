## Context

当前 `scripts/package-desktop.ts` 将 `https://npmmirror.com/mirrors/electron/` 同时用于
Electron runtime 和 node-gyp headers。该镜像的 `SHASUMS256.txt` 不包含 node-gyp 需要的
headers 文件名，导致 `remote undefined`。另外 profile compiler 的物化阶段固定使用
`--offline`，而 Actions 的 pnpm store 缓存不是完整依赖镜像。

macOS Universal 还有一个独立问题：profile 首次物化发生在 arm64 runner，复制目录后只重建
`node-pty`，导致 `@img/sharp-darwin-arm64` 被错误地同时出现在两个 staging 中。lipo 不能把
两份相同架构文件合并；若没有 x64 optional 包，最终 Universal 应用也无法在 x64 上运行。

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

## Risks

- 官方 headers 服务不可达时，构建会失败；可通过同样提供 SHASUMS 的镜像覆盖环境变量。
- CI 允许补下载会增加首次运行时间，但避免把不完整缓存误判为依赖或代码错误。
