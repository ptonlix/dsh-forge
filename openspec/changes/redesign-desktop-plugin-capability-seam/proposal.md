## Why

`packages/desktop-plugin` 同时承载第三方 contract、Cordis bridge 和 launcher 本地实现，导致公开 exports 泄露 provider、手写声明与源码漂移，且安装事务和来源审计无法形成可验证的端到端语义。桌面服务已经成为 Fork 和 Host 插件的依赖面，必须在首个稳定协议前按 DeepSeek Harness 的 capability seam 模式重组。

## What Changes

- 将当前单一 `@dsh-forge/desktop-plugin` 拆分为公开服务定义、私有本地 provider 和由 desktop layer 加载的 Cordis provider plugin；删除旧包及其全部 exports，不保留运行时或类型兼容层。**BREAKING**
- 令 `desktop-layer` 成为本地 provider 的唯一 bundle 所有者和直接运行时依赖方；应用根 package 为 launcher 导入和发行物打包保留 provider 依赖，但其他 bundle 不得注册桌面 provider。
- 精简官方与开发 profile：保留显式的上游 `dsh-base`、`dsh-web-app` 运行基线，继续由 launcher 临时注入 desktop layer；删除没有 patch 或产品策略的空 `product-base` bundle。未来只有在同一变更中加入实际产品覆盖及其理由时才重新引入产品策略 bundle。
- 公开 `desktopProfiles`、`desktopPnpm` 和 `desktopServices` 的精确 TypeScript 合同、Cordis `Context` 声明、协议协商和过期 generation 失败语义；消费者只依赖服务定义包。
- 将 provider 的 operation 所有权覆盖 pnpm 执行、reconcile、安装后健康检查、receipt 或恢复完成，防止同一 generation 的后续操作进入未完成事务。
- 将安装请求绑定到已验证的静态 catalog、明确用户确认、精确 SemVer（包含 prerelease）和可验证来源/完整性；WAL、receipt 和人工恢复事实记录同一已解析来源。
- 统一为 ESM、构建生成的 declarations、显式 exports 和 package-local README；以中文 JSDoc 记录服务的时序、失败、所有权和非隔离限制，删除手写镜像声明与叙事性注释。
- 为服务定义、provider lifecycle、真实 Cordis Loader、安装准入、README 示例和发布 exports 建立定向测试与门禁。

## Capabilities

### New Capabilities

- `desktop-capability-seam`: 定义桌面服务的公开服务定义、本地 provider、Cordis 注册、协议协商、包导出和文档契约。

### Modified Capabilities

- `desktop-plugin-services`: 收紧 profile 与 package operation 的类型、完整 operation 串行化、取消、安装和过期 generation 行为。
- `plugin-trust-policy`: 要求交互式安装将 catalog 审计事实、用户确认、来源和完整性绑定至实际解析结果。

## Impact

- 删除 `packages/desktop-plugin`，新增公开 `packages/desktop-services`、私有 `packages/desktop-services-local`；`packages/bundles/desktop-layer` 改为唯一直接依赖并加载本地 provider。移除当前没有实际产品覆盖的 `packages/bundles/product-base` 及其在官方/开发 profile 中的选择；同步调整 `apps/desktop`、workspace、profile 工具和测试。
- Fork 与第三方 Host 插件改为从新的公开服务包导入，并通过 Cordis `Context` 注入消费服务；不能再导入 provider 或 launcher factory。
- `docs/design/dsh-forge.md`、`docs/reference/foundation-contracts.md`、工程边界文档和各包 README 改为新的单一事实来源；文档检查增加 exports、示例和链接验证。
