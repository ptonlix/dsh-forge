## 1. 官方输入

- [x] 1.1 将精确的 `dsh-dream-skin@8.28.0` 加入根受控依赖与官方 profile，保持
  `desktop-layer` 仅由 launcher 临时注入。
- [x] 1.2 新增 L1 catalog 审计条目，记录来源、integrity、许可证、能力、审核和当前
  平台验证事实。

## 2. 契约验证

- [x] 2.1 更新 profile/compiler、组合和真实 Host Loader 测试，验证 Dream Skin
  profile-local 物化和唯一 entry 激活。
- [ ] 2.2 运行 catalog、profile resolve/verify、config dump、定向测试、文档检查和
  `git diff --check`，记录未执行的桌面打包与多平台 smoke。
