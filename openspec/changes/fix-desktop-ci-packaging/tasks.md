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
- [x] 3.4 配置 Universal 仅生成 mac 平台段并关闭 mergeASARs，保留架构专属 optional native 包
- [x] 3.5 删除 CI package job 中重复的 build/profile resolve/verify 步骤
- [x] 3.6 在 Windows 短临时路径重建 node-pty，并仅回写 build 输出
