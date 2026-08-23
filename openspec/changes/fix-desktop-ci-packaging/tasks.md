## 1. 契约与实现

- [x] 1.1 新增 headers、超时和 profile 物化策略的 OpenSpec 契约
- [x] 1.2 修正 `scripts/package-desktop.ts` 的 headers URL、native rebuild 超时和诊断
- [x] 1.3 让 profile 物化按环境变量选择 offline/prefer-offline
- [x] 1.4 修正 Universal optional native 依赖隔离与 Mach-O 合并条件
- [x] 1.5 禁止 electron-builder 重复执行 native rebuild
- [x] 1.6 禁止 Tag 构建触发 electron-builder 隐式发布

## 2. CI 与验证

- [x] 2.1 在 workflow 中显式设置构建网络策略和 headers 地址
- [x] 2.2 增加 workflow/compiler/package 回归测试
- [x] 2.3 运行 typecheck、lint、聚焦测试、docs/diff 门禁并记录平台未覆盖项
