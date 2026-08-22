# DSH Forge Engineering Boundaries

English | [中文](foundation-boundaries.zh.md)

This document owns maintenance boundaries for source files, generated evidence, generation recovery, package operations, and release work. The architecture is in [`../design/dsh-forge.md`](../design/dsh-forge.md); configuration and public service facts are in [`../reference/foundation-contracts.md`](../reference/foundation-contracts.md).

## Source and Derived Files

Hand-maintained composition sources are `distribution.yml`, `profiles/*/profile.yml`, profile patches, bundle manifests, and the static catalog. `artifacts/` is generated and may be removed and rebuilt. Build and runtime code must not write back to source profiles or source patches.

`profile:verify` compares normalized inputs, resolved dependencies, tool versions, lockfiles, and the resolved manifest. A lockfile records one resolution and an SBOM records composition; neither independently proves trustworthy source, correct licensing, valid signing, or plugin safety.

## Generation and Recovery

Private state records active, pending, last-known-good, generation ID, and recent failures. Writes reject symlinks and use exclusive temporary files plus atomic rename. Corrupted state is diagnosed and falls back to a verifiable target; it is never silently accepted.

Health commit requires Host entry settlement, loopback readiness, a sandboxed window, and renderer boot report. A pending failure can recover once to the last known-good target, then requires manual recovery. Window close hides by default; explicit exit, signals, profile selection, and recovery wait for bounded Host and managed-process teardown.

`@dsh-forge/desktop-services-local` is a private provider. Only the desktop layer registers it, and `apps/desktop` creates its launcher capability through the `./launcher` export. Its Cordis fiber owns the profile service, package lease, process tree, and WAL. Consumers use only `@dsh-forge/desktop-services`.

## Package Operations

An install starts only after explicit confirmation. Startup reads the static catalog and must not download or run a package manager. Confirmation binds catalog entry, profile, exact SemVer, source, integrity, allowed build scripts, and time; the provider compares those facts against the current catalog before starting pnpm.

The installation WAL protects `package.json`, `pnpm-lock.yaml`, and `pnpm-workspace.yaml`. It does not roll back `node_modules`. Unknown lockfiles, source drift, nonzero process exit, cancellation, reconcile failure, or next-generation health failure must restore protected files or record manual recovery.

## Release Boundary

Updates stage downloads separately and validate channel metadata signatures, distribution identity, platform/architecture, artifact digest, trust root, and strict version advancement before disposing a generation and handing control to a platform installer. Unsigned packages are local or CI smoke evidence only; they cannot enter a production update channel. macOS production packages need signing and notarization, and Windows production packages need Authenticode publisher validation.

## Maintenance Checks

```sh
pnpm run check
pnpm run profile:verify -- dsh-forge-official
pnpm run dump-config -- dsh-forge-official
pnpm run catalog:verify
pnpm run package:inspect
pnpm run boundaries:check
```

The actual local-command record and platform coverage are kept in [`foundation-verification.md`](foundation-verification.md). That record is internal and is not a public documentation-site page.
