# @dsh-forge/desktop-services

这是 Fork 和 Host 插件唯一可依赖的桌面 capability contract。它只定义 Cordis
services、协议和类型；不会导出 Electron、launcher、profile 路径或本地 provider。

<!-- dsh-forge-example:desktop-services-consumer -->
```ts
import type { Context } from '@deepseek-ai/cordis';
import { assertDesktopServicesProtocol } from '@dsh-forge/desktop-services';

export default (ctx: Context) => {
  assertDesktopServicesProtocol(ctx.desktopServices);
  const snapshot = ctx.desktopProfiles.snapshot();
  void ctx.desktopPnpm.run({ kind: 'inspect', query: 'list', depth: 0 }).done;
  return snapshot;
};
```

消费者以 Cordis injection 声明 `desktopProfiles`、`desktopPnpm` 或
`desktopServices`，并在首次使用前调用 `assertDesktopServicesProtocol()`。服务仅在
launcher 临时注入 desktop layer 的 generation 内可用；没有 desktop layer 的普通
profile 不会发布这些 service。

`desktopProfiles.snapshot()` 和 `list()` 返回只读 generation 事实。`select()` 会持久化
下一次启动目标并完整重启 Host，绝不修改运行中的 Loader tree。generation 关闭后的
任何服务调用都以稳定错误失败，不能影响后续 generation。

`desktopPnpm` 只接受公开的判别 command 或由 catalog trust 路径生成的
`ConfirmedPluginInstall`。operation 的 `done` 同时等待进程树、reconcile、解析来源
校验、健康检查以及 receipt 或恢复；在它结算前，同一 generation 拒绝第二个 operation。

所有插件都运行在 `trusted-in-process` 模式。确认品牌和 provider 校验可以保护受支持
API 的审计语义，但不能隔离已经获准执行 Node 代码的插件。

维护验证：`pnpm --filter @dsh-forge/desktop-services build` 与
`pnpm run test:desktop-services-consumer`。
