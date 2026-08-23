## Why

三平台 tag 打包在干净 GitHub runner 上仍可能失败：`@electron/rebuild` 使用不提供匹配
SHASUMS 的通用 Electron 镜像，node-gyp 因远端校验值为空拒绝 Electron 头文件；profile
物化又强制 `pnpm --offline`，pnpm store 未命中时无法获取锁定 tarball。

## What Changes

- 为 Electron native rebuild 使用明确的 headers endpoint，默认采用 Electron 官方 headers
  服务，仍允许通过环境变量替换为兼容的内部镜像。
- 为 macOS Universal staging 按 lockfile 安装 arm64/x64 两套 optional native 依赖，只对
  两个架构的互补 Mach-O 文件执行 lipo；架构专属包保持独立路径。
- 禁止 electron-builder 再次隐式执行 native rebuild，避免与受控 rebuild 重复安装和扫描
  workspace/profile 依赖。
- package job 显式关闭 electron-builder 的 Tag 隐式发布；Release job 统一消费并发布已验证
  的 Actions artifact。
- 将 native rebuild 超时提高到足以覆盖首次 headers 下载和架构编译的预算，并保留结构化
  启动、状态、signal 和有限输出诊断。
- profile lock 继续离线生成，profile 物化安装默认优先使用本地 store；CI 可显式关闭严格
  离线，在 lockfile 冻结和 integrity 校验下补下载缺失 tarball。
- CI 声明 profile 安装策略、headers 地址和 pnpm store 缓存，避免不同 runner 隐式继承本机
  配置。

## Non-goals

- 不实现代码签名、公证、Windows Authenticode 或更新服务。
- 不放宽 frozen lockfile、catalog integrity 或 profile artifact 漂移校验。
