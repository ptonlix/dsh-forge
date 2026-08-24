# @dsh-forge/profile-toolchain

English | [中文](README.zh.md)

`@dsh-forge/profile-toolchain` is the private workspace toolchain that compiles DSH Forge distribution inputs into reproducible profile and release evidence. It reads `distribution.yml`, `profiles/<name>/profile.yml`, bundle manifests, the static catalog, and the runtime matrix; it does not replace the DSH runtime or Electron host.

## Boundary and Inputs

The package is not a separately published npm SDK. Its supported workspace boundary is the `exports` map in [`package.json`](package.json). Consumers use package exports and never import `src/` across workspace boundaries.

Hand-maintained inputs are:

- `distribution.yml`: distribution identity, default profile, platforms, and update trust configuration.
- `profiles/<name>/profile.yml`: fixed runtime versions and ordered bundle names.
- Bundle `package.json` and `cordis.patch.yml`: DSH manifest, dependencies, and patch registration.
- `catalog/catalog.yml`: exact source, version, integrity, license, capability, and review facts.
- Root `pnpm-workspace.yaml`: allowed lifecycle-build decisions.

Generated profile directories, lockfiles, resolved manifests, SBOM input, license notices, and runtime manifests belong to `artifacts/`. They are verification evidence and must not become hand-maintained composition sources.

## Quick Start

```sh
pnpm install --frozen-lockfile
pnpm --filter @dsh-forge/profile-toolchain build
pnpm run profile:resolve -- developer
pnpm run profile:verify -- developer
```

The root scripts pass profile arguments to the same CLI implementation. Successful commands print JSON; expected business failures use stable error codes and non-zero exit status.

## CLI

The implementation is [`src/cli/index.ts`](src/cli/index.ts). Profile commands use the explicit profile, or `distribution.yml`'s `defaultProfile` when omitted. An invalid explicit profile fails and never silently falls back.

| Command | Purpose |
| --- | --- |
| `profile:resolve [profile]` | Compile a profile, resolve its dependency closure, and write evidence. |
| `profile:verify [profile]` | Recompile and compare source, tool, lockfile, and manifest facts. |
| `dump-config [profile]` | Run the real DSH loader and print a normalized configuration dump. |
| `catalog:verify` | Check catalog schema, IDs, source facts, and review expiry. |
| `package:inspect [profile]` | Inspect an Electron artifact's profile closure, dynamic imports, and native files. |
| `release:gate [profile]` | Aggregate profile, package, catalog, SBOM, native evidence, and smoke evidence. |
| `docs:check` | Check document links, commands, examples, public scope, and bilingual pairs. |
| `docs:pair --write [file]` | Record Git blob hashes for one or all public bilingual pairs. |

## Compilation Contract

The compiler validates schema fields, runtime versions, bundle patches, peer ranges, exact Git commits, catalog provenance, and lifecycle-script authorization before calculating an input digest. It then writes a profile-local package manifest, patch, workspace file, lockfile, resolved manifest, SBOM input, and license notice.

The composer assembles `profile bundle -> profile patch -> DSH Home patch -> launcher overlay`, runs the actual DSH loader, and reports unmatched patches or missing entries as unhealthy. The overlay is typed and cannot write back to source profiles.

## Catalog and Release

The catalog is a static audit snapshot, not a runtime plugin marketplace. `installationConfirmation()` binds a catalog entry, target profile, exact version, source, integrity, allowed build scripts, and explicit confirmation. Startup installation is rejected. Plugin execution remains `trusted-in-process`; catalog checks are not process isolation.

The release gate requires a verified profile and healthy config dump, package inspection, platform native evidence, smoke evidence, catalog, SBOM, and license notices. The current GitHub tag Release may publish an artifact explicitly marked `unsigned-smoke`; code signing, notarization, and the automatic update channel are deferred to a separate change.

## Verification

```sh
pnpm --filter @dsh-forge/profile-toolchain build
pnpm run typecheck
pnpm run lint
pnpm exec vitest run tests/compiler.test.ts tests/composer.test.ts tests/trust-release.test.ts
pnpm run catalog:verify
pnpm run docs:check
```

Architecture belongs to [`../../docs/design/dsh-forge.md`](../../docs/design/dsh-forge.md), stable service and configuration facts belong to [`../../docs/reference/foundation-contracts.md`](../../docs/reference/foundation-contracts.md), and source/artifact boundaries belong to [`../../docs/engineering/foundation-boundaries.md`](../../docs/engineering/foundation-boundaries.md).
