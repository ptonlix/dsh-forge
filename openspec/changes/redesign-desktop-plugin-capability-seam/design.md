## Context

当前 `@dsh-forge/desktop-plugin` 将三种变化速率不同的职责放在同一 package：第三方依赖的 type contract、由 Cordis Loader 执行的 bridge，以及 Electron launcher 使用的 profile/pnpm provider。它的根 exports 因此成为事实上的 provider API，`contracts/index.d.ts` 又成为与 TypeScript 源码并行的第二份声明来源。安装流程的 raw pnpm operation 先释放 busy 标记，随后才完成 reconcile、健康检查和恢复。

本设计采用 DeepSeek Harness 的 capability seam 方式：服务定义与 consumer 共同演进，本地 provider 承担环境和生命周期，launcher 只提供 Host 事实。它不复制上游目录或发布策略；DSH Forge 保持私有 monorepo、Electron generation 和 `trusted-in-process` 的既有边界。

## Goals / Non-Goals

**Goals:**

- 建立服务定义、Cordis provider、launcher 事实三层单向依赖。
- 使第三方 consumer 只依赖一个 ESM package 和稳定的 Cordis service 名称。
- 把 package operation 的锁、取消、恢复和 receipt 统一为一个完成语义。
- 让 catalog 的来源、完整性和用户确认成为安装输入，而不是展示字段。
- 将 README、JSDoc、exports、构建 declarations 和外部 consumer 测试收敛为同一公开接口。

**Non-Goals:**

- 不为不可信 Node 插件提供进程隔离，不改变 `trusted-in-process` 的安全声明。
- 不增加在线市场、自动安装、远程 package provider、Tauri adapter 或桌面 Web Client。
- 不保留旧 `@dsh-forge/desktop-plugin` 的重导出、路径别名或兼容类型。

## Decisions

### 1. 以 capability、实现机制和加载角色划分 workspace

替换当前包为以下布局：

```text
packages/
├── desktop-services/
│   ├── src/index.ts                 # 公开 types、协议和 Context 声明
│   ├── README.md                    # consumer API 与限制
│   └── package.json                 # 唯一第三方桌面服务依赖
├── desktop-services-local/
│   ├── src/index.ts                 # Cordis provider plugin 默认导出
│   ├── src/launcher.ts              # 仅 apps/desktop 使用的 capability factory
│   ├── src/profiles.ts
│   ├── src/packages.ts
│   ├── src/recovery.ts
│   ├── src/process-tree.ts
│   ├── README.md                    # provider 所有权、恢复与限制
│   └── package.json
└── bundles/desktop-layer/
    └── cordis.patch.yml             # 仅加载 desktop-services-local
```

`desktop-services` 是发布给 Fork 与第三方 Host 插件的服务定义包。它声明 `Context.desktopProfiles`、`Context.desktopPnpm` 和 `Context.desktopServices`，导出冻结 descriptor、协议断言、profile 数据类型、判别命令请求、已确认安装请求和 operation 类型。

`desktop-services-local` 是私有 workspace package。它只依赖公开定义包和 launcher 私有 capability；默认 export 是 Cordis provider plugin，`./launcher` 是应用内部的显式 export。`apps/desktop` 可使用该内部 export，但 bundle、feature、generator 和第三方 package 不可使用。目录边界检查根据 package consumer 分类拒绝这种反向依赖。

`desktop-layer` 从 `@dsh-forge/desktop-services-local` 加载 provider。旧 `packages/desktop-plugin` 在同一迁移中删除，package、bundle、测试、catalog 和文档引用同步替换。

`desktop-layer` 是本地 provider 的唯一 bundle 所有者：它的 package manifest 直接依赖 `@dsh-forge/desktop-services-local`，其 patch 注册该 provider。应用根 package 为 launcher 导入和发行物打包保留本地 provider 的直接依赖，但这不改变 provider 的 bundle 加载所有权。

官方与开发 profile 继续显式选择 `@deepseek-ai/dsh-base` 和 `@deepseek-ai/dsh-web-app`，因为 bundle 的 package 依赖不会使 DSH Loader 自动选择或执行它的 patch；desktop layer 仍由 launcher 紧随 Web bundle 临时插入。当前 `product-base` 的 patch 为空，没有实际产品默认值或策略，保留它只会扩大 profile 的依赖闭包、锁文件和审计输入。本变更删除该 bundle 与两个 profile 中的选择，而不是将其改为桌面服务依赖。未来产品策略 bundle 必须与至少一项实际覆盖、完整 patch 值和偏离理由在同一变更中引入；空的扩展锚点不得进入 profile。

不采用“保留 desktop-plugin 并新建 contracts 子包”的方案：根入口仍需同时承担 Cordis plugin 与 launcher factory，会继续把 provider 误暴露为公共接口。也不为 profile 与 pnpm 拆成四个小包，因为它们共享 generation、安装协调器和桌面发布节奏，当前没有独立 consumer。

### 2. 由 Cordis service 所有 lifecycle，launcher 只提供事实

每次 generation 创建一个只读 `DesktopHostCapability`，其中包含 profile 清单、profile transition 请求、受控 package manager、catalog 安装授权验证和 generation lifecycle hooks。它只在 launcher prepare 阶段以私有 service 名注册。

本地 provider plugin 声明该私有 injection，并在 active Cordis context 中构造 profile service、package service 和 descriptor service。服务以 Cordis `Service` 或等价的 `ctx.effect()` 机制注册；其 disposer 负责关闭接受新请求、取消活动 operation、等待进程树与事务 finalization。generation 销毁 Host context 时，Cordis fiber 先执行服务 disposer，随后 launcher 才继续状态转换。

```text
apps/desktop
  -> private DesktopHostCapability
  -> Host prepare context
  -> desktop-services-local provider plugin
  -> desktopProfiles / desktopPnpm / desktopServices
  -> third-party Host plugin
```

`desktopServices` 是只读 descriptor，不是权限控制器。它包含协议主版本、发行的 service 名称和 `trusted-in-process` 执行模式。consumer 通过公开 `assertDesktopServicesProtocol()` 显式协商；不兼容时失败，不猜测新旧字段。

### 3. 以 lease 表示完整 package operation

`desktopPnpm` 不再接收原始 `string[]` 或 `object`。公开请求采用判别联合，例如只读检查、受控 reconcile、受控卸载和 catalog 安装；每个变体拥有明确参数、允许副作用和错误码。需要新增操作时先扩展联合、README 和测试，不能把任意 pnpm 参数重新暴露给插件。

provider 在接受请求后获取 generation 单例 lease。lease 从前置校验开始持有，到 returned operation 的 `done` 最终结算才释放：

```text
validate
  -> acquire lease
  -> spawn managed process tree
  -> wait tree exit
  -> reconcile / verify resolved source
  -> next-generation health check
  -> write receipt OR restore WAL
  -> settle public done
  -> release lease
```

取消和 generation dispose 使用同一个 finalization path。它们先阻止新 lease，再取消树、等待进程退出，并在安装曾修改 profile 时执行恢复或记录人工恢复。任何 finalization 进行中，第二个请求均返回 busy 错误。这样 public `done` 既是调用方等待点，也是 provider 的并发边界。

### 4. 安装请求由 catalog confirmation 派生并校验解析结果

`installationConfirmation()` 改为生成不可变、带内部品牌的 `ConfirmedPluginInstall`。它绑定 catalog entry ID、目标 profile、包名、严格 SemVer、来源、完整性、允许构建脚本和用户确认时间。只有 catalog trust 模块可以生成该值；local provider 在开始前验证品牌、profile 和 catalog snapshot 一致性。

安装 provider 根据 catalog source 构造实际 package spec：registry 条目使用被确认的 registry/source 约束，Git 条目使用完整 commit。pnpm 完成后解析受保护 profile 的 lockfile，比较名称、版本、tarball integrity 或 Git commit；任何不匹配都进入 WAL 恢复，不能写成功 receipt。receipt 保存确认事实和实际解析事实，便于诊断与重新审核。

严格版本使用成熟 SemVer 解析器检查“单一确定版本”，允许 prerelease 和 build metadata，拒绝 range、tag、workspace 与 file alias。禁止调用方以 `source` 字符串覆盖 catalog 事实。

选择内部品牌而非把确认仅表示为 `userConfirmed: true`：同进程代码可以绕过任何 JavaScript 对象保护，品牌不是安全隔离；它仍能消除普通调用路径把展示字段当授权的错误，并让测试和审计能区分已确认输入。README 必须明确这一限制。

### 5. 统一 ESM、注释、README 与验证规范

两个新 package 都使用 `type: module`、NodeNext 编译、显式 `exports` 和 emitted `dist` declarations。`package.json` 不引用源码根部的 `.d.ts`，不手写声明镜像；构建后用临时 NodeNext consumer 编译验证每个公共 export。所有跨包源码导入使用 package name，包内相对 import 保留 `.ts` 后缀并由编译器重写。

JSDoc 与中文 README 按职责分层：

- 公开 service method 说明参数、返回、可能失败、取消、时序、持久化和调用方责任。
- provider 内部注释只说明 ownership、完整 operation 不变量、来源校验或非隔离安全限制；不复述直观控制流。
- `desktop-services/README.md` 描述 consumer 导入、Cordis injection、协议检查、profile 与 package 语义、错误和 non-goals。
- `desktop-services-local/README.md` 描述 launcher 注入前提、provider 生命周期、WAL 范围、lockfile 来源校验、进程树和维护验证。

顶层设计文档只说明三个角色及其依赖方向，参考文档只投影公开服务定义。README 示例采用标记的 TypeScript fence，并由 docs 检查在干净 consumer fixture 中编译；不再复制可漂移的 declarations。

## Risks / Trade-offs

- [两个 workspace 增加维护项] → 服务定义与本地 provider 已有独立消费者和生命周期，拆分删除了根 exports 歧义；每个 package 仅保留一个职责。
- [公开命令联合限制插件自由调用 pnpm] → 原始参数本身无法提供可审计副作用；新增合法操作通过版本化 contract 增加，而非绕过安装恢复。
- [lockfile 格式随 pnpm 演进] → 解析器针对受支持 pnpm 版本建立夹具，未知格式失败并保留 WAL，不推断完整性。
- [同进程插件可伪造对象或直接使用 Node] → 所有文档持续标记 `trusted-in-process`；品牌与 provider 校验只保证受支持 API 的审计语义，不是沙箱。
- [删除旧包会破坏 Fork] → 版本处于首个稳定协议前，采用单提交原子迁移；升级说明给出新 import、bundle 依赖和验证命令，不保留双轨代码。
- [移除空 product-base 会改变 profile 解析证据] → 它没有 patch 或运行时策略，保留只会扩大依赖闭包；迁移中重新生成 profile lockfile、resolved manifest、SBOM 与 composition fixture，未来产品覆盖与其 bundle 在同一变更中引入。

## Migration Plan

1. 建立两个 package 的 ESM 构建、exports、README、外部 consumer fixture 和静态边界规则，先定义公开 types 与 protocol descriptor。
2. 抽取 launcher capability、Cordis provider、profile service、operation lease、进程树和恢复实现；以真实 Loader fixture 验证三项 service 的注册和 disposal。
3. 将 catalog confirmation、严格 SemVer、source spec 构造、lockfile 比较和 receipt 事实接入安装事务，覆盖 pnpm 成功、非零退出、来源漂移、健康失败和取消。
4. 更新 desktop layer、Electron launcher、catalog、profile tool、测试和文档引用为新 package；desktop layer 成为本地 provider 的唯一直接 bundle 依赖方。将官方与开发 profile 收敛到上游运行基线，删除空 product-base bundle；删除旧 package、手写 declarations 和任何兼容 re-export。
5. 执行 package build、NodeNext consumer、服务/Loader/事务测试、README 示例检查、目录边界、文档检查、OpenSpec 严格验证与旧路径搜索。

回滚以整个变更为单位。不得重新发布旧 exports 或在新 package 内恢复旧路径；未完成的 profile 安装按 WAL 恢复语义处理。

## Open Questions

无。
