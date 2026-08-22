# @dsh-forge/desktop-services

面向 DSH Host 插件的公开桌面 capability contract。该包声明
`desktopProfiles`、`desktopPnpm` 和 `desktopServices` 的 Cordis service、TypeScript
类型、协议常量及运行时校验函数；它不实现 Electron、launcher、文件路径或本地
package manager provider。

这是一个**公开 contract 包**，不是可以独立启动的桌面插件。真正的 service provider
由 [`@dsh-forge/desktop-services-local`](../desktop-services-local/README.md) 在
desktop layer 的 generation 中注册。第三方 bundle 和 Fork 只能依赖本包，不能导入
provider、launcher 或内部路径。

## 包边界

- 根入口 `@dsh-forge/desktop-services` 是唯一公开 import。
- `@deepseek-ai/cordis` 的 `Context` 会获得三个类型化字段：
  `desktopProfiles`、`desktopPnpm` 和 `desktopServices`。
- 本包不导出默认 Cordis plugin，也不负责发现当前 Host 是否已经挂载 desktop layer。
- 当前发行包固定构建时 profile，不提供页面端 profile 切换或插件在线安装；底层
  `select()` 与 `install()` 供开发态、受控 Host 或未来独立产品变更使用。

公开导出与私有实现的关系如下：

```text
第三方 bundle / Host 插件
          |
          v
@dsh-forge/desktop-services     <- 公开类型、协议和 service contract
          ^
          |
@dsh-forge/desktop-services-local <- 私有 provider，只由 desktop layer 使用
```

## 接入方式

消费者在首次使用 service 前协商协议，并通过 Cordis `Context` 读取 service。没有
desktop layer 的普通 Web、headless 或测试 composition 不会自动获得这些字段；插件
应明确声明 required injection，或保留自己的非桌面 fallback。

<!-- dsh-forge-example:desktop-services-consumer -->
```ts
import type { Context } from '@deepseek-ai/cordis';
import {
  assertDesktopServicesProtocol,
  type DesktopPnpmResult,
  type DesktopProfileSnapshot,
} from '@dsh-forge/desktop-services';

export async function inspectDesktop(ctx: Context): Promise<{
  snapshot: Readonly<DesktopProfileSnapshot>;
  result: Readonly<DesktopPnpmResult>;
}> {
  assertDesktopServicesProtocol(ctx.desktopServices);

  const snapshot = ctx.desktopProfiles.snapshot();
  const result = await ctx.desktopPnpm.run({
    kind: 'inspect',
    query: 'list',
    depth: 0,
  }).done;

  return { snapshot, result };
}
```
<!-- /dsh-forge-example:desktop-services-consumer -->

`assertDesktopServicesProtocol()` 只验证 descriptor 的主协议号，不会创建 service，
也不会授予额外权限。协议不匹配时必须停止后续操作，不能猜测字段或降级为另一套
Electron API。

## Descriptor：`desktopServices`

`ctx.desktopServices` 是只读的运行时描述，不是 capability 容器。当前协议为 `1`，
其字段固定如下：

| 字段 | 类型 | 含义 |
|---|---|---|
| `protocol` | `1` | 公开桌面 service 主协议版本。 |
| `executionMode` | `'trusted-in-process'` | 插件与 DSH、Electron 位于同一 Node 进程。 |
| `services` | `['desktopProfiles', 'desktopPnpm', 'desktopServices']` | 当前 provider 发布的 service 名称。 |

`executionMode` 只描述执行事实，不是安全隔离承诺。catalog 审核、用户确认和
provider 校验不能把已经加载的第三方 Node 代码变成进程级沙箱。

## Service：`DesktopProfiles`（ctx 键：`desktopProfiles`）

该 service 提供当前 generation 的 profile 事实和受控选择操作。快照与列表是只读的；
调用已经关闭的 generation 会以 `GENERATION_CLOSED` 失败。

| API | 返回值 | 行为 |
|---|---|---|
| `current` | `string \| null` | 当前 generation 绑定的 profile 名称；在该 generation 内不变。 |
| `snapshot()` | `Readonly<DesktopProfileSnapshot>` | 返回包含协议号、当前 profile 和完整 profile 摘要的深度冻结快照。 |
| `list()` | `readonly DesktopProfileSummary[]` | 返回 profile 摘要副本；每项包含 bundle、平台兼容性、可选择性和诊断事实。 |
| `select(name)` | `Promise<DesktopProfileSelection>` | 持久化下一次启动目标，并由 launcher 完整释放当前 generation 后启动目标 profile。 |

`select()` 只接受格式为小写字母开头、长度 2 至 64、由小写字母/数字/连字符组成的
profile 名称。它不是运行中的 Loader tree 替换；同一目标的并发选择由 launcher 合并，
不同目标的并发选择会失败。当前固定 profile 发行包不在页面端暴露该方法。

`DesktopProfileSummary` 的关键字段如下：

| 字段 | 含义 |
|---|---|
| `name` | profile 名称。 |
| `exists` | 受管 profile 是否已物化。 |
| `bundles` | 该 profile 的有序 bundle 名称。 |
| `webCompatible` | 是否满足当前 Web Host 的兼容性要求。 |
| `default` | 是否是发行版默认 profile。 |
| `selectable` | launcher 是否允许选择。 |
| `error` / `reason` | 不可用或不可选择时的诊断事实；正常时为 `null`。 |

## Service：`DesktopPnpm`（ctx 键：`desktopPnpm`）

`DesktopPnpm` 是 profile 范围的受管 package operation。调用方只能传递判别 command、
`ConfirmedPluginInstall` 和可选 `AbortSignal`；不能传递原始 pnpm 参数、工作目录、环境
变量或任意 options 对象。

### 只读和维护 command

| Command | 必填字段 | 语义 |
|---|---|---|
| `{ kind: 'inspect', query: 'list' }` | `depth?` | 检查当前 profile 的直接或递归依赖。 |
| `{ kind: 'inspect', query: 'why' }` | `packageName`、`depth?` | 查询指定 package 的依赖原因。 |
| `{ kind: 'reconcile' }` | 无 | 以 `--lockfile-only` 重新同步 profile lockfile，不执行生命周期脚本。 |
| `{ kind: 'remove' }` | `packageName` | 受控移除一个精确 package，不执行生命周期脚本。 |

`depth` 必须是 `0..20` 的整数，package 名称必须符合 Node package 名称格式。
每个 generation 同时最多运行一个 operation；重复占用以 `PACKAGE_BUSY` 失败。

### Operation 生命周期

`run()` 和 `install()` 都返回冻结的 `DesktopPnpmOperation`：

| 成员 | 语义 |
|---|---|
| `stdout` / `stderr` | 受管进程树的 Node `Readable` 输出流。 |
| `done` | 返回 `{ exitCode, signal, cancelled }` 的 Promise；它会等待进程树、reconcile、来源校验、健康检查及 receipt 或恢复全部完成。 |
| `cancel()` | 幂等取消当前进程树；取消后仍需等待 `done` 结算。 |

调用前已经取消的 signal 以 `PACKAGE_CANCELLED` 失败。generation 关闭后，新的调用和
保留的 service 引用都以 `GENERATION_CLOSED` 失败；旧 operation 不得影响后续 generation。

### 已确认安装

`install(request)` 只接受由静态 catalog 和明确用户确认生成的不可变
`ConfirmedPluginInstall`。建议使用
[`installationConfirmation()`](../../tools/profile-toolchain/README.md#catalog-信任与安装确认)
生成请求，而不是手工拼接对象。

| 字段 | 约束 |
|---|---|
| `catalogId` | 必须存在于当前 generation 的静态 catalog。 |
| `profile` | 必须等于当前 generation 的 profile。 |
| `packageName` / `version` | package 名称合法，版本必须是精确 SemVer，拒绝 range、tag、`workspace:*` 和 `file:` alias。 |
| `source` | `registry` 绑定 HTTPS registry、tarball、integrity；`git` 绑定仓库和完整 40 位 commit；`workspace` 只能审计展示，不能触发动态安装。 |
| `allowBuilds` | 来自 catalog 的已审核构建脚本白名单。 |
| `confirmedAt` / `confirmation` | 记录确认时间及 `dsh-forge/catalog-confirmation@1` 用户确认事实。 |

provider 会把请求重新绑定到当前 catalog，并在 receipt 前比较 lockfile 中的 package 名称、
精确版本、来源和完整性。任何伪造、来源漂移或未知 lockfile 都不能报告为安装成功。

## 生命周期与信任边界

本包只描述 contract，不拥有资源。service 的注册、operation lease、WAL、profile
reconcile 和 generation dispose 由 local provider 负责。消费者应在自己的 Cordis fiber
释放时停止持有的 operation，并等待 `done` 或显式处理其失败。

所有桌面插件当前使用 `trusted-in-process`。该包不提供 Electron `BrowserWindow`、`Tray`、
原始 IPC、Node 子进程或 profile 路径；需要这些能力时必须通过另一个明确的 Host service
contract 提出，而不是绕过本包访问 launcher 内部对象。

## 模型体验

无直接模型影响。本包只声明桌面 service 和 package operation，不注册 prompt、tool、
session event 或模型可见文本。具体消费方如果把 profile 或 package 结果暴露给模型，
必须在自己的 README 中说明对应的提示词、token 和 KV Cache 影响。

#### KV Cache 影响

无直接影响；service 消费方拥有任何模型请求前缀变化。

## 已知限制与暂缓事项

- **公开 contract 不等于运行时可用**：只有 desktop layer 向当前 generation 注入 capability 后，三个 service 才会出现。
- **当前发行包没有管理 UI**：profile 切换、catalog 浏览和运行时插件安装不是首版页面功能；第三方依赖在构建期解析并随安装包交付。
- **`install()` 不是安全沙箱**：catalog 确认和来源校验只能约束审核流程，不能隔离同一 Node 进程中的插件代码。
- **workspace 来源不能动态安装**：workspace 条目可以保留在 catalog 中用于审计和构建组合，但 provider 会拒绝把它转换为运行时安装。
- **包为 workspace private 包**：当前未作为独立 npm SDK 发布，公开边界以 `package.json` 的 `exports` 为准。

## 维护验证

```sh
pnpm --filter @dsh-forge/desktop-services build
pnpm run test:desktop-services-consumer
```

真实 provider、generation、WAL 和 package operation 的测试位于仓库根目录的
`tests/desktop-loader.test.ts` 与 `tests/runtime-services.test.ts`，应通过
[`@dsh-forge/desktop-services-local`](../desktop-services-local/README.md) 的验证命令运行。
