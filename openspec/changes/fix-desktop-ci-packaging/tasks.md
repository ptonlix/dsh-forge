## 1. 契约与实现

- [x] 1.1 新增 headers、超时和 profile 物化策略的 OpenSpec 契约
- [x] 1.2 修正 `scripts/package-desktop.ts` 的 headers URL、native rebuild 超时和诊断
- [x] 1.3 让 profile 物化按环境变量选择 offline/prefer-offline
- [x] 1.4 修正 Universal optional native 依赖隔离与 Mach-O 合并条件
- [x] 1.5 禁止 electron-builder 重复执行 native rebuild
- [x] 1.6 禁止 Tag 构建触发 electron-builder 隐式发布
- [x] 1.7 固定跨平台安全可执行文件名并延长 profile pnpm 安装预算
- [x] 1.8 延长 electron-builder Universal 产物阶段预算

## 2. CI 与验证

- [x] 2.1 在 workflow 中显式设置构建网络策略和 headers 地址
- [x] 2.2 增加 workflow/compiler/package 回归测试
- [x] 2.3 运行 typecheck、lint、聚焦测试、docs/diff 门禁并记录平台未覆盖项

## 3. 运行时闭包与打包性能优化

- [x] 3.1 生成独立 desktop-deploy production closure，移除根 node_modules runtime 副本
- [x] 3.2 builder 阶段只复制 profile 配置，最终应用生成后复制一次 profile 闭包
- [x] 3.3 将 Universal native staging 限制为 node-pty 输出并清理 host-specific build
- [x] 3.4 配置 Universal 仅生成 mac 平台段、关闭 mergeASARs 并使用单个 x64ArchFiles glob 保留架构专属 optional native 包
- [x] 3.5 删除 CI package job 中重复的 build/profile resolve/verify 步骤
- [x] 3.6 在 Windows 短临时路径重建 node-pty，并仅回写 build 输出
- [x] 3.7 为 Linux deb 注入 homepage、maintainer 与 vendor 元数据
- [x] 3.8 将 builder 改为短路径 `dir` 预构建与 `--prepackaged` 分发封装两阶段，确保闭包、inspect、smoke 和安装包使用同一应用
- [x] 3.9 按 electron-builder `executableName` 定位 macOS 已解包 `.app`，避免展示名称造成的假阴性
- [x] 3.10 让 Linux inspect 与 smoke 按发行版 id 定位主程序，排除共享库执行位造成的 runner 假阴性
- [x] 3.11 为 Windows Builder 配置经预检的系统 7-Zip，移除 Builder 工具缓存并增加 workflow 回归测试
- [x] 3.12 在 Linux package smoke 中提供隔离 Xvfb display，并增加 workflow 回归测试
- [x] 3.13 将 macOS inspect 的 x64 映射为 Mach-O x86_64，并覆盖 Universal node-pty 预构建
- [x] 3.14 以已校验的 Builder 7za archive 替换不可靠的 Windows 预装 7-Zip，并增加 Node spawn 预检
- [x] 3.15 为打包 launcher fallback 提供真实 resources 目录，并在启动时物化到受管 profile
- [x] 3.16 让 native inspect 跳过 macOS target 外的 optional 预构建架构检查
- [x] 3.17 统一应用、可执行文件与 Linux desktop entry 为 `branding.productName`，并删除 artifact 文件名中的重复 profile 标识
- [x] 3.18 限制 macOS Universal profile 的 optional native 依赖为 Darwin arm64/x64，删除非目标平台副本
- [x] 3.19 排除 profile dependency closure，避免主应用与 profile runtime 重复打包
- [x] 3.20 为三平台安装包和运行时窗口配置受控应用图标，并随包交付上游许可
