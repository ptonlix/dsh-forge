## 1. 建立公开 capability 定义包

- [x] 1.1 创建 `packages/desktop-services` 的 ESM、NodeNext 构建、受限 exports 和仅构建产物 declarations，移除手写 `.d.ts` 发布面。
- [x] 1.2 定义 `desktopProfiles`、`desktopPnpm`、`desktopServices`、协议断言、profile 快照、判别命令请求、operation 和已确认安装请求的公开类型。
- [x] 1.3 为公开桌面服务补充 Cordis `Context` 声明，并建立干净 NodeNext consumer fixture，验证类型与运行时 exports 一致。
- [x] 1.4 编写 `desktop-services/README.md`，覆盖 consumer 导入、injection、协议协商、时序、失败、非隔离限制和可编译示例。

## 2. 实现本地 Cordis provider

- [x] 2.1 创建私有 `packages/desktop-services-local`，实现默认 Cordis provider plugin 与仅 launcher 使用的 capability factory export。
- [x] 2.2 将 profile 列表、快照和选择逻辑迁移为 generation-scoped Cordis service，确保 dispose 后方法失败且不会改变新 generation。
- [x] 2.3 将进程树、WAL 快照与恢复逻辑迁移为 provider 内部实现，并以 `ctx.effect()` 或等价 service lifecycle 统一所有权和 teardown。
- [x] 2.4 实现 package operation lease，使 busy 状态覆盖 spawn、进程树退出、reconcile、来源校验、健康检查、receipt 或恢复的完整路径。
- [x] 2.5 用判别联合替换原始 pnpm 参数数组和 `object` 选项，拒绝任何未建模的依赖或锁文件修改命令。
- [x] 2.6 编写 `desktop-services-local/README.md`，说明 launcher 注入前提、生命周期、进程树、WAL 范围、来源校验与维护验证。

## 3. 收紧安装准入与审计事实

- [x] 3.1 将 catalog confirmation 改为生成绑定 catalog 条目、profile 和确认时间的不可变已确认安装请求，并在 provider 启动前验证该请求。
- [x] 3.2 使用严格 SemVer 解析器验证确定版本，支持 prerelease/build metadata，拒绝 range、tag、workspace 和 file alias。
- [x] 3.3 依据 catalog 来源构造 registry 或完整 Git commit 安装 spec，并在 pnpm 完成后校验 lockfile 的名称、版本、来源与完整性。
- [x] 3.4 扩展 WAL、失败记录与 receipt，使其保存已确认事实和实际解析事实；来源漂移、健康失败、取消和未知 lockfile 均进入恢复或人工恢复状态。

## 4. 迁移 composition 与删除旧包

- [x] 4.1 更新 `apps/desktop`，使其只注入私有 launcher capability，并由 desktop layer 的本地 provider 发布 Cordis services。
- [x] 4.2 更新 `packages/bundles/desktop-layer`、catalog、profile 工具、workspace 依赖和构建脚本，使其使用新 package 名称与 exports；desktop layer 直接依赖并注册本地 provider，应用根 package 保留 provider 的打包依赖。
- [x] 4.3 从官方与开发 profile 移除空 `product-base`，删除该 bundle、其 workspace/根 package 依赖和文档引用；重新生成 profile 解析证据，保持 `dsh-base -> dsh-web-app -> desktop layer` 的运行顺序。
- [x] 4.4 删除 `packages/desktop-plugin`、旧 bundle 引用、手写声明、历史 exports 和所有不再有效的路径引用，不保留兼容 re-export。
- [x] 4.5 扩展依赖边界门禁，允许 `apps/desktop` 使用 local launcher export，允许仅 `desktop-layer` 直接依赖本地 provider，拒绝其他 bundle、feature、generator 和第三方 fixture 导入本地 provider。

## 5. 同步文档与代码表达

- [x] 5.1 更新顶层设计、基础契约参考和工程边界文档，分别链接公开 contract、provider 所有权、来源校验和 `trusted-in-process` 限制的唯一事实来源；删除空 product-base 的描述，说明产品策略 bundle 只在有实际覆盖时进入 profile。
- [x] 5.2 审阅新旧模块的中文 JSDoc 与注释，保留参数、返回、失败、时序、所有权和安全限制，删除控制流复述与镜像声明。
- [x] 5.3 扩展文档检查，验证桌面服务 README 的标记 TypeScript 示例、公开 import、链接和已删除路径。

## 6. 验证

- [x] 6.1 为 protocol 协商、generation 过期、同目标/异目标 profile 选择、完整 operation lease、取消和 dispose 增加定向单元测试。
- [x] 6.2 为 catalog 确认、预发布版本、来源/完整性漂移、非零 pnpm、健康失败、未知 lockfile 和 WAL 恢复增加安装事务测试。
- [x] 6.3 使用真实 Cordis Loader 和 profile-local package fixture 验证 provider 注册、公开 consumer、过期服务和私有路径拒绝；验证 profile 仅持久化上游基线、provider 仅由 desktop layer 注册，且没有空 product-base bundle 或桌面服务依赖残留。
- [x] 6.4 运行 package build、NodeNext consumer、相关服务测试、Loader smoke、边界检查、文档检查、`git diff --check` 与 OpenSpec 严格验证，并记录实际结果。

## 本次验证记录

- `pnpm run build`：通过。
- `pnpm run check:all`：通过，包含类型检查、lint、54 个 Vitest 测试、profile 解析与验证、catalog、边界和文档检查。
- `pnpm run test:desktop-services-consumer`：通过。
- `pnpm run test:desktop-services-local`：通过，9 个服务/事务测试。
- `pnpm exec vitest run tests/desktop-loader.test.ts tests/desktop-boundary.test.ts`：通过，5 个 Loader 与边界测试。
- `git diff --check`：通过。
