# @dsh-forge/desktop-services

中文 | [English](README.md)

`@dsh-forge/desktop-services` 是面向 DSH Host 插件的公开桌面 capability contract。它导出 `desktopProfiles`、`desktopPnpm` 和 `desktopServices` 的 Cordis service 类型、协议常量与运行时检查，不实现 Electron、启动器、路径或 package manager provider。

## 公开边界

根入口 `@dsh-forge/desktop-services` 是唯一支持的 consumer 入口。[`../desktop-services-local/README.zh.md`](../desktop-services-local/README.zh.md) 中的私有 provider 由 desktop layer 注册，不是 consumer API。当前打包应用在构建期绑定一个 profile，不提供页面端 profile 切换或在线安装插件。

```text
第三方 bundle / Host 插件
             |
             v
@dsh-forge/desktop-services  (公开 contract)
             ^
             |
@dsh-forge/desktop-services-local  (私有 provider)
```

## Consumer 示例

Consumer 使用 service 前必须协商协议。未挂载 desktop layer 的 composition 不会自动获得这些字段。

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
  const result = await ctx.desktopPnpm.run({ kind: 'inspect', query: 'list', depth: 0 }).done;
  return { snapshot, result };
}
```
<!-- /dsh-forge-example:desktop-services-consumer -->

`assertDesktopServicesProtocol()` 只验证主协议号，不创建 service 或授予 Electron 权限；协议不匹配时必须停止操作，不能猜测其他 API。

## Service

`desktopServices` 是只读 descriptor，协议为 `1`，执行模式为 `trusted-in-process`，包含三个 service 名称。执行模式不是安全沙箱。

`desktopProfiles.current` 在一个 generation 内不可变。`snapshot()` 返回深度冻结的 profile 快照，`list()` 返回只读 profile 摘要。`select(name)` 持久化 pending 目标并重启 generation，不替换运行中的 Loader tree。同一目标的并发选择共享 operation；不同目标会失败。generation dispose 后保留的引用以 `GENERATION_CLOSED` 失败。

`desktopPnpm.run()` 只接受判别的 `inspect`、`reconcile` 和 `remove` command。Operation 提供 `stdout`、`stderr`、`done` promise 和幂等 `cancel()`；`done` 会等待进程树 teardown、reconcile、来源校验、健康检查、receipt 或恢复。每个 generation 只有一个 package operation lease，busy、cancelled 或 closed 调用在启动进程前失败。

`install(request)` 只接受不可变的 catalog-confirmed `ConfirmedPluginInstall`。Registry 来源绑定 registry、tarball 和 integrity；Git 来源绑定完整 commit。Provider 在提交 receipt 前重新校验当前 catalog。这是受控底层 API，当前打包应用没有页面端安装功能。

## 信任与限制

插件以 `trusted-in-process` 与 DSH 和 Electron 位于同一 Node 进程。Catalog 审核、确认和 provider 校验可以约束支持的操作，但不能隔离已经加载的 Node 代码。Consumer 不能导入 Electron、`desktop-services-local`、启动器路径、profile 路径或原始 pnpm 参数。

## 验证

```sh
pnpm run test:desktop-services-consumer
pnpm run docs:check
```

配置与失败语义参考见 [`../../docs/reference/foundation-contracts.zh.md`](../../docs/reference/foundation-contracts.zh.md)。
