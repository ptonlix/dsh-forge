## Why

三平台 tag 打包在干净 GitHub runner 上仍可能失败：`@electron/rebuild` 使用不提供匹配
SHASUMS 的通用 Electron 镜像，node-gyp 因远端校验值为空拒绝 Electron 头文件；profile
物化又强制 `pnpm --offline`，pnpm store 未命中时无法获取锁定 tarball。

## What Changes

- 为 Electron native rebuild 使用明确的 headers endpoint，默认采用 Electron 官方 headers
  服务，仍允许通过环境变量替换为兼容的内部镜像。
- 为 macOS Universal staging 按 lockfile 在同一份 profile 中安装 arm64/x64 两套 optional
  native 依赖，仅暂存 node-pty 的两个架构输出；sharp、ripgrep、koffi 等架构专属包保持独立路径，
  不再对完整 profile 或架构专属文件执行 lipo。
- 为 Electron 主进程生成独立 `desktop-deploy` production closure，删除根 `node_modules` 的
  第二份 runtime 复制；profile 在 builder 阶段只复制配置，最终应用生成后复制一次完整闭包。
- 禁止 electron-builder 再次隐式执行 native rebuild，避免与受控 rebuild 重复安装和扫描
  workspace/profile 依赖。
- package job 显式关闭 electron-builder 的 Tag 隐式发布；Release job 统一消费并发布已验证
  的 Actions artifact。
- 为 Linux/Windows 显式设置不含 scope 的可执行文件名，避免 electron-builder 从根 package
  名称推导出非法路径。
- 只向 electron-builder 写入当前目标平台的配置，并为 Universal 使用一个覆盖目录隔离 native
  包的 `x64ArchFiles` minimatch 字符串，避免 schema 校验或重复 lipo 阻断打包。
- Windows 在短临时路径中重建 `node-pty`，只将受控 `build` 输出回写正式 profile，避免
  MSBuild 在 artifact digest 与嵌套依赖构成的长路径中创建中间文件失败。
- 为独立 desktop-deploy 保留项目主页，并从发行 branding 写入 Linux maintainer/vendor，满足
  electron-builder FPM 生成 Debian 控制文件的强制元数据。
- 将 profile 临时物化的 pnpm 安装超时提高到 15 分钟，并保留超时、signal 和安装输出诊断。
- 将 electron-builder 的产物复制、Universal 合并和压缩预算提高到 45 分钟，避免大体积
  profile 在 macOS Universal 第二阶段被脚本误杀。
- 将 native rebuild 超时提高到足以覆盖首次 headers 下载和架构编译的预算，并保留结构化
  启动、状态、signal 和有限输出诊断。
- 将 desktop 构建拆分为已解包应用和分发格式两个阶段：先在仓库短路径工作目录生成 `dir`
  产物并注入 profile 闭包，再以 `--prepackaged` 生成最终安装包，避免 Windows profile
  helper 超长路径，也确保 NSIS、ZIP、DMG、AppImage 和 DEB 都包含完整运行时。
- profile lock 继续离线生成，profile 物化安装默认优先使用本地 store；CI 可显式关闭严格
  离线，在 lockfile 冻结和 integrity 校验下补下载缺失 tarball。
- CI 声明 profile 安装策略、headers 地址和 pnpm store 缓存，避免不同 runner 隐式继承本机
  配置。

## Non-goals

- 不实现代码签名、公证、Windows Authenticode 或更新服务。
- 不放宽 frozen lockfile、catalog integrity 或 profile artifact 漂移校验。
