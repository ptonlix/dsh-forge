# DSH Forge

English | [中文](README.zh.md)

DSH Forge is a forkable toolchain for building an auditable desktop distribution around DeepSeek Harness (DSH). It combines a distribution identity, build-time profiles, bundles, dependency resolution, desktop services, and release evidence into reproducible Electron inputs.

It is not a replacement for the DSH agent loop, session protocol, model runtime, or third-party plugin source. Upstream DSH owns those facts; this repository owns distribution composition, the desktop host, and build validation.

## Current Scope

- Electron host with Chromium sandbox, context isolation, and disabled Node integration.
- `distribution.yml` identity and `profiles/<name>/profile.yml` build-time composition.
- Resolved dependency closure, lockfile, SBOM input, license notices, and release checks.
- Static catalog with source, integrity, license, capability, and review facts.
- Public `@dsh-forge/desktop-services` contract for controlled Host integrations.

The packaged application binds one profile at build time. Development commands may select a profile with `--profile`; the shipped UI has no runtime profile switch, plugin marketplace, or online plugin installation. Current declared targets are macOS `arm64`/`x64` and Windows `x64`; production signing and notarization are not configured in this checkout.

## Quick Start

### Requirements

- Node.js `>=20.0.0`.
- pnpm `11.7.0`.
- A macOS or Windows environment that can run Electron.

Install dependencies and start the default development profile:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Use another development profile with `pnpm dev -- --profile developer`. Profile resolution and packaging consume the source files in `distribution.yml`, `profiles/`, `catalog/`, and `packages/bundles/`; generated files under `artifacts/` are disposable evidence, not hand-maintained inputs.

## Common Commands

```sh
pnpm run profile:resolve -- dsh-forge-official
pnpm run profile:verify -- dsh-forge-official
pnpm run package:desktop -- dsh-forge-official
pnpm run package:inspect -- dsh-forge-official
pnpm run package:smoke -- dsh-forge-official
```

Quality and documentation checks are:

```sh
pnpm run check:all
pnpm run docs:check
pnpm run docs:build
```

## Public Desktop Contract

Third-party bundles and Forks import only [`@dsh-forge/desktop-services`](packages/desktop-services/README.md). The package publishes typed `desktopProfiles`, `desktopPnpm`, and `desktopServices` services. [`desktop-services-local`](packages/desktop-services-local/README.md) is a private provider for the launcher and desktop layer; it is not a consumer API.

## Documentation

The public documentation map is [`docs/README.md`](docs/README.md). Architecture belongs to [`docs/design/dsh-forge.md`](docs/design/dsh-forge.md), stable configuration and service facts belong to [`docs/reference/foundation-contracts.md`](docs/reference/foundation-contracts.md), and source/artifact and recovery boundaries belong to [`docs/engineering/foundation-boundaries.md`](docs/engineering/foundation-boundaries.md). The profile compiler is documented in [`tools/profile-toolchain/README.md`](tools/profile-toolchain/README.md).

The repository maintains each public page as an English `foo.md`, Chinese `foo.zh.md`, and `foo.i18n.yaml` hash record. Translation governance is documented in [`docs/i18n/README.md`](docs/i18n/README.md).

## Fork Boundary

Forks change `distribution.yml`, create their own profile, review every external bundle in the static catalog, and rebuild the profile before packaging. Do not copy generated artifacts, DSH core, or third-party plugin source into a second source tree.
