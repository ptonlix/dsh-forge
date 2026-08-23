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
- 将 profile 临时物化的 pnpm 安装超时提高到 15 分钟，并保留超时、signal 和安装输出诊断。
- 将 electron-builder 的产物复制、Universal 合并和压缩预算提高到 45 分钟，避免大体积
  profile 在 macOS Universal 第二阶段被脚本误杀。
- 将 native rebuild 超时提高到足以覆盖首次 headers 下载和架构编译的预算，并保留结构化
  启动、状态、signal 和有限输出诊断。
- profile lock 继续离线生成，profile 物化安装默认优先使用本地 store；CI 可显式关闭严格
  离线，在 lockfile 冻结和 integrity 校验下补下载缺失 tarball。
- CI 声明 profile 安装策略、headers 地址和 pnpm store 缓存，避免不同 runner 隐式继承本机
  配置。

## Non-goals

- 不实现代码签名、公证、Windows Authenticode 或更新服务。
- 不放宽 frozen lockfile、catalog integrity 或 profile artifact 漂移校验。
