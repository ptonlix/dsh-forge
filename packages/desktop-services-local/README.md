# @dsh-forge/desktop-services-local

English | [中文](README.zh.md)

Private Cordis provider for `@dsh-forge/desktop-services`. It turns the launcher's verified
`dshForgeDesktopCapability` into the current generation's `desktopProfiles`, `desktopPnpm`,
and `desktopServices`, and owns managed pnpm operations, install transactions, source
verification, health checks, and recovery facts.

This is an **internal implementation package**, not a third-party plugin extension point.
Only these two locations may use it:

- `@dsh-forge/desktop-layer` loads the default provider through the root entry;
- `apps/desktop` creates the capability through `@dsh-forge/desktop-services-local/launcher`.

Other bundles, features, generators, Forks, test fixtures, and ordinary DSH plugins MUST NOT
import this package. Third parties should depend only on
[`@dsh-forge/desktop-services`](../desktop-services/README.md).

## Export and loading boundary

| Export | Consumer | Purpose |
|---|---|---|
| Default export | desktop layer | Registers the three public desktop services for the current generation. |
| `./launcher` | `apps/desktop` | Creates the frozen launcher capability; it is not exported to business bundles. |

The root entry is not a standalone provider: it requires an existing
`dshForgeDesktopCapability` in the Cordis Context. Without the capability it does not fabricate
profile, package, or descriptor services; the normal loading path is owned by the desktop
layer's `cordis.patch.yml`.

```yaml
- insert:
    - id: dsh-forge-desktop-services
      name: '@dsh-forge/desktop-services-local'
```

`apps/desktop` loads the provider after creating the capability:

```ts
import { Context } from '@deepseek-ai/cordis';
import localProvider from '@dsh-forge/desktop-services-local';
import { createDesktopHostCapability } from '@dsh-forge/desktop-services-local/launcher';

const generation = {
  id: 'generation-id',
  profile: 'dsh-forge-official',
  stage: 'prepared',
  closed: false,
};

const capability = createDesktopHostCapability({
  generation,
  profileDir: '/absolute/path/to/profile',
  profiles: [],
  manager: { select: async () => generation },
  catalog: [],
  reconcile: async () => {},
  verifyNextGeneration: async () => true,
});

const ctx = new Context();
ctx.provide('dshForgeDesktopCapability', capability);
await ctx.plugin(localProvider);
```

The absolute path, profile summary, catalog, manager, and lifecycle hooks in the example MUST
be populated by the launcher with real, verified facts; business plugins MUST NOT construct a
capability themselves.

## Launcher capability

`createDesktopHostCapability(options)` copies and freezes the facts passed from the launcher to
the provider, preventing the provider or third-party code from mutating launcher state.

| Field | Required | Meaning |
|---|---:|---|
| `generation` | Yes | `{ id, profile, stage, closed }`; the lifecycle boundary for all services and operations. |
| `profileDir` | Yes | Absolute path to the managed profile directory; it MUST already exist. pnpm always uses it as cwd. |
| `profiles` | Yes | Readonly profile summaries resolved by the launcher. |
| `manager` | Yes | Generation manager providing `select(profile)`; the provider does not access the state store directly. |
| `catalog` | Yes | Static catalog snapshot used by the current generation. Install confirmations can bind only to this snapshot. |
| `reconcile` | Yes | Hook that refreshes managed profile resolution facts after pnpm succeeds. |
| `verifyNextGeneration` | Yes | Checks whether the next generation is healthy before receipt submission. `false` enters manual recovery. |
| `pnpm` | No | pnpm executable; defaults to `pnpm`. |
| `pnpmArgs` / `pnpmEnv` | No | Fixed arguments and environment maintained by the launcher; consumers cannot override them. |
| `transactionDir` | No | WAL directory; defaults to `<profileDir>/.recovery`. |
| `spawn` | No | Process-tree launcher supplied by tests or the host; production uses managed `spawnTree`. |
| `initializeProfile` | No | Hook that initializes the profile before starting a package operation. |

`createDesktopHostCapability()` only freezes and forwards facts. It does not validate catalog
business correctness or change the generation; the launcher and profile-toolchain complete
profile, source, and platform validation earlier.

## Provider service

### Registration and disposal

The provider publishes these services within one Cordis generation:

- `desktopProfiles`: `DesktopProfilesProvider` owns the generation, manager, and readonly profile summaries;
- `desktopPnpm`: `DesktopPnpmProvider` owns the profile directory, catalog, process lease, and recovery state;
- `desktopServices`: frozen descriptor with protocol `1`, execution mode `trusted-in-process`, and the three service names.

When the fiber unloads, the provider first marks the package service closed, cancels the managed
process tree, waits for the current operation's `done` to settle completely, and then removes
the service. Old references from a closed generation cannot access or modify a new generation.

The public profile service methods, readonly snapshots, and `select()` semantics are documented
in the [`@dsh-forge/desktop-services` README](../desktop-services/README.md#services). This
package only connects the launcher's real manager to that contract; it does not implement a
second profile state machine.

## Package operation

All pnpm calls start from `profileDir` and are serialized by a generation-level lease. The
provider does not accept raw argument arrays; public commands become fixed arguments:

| Public command | Fixed pnpm arguments | Action after success |
|---|---|---|
| `inspect/list` | `list [--depth=N] --filter ./` | Readonly; no reconcile. |
| `inspect/why` | `why <package> [--depth=N] --filter ./` | Readonly; no reconcile. |
| `reconcile` | `install --lockfile-only --ignore-scripts --filter ./` | Calls `reconcile()`. |
| `remove` | `remove --ignore-scripts <package> --filter ./` | Calls `reconcile()`. |
| `install` | `add --save-exact --ignore-scripts <spec> [--registry=...] --config.allowBuilds=... --filter ./` | Runs reconcile, lockfile source verification, next-generation health check, and receipt submission. |

`inspect.depth` MUST be an integer from `0..20`; `why` MUST provide a package name. Every
package name and exact version is validated before starting a child process. While an operation
is running, a second operation fails with `PACKAGE_BUSY`; a cancellation signal fails with
`PACKAGE_CANCELLED` before startup.

## Install confirmation and source verification

`install()` accepts only a runtime-branded, deeply frozen `ConfirmedPluginInstall` bound to the
current generation profile. The provider rereads the static catalog and compares package name,
exact version, source, and integrity item by item; it does not trust a display object modified by
the caller.

Supported sources:

- **registry**: uses the catalog's HTTPS registry, tarball, and integrity; the lockfile MUST retain the same tarball and integrity.
- **git**: uses the catalog's repository and a complete 40-character commit; the lockfile MUST retain the same repository and commit, and branches, tags, `main`, and `latest` are forbidden.
- **workspace**: may enter the catalog and build profile, but dynamic installation is explicitly rejected.

Build scripts come only from the request's `allowBuilds` allowlist and are passed as pnpm
`allowBuilds` configuration; the provider still defaults to `--ignore-scripts`. Catalog
confirmation binds source and review facts; it is not a security boundary for Node or Electron
code.

## Install transactions and recovery

Install transactions use `<transactionDir>/install-*.json` WAL files. One install settles in this order:

1. Acquire the generation lease and validate the signal, generation, confirmation brand, and catalog.
2. Save pre-write snapshots for `package.json`, `pnpm-lock.yaml`, and `pnpm-workspace.yaml`, then write the WAL.
3. Start pnpm in the managed profile directory and expose stdout, stderr, and the cancellation handle through the operation.
4. On a non-zero exit, signal termination, or cancellation, restore protected files, write a `.failed` record, and end the transaction.
5. On success, run `reconcile()` and verify package source and integrity from the actual lockfile.
6. Start the next generation for a health check; on success, write a `.receipt` and delete the WAL.

If reconcile, lockfile parsing, or the health check fails, the provider restores protected files,
writes `.manual-recovery`, marks the state for manual recovery, and rejects later package
operations with `INSTALL_MANUAL_RECOVERY` until the launcher creates a verifiable profile again.
The WAL protects only the three declarations and lockfile above; it **does not promise to roll
back `node_modules`**. Recovery facts explicitly require manual inspection.

Process exit does not mean the operation is complete: `done` also waits for reconcile, source
verification, health checks, and receipt or recovery. `dispose` waits for the same complete
settlement, preventing delayed callbacks from an old generation from writing to a new one.

## Error and lifecycle boundaries

The provider uses profile-toolchain's `ForgeError`; callers should branch on stable codes rather
than error text. Common codes include:

| Code | Trigger |
|---|---|
| `SERVICE_CWD` | `profileDir` is not an absolute path or the directory does not exist. |
| `SERVICE_ARGUMENT` | Profile name, package name, or inspect depth is invalid. |
| `GENERATION_CLOSED` | Provider or generation is closed. |
| `PACKAGE_BUSY` | The current generation already has an operation. |
| `PACKAGE_CANCELLED` | The operation was cancelled before startup. |
| `CATALOG_CONFIRMATION_REQUIRED` | Install request is not frozen, confirmed, or catalog-matching. |
| `CATALOG_PROFILE_MISMATCH` | Request is bound to another profile. |
| `CATALOG_INSTALL_SOURCE` | Source type is unsupported or workspace is used for dynamic installation. |
| `INSTALL_SOURCE_DRIFT` | Lockfile source or integrity differs from the confirmed facts. |
| `INSTALL_LOCKFILE_UNKNOWN` | Lockfile is missing, has an unknown format, or has no target package. |
| `INSTALL_MANUAL_RECOVERY` | Reconcile, source verification, or health check cannot prove the installed profile is usable. |

`dispose()` closes the provider, cancels the current operation, and waits for its `done`; it does
not fabricate a successful result or delete manual recovery records.

## Model impact

No direct model impact. This provider registers desktop services and managed package operations;
it does not register prompts, tools, session events, or model-visible text. If an upper-level
plugin displays package output or profile summaries to a model, that plugin's README must explain
the content source and token behavior separately.

#### KV cache impact

No direct impact; any change to a model request prefix is owned by the upper-level consumer.

## Known limitations and deferred work

- **Private provider, not an extension point**: Third-party bundles cannot depend on this package; its API serves only the launcher and desktop layer.
- **No page-side install flow today**: `install()` is a controlled lower-level capability; the first packaged release has no plugin directory, confirmation UI, or online download entry point.
- **One operation per generation**: A generation does not support concurrent reconcile, remove, or install; the previous operation must settle completely.
- **No `node_modules` rollback**: Failure recovery covers declarations and the lockfile only; the next generation or a manual check must verify the `node_modules` state.
- **No cross-version migration**: WAL, receipt, and recovery records use the current schema; format changes require a separate migration design.
- **Execution mode is not isolation**: Under `trusted-in-process`, Node plugins still share process permissions with the Host.

## Maintenance verification

```sh
pnpm --filter @dsh-forge/desktop-services-local build
pnpm run test:desktop-services-local
pnpm run boundaries:check
```

Consumer type checking for the public contract uses:

```sh
pnpm run test:desktop-services-consumer
```

Real loading, service teardown, generation invalidation, WAL, source drift, health failures, and
managed process cancellation are covered by `tests/desktop-loader.test.ts` and
`tests/runtime-services.test.ts`.
