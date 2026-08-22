# DSH Forge Foundation Contracts

English | [中文](foundation-contracts.zh.md)

This reference owns stable configuration and public desktop service facts. Distribution responsibilities and lifecycle design are in [`../design/dsh-forge.md`](../design/dsh-forge.md); source, recovery, and release maintenance boundaries are in [`../engineering/foundation-boundaries.md`](../engineering/foundation-boundaries.md).

## Distribution and Profile

`distribution.yml` is the only source of distribution identity. It must declare `schema`, `id`, `name`, `packageScope`, `applicationId`, `version`, `defaultProfile`, and one or more platform/architecture targets. When updates are enabled, `channel`, `metadataUrl`, and `trustRoot` are also required; an incomplete update declaration cannot enter production release.

`profiles/<name>/profile.yml` declares a fixed runtime version set and ordered `bundles`. The top-level `plugins` field is rejected. `@dsh-forge/desktop-layer` is injected by the launcher for one generation and must not appear in `bundles`. A sibling `cordis.patch.yml` is the final profile override.

`profile:resolve` writes generated profile files, a profile lockfile, `resolved-manifest.json`, `sbom.input.json`, license notices, and a configuration dump under `artifacts/<distribution>/<profile>/<input-digest>/`. These files are resolution evidence. After any source, bundle, version, or build-script authorization change, run `profile:resolve` and `profile:verify` again.

## Public Import

`@dsh-forge/desktop-services` is the only public desktop import. It augments Cordis `Context` with `desktopProfiles`, `desktopPnpm`, and `desktopServices`; consumers call `assertDesktopServicesProtocol()` before using the services. The current protocol is `1`.

The local provider, Electron runtime, launcher paths, profile directories, and raw pnpm arguments are internal. Third-party bundles must not import `@dsh-forge/desktop-services-local` or assume that a normal Web, headless, or test composition has a desktop layer.

## `desktopProfiles`

`desktopProfiles.current` is an immutable name snapshot for one generation. `snapshot()` returns a deep-frozen profile snapshot, and `list()` returns readonly profile summaries with bundle, compatibility, selectable, and diagnostic facts. `select(name)` persists a pending target and restarts the generation; it cannot replace a running Loader tree.

The same concurrent target shares one operation. A different concurrent target fails without replacing the persisted pending target. Any retained service reference rejects after generation disposal and cannot affect a new generation. The packaged application does not expose profile selection through its UI.

## `desktopPnpm`

`desktopPnpm.run()` accepts only these discriminated commands:

| Command | Required fields | Meaning |
| --- | --- | --- |
| `inspect` | `query: 'list'` or `query: 'why'` | Reads profile dependencies; `why` requires `packageName`. |
| `reconcile` | none | Synchronizes the profile lockfile without lifecycle scripts. |
| `remove` | `packageName` | Removes one exact package through the provider. |

`DesktopPnpmOperation` exposes `stdout`, `stderr`, a `done` promise, and idempotent `cancel()`. `done` settles only after the managed process tree, reconcile, source validation, health check, receipt, or recovery reaches a final state. One generation permits one operation; an already-cancelled signal, a busy lease, or a closed generation fails before spawning a process.

`install(request)` accepts only a catalog-confirmed immutable `ConfirmedPluginInstall`. Registry installs bind registry, tarball, and integrity; Git installs bind a complete commit; workspace entries are display-only and cannot trigger dynamic installation. The provider rebinds the request to the current catalog and compares package name, exact version, source, and integrity before committing a receipt.

## Trust and Manifests

The descriptor and catalog use `executionMode: 'trusted-in-process'`. Review, authorization, and enforcement facts are separate; `enforcement: unavailable` means the public API is not a Node or Electron security boundary.

`resolved-manifest.json` records the profile runtime, bundles, sources, integrity, licenses, scripts, `allowBuilds`, platforms, and input digest. `runtime-manifest.json` adds Electron, Node, pnpm, native-addon, built-target, declared-target, and signing facts. Neither manifest proves author trustworthiness, license accuracy, a valid signature, or safety of executed code.

## Verification

```sh
pnpm run profile:resolve -- dsh-forge-official
pnpm run profile:verify -- dsh-forge-official
pnpm run catalog:verify
pnpm run test:desktop-services-consumer
```

The consumer-facing package guide is [`../../packages/desktop-services/README.md`](../../packages/desktop-services/README.md). It provides a compilable example and package-specific maintenance commands.
