# @dsh-forge/desktop-services

English | [中文](README.zh.md)

`@dsh-forge/desktop-services` is the public desktop capability contract for DSH Host plugins. It exports the Cordis service types, protocol constant, and runtime checks for `desktopProfiles`, `desktopPnpm`, and `desktopServices`. It does not implement Electron, the launcher, paths, or a package-manager provider.

## Public Boundary

The root import `@dsh-forge/desktop-services` is the only supported consumer entry. The local provider in [`../desktop-services-local/README.md`](../desktop-services-local/README.md) is registered by the desktop layer and is not a consumer API. The current packaged application binds one profile at build time and exposes no page-side profile switch or online plugin installer.

```text
Third-party bundle / Host plugin
             |
             v
@dsh-forge/desktop-services  (public contract)
             ^
             |
@dsh-forge/desktop-services-local  (private provider)
```

## Consumer Example

Consumers negotiate the protocol before using a service. A composition without the desktop layer does not automatically provide these fields.

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

`assertDesktopServicesProtocol()` validates the major protocol number. It does not create a service or grant Electron permissions; a mismatch must stop the operation rather than guess another API.

## Services

`desktopServices` is a readonly descriptor with protocol `1`, execution mode `trusted-in-process`, and the three service names. The execution mode is not a security sandbox.

`desktopProfiles.current` is immutable within a generation. `snapshot()` returns a deep-frozen profile snapshot and `list()` returns readonly profile summaries. `select(name)` persists a pending target and restarts the generation; it does not replace a running Loader tree. Concurrent selection of the same target shares an operation; a different target fails. References retained after generation disposal fail with `GENERATION_CLOSED`.

`desktopPnpm.run()` accepts only discriminated `inspect`, `reconcile`, and `remove` commands. Its operation exposes `stdout`, `stderr`, a `done` promise, and idempotent `cancel()`. `done` waits for process-tree teardown, reconcile, source validation, health checks, receipts, or recovery. Each generation has one package operation lease and rejects a busy, cancelled, or closed call before spawning a process.

`install(request)` accepts only an immutable catalog-confirmed `ConfirmedPluginInstall`. Registry sources bind registry, tarball, and integrity; Git sources bind a complete commit. The provider revalidates the current catalog before committing a receipt. This operation is a controlled lower-level API and is not a page-side feature of the current packaged application.

## Trust and Limitations

Plugins run in the same Node process as DSH and Electron under `trusted-in-process`. Catalog review, confirmation, and provider checks constrain supported operations but do not isolate already loaded Node code. Consumers must not import Electron, `desktop-services-local`, launcher paths, profile paths, or raw pnpm arguments.

## Verification

```sh
pnpm run test:desktop-services-consumer
pnpm run docs:check
```

The configuration and failure reference is [`../../docs/reference/foundation-contracts.md`](../../docs/reference/foundation-contracts.md).
