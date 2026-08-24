# DSH Forge Distribution Architecture

English | [中文](dsh-forge.zh.md)

## Scope

This document is the canonical architecture description for the DSH Forge desktop distribution. It describes how this repository composes an auditable Electron application around upstream DeepSeek Harness (DSH). DSH owns the agent loop, session protocol, model runtime, Host, Web Client, and Cordis semantics; this repository owns distribution identity, profile composition, desktop hosting, and release evidence.

The current implementation uses Electron. Tauri, an in-app plugin marketplace, runtime profile switching, and online plugin downloads are outside this release and require separate changes before they can be documented as product capabilities.

## Architecture

```text
distribution.yml + profile.yml + bundle + catalog
                         |
                         v
                 profile-toolchain
                         |
                         v
       resolved profile / lockfile / SBOM / manifest
                         |
                         v
              Electron launcher + Host generation
                         |
                         v
                   sandboxed renderer
```

`distribution.yml` is the identity source. Each `profiles/<name>/profile.yml` is the hand-maintained composition source. Bundles declare their DSH manifest and dependencies. `catalog/catalog.yml` records static source, integrity, license, capability, platform, and review facts. Generated profile directories, lockfiles, resolved manifests, and packages are evidence under `artifacts/` and must not become a second source tree.

## Runtime Ownership

The Electron launcher owns the single-instance lock, native runtime, window, profile binding, and process teardown. The Host Cordis generation owns the selected profile's DSH services and the loopback Web surface. The desktop layer publishes typed services inside the generation. Third-party bundles use the public [`@dsh-forge/desktop-services`](../reference/foundation-contracts.md) contract and never receive raw Electron objects, launcher paths, or arbitrary package-manager arguments.

The renderer always uses Chromium sandbox, context isolation, and disabled Node integration. Navigation is limited to the current generation's loopback authority; supported external HTTP(S) and mail links go to the operating system. Plugins execute as `trusted-in-process`: catalog review and user confirmation are audit and authorization controls, not a Node or Electron process sandbox.

## Generation Lifecycle

1. The launcher acquires the single-instance lock and resolves the build-bound profile. Development may select a repository profile with `--profile`.
2. It prepares the shared DSH Home and profile paths without copying sessions or credentials into Electron `userData`.
3. It creates a Host generation and injects the desktop layer.
4. The Host loads bundles in profile order, binds a random loopback port, and reports readiness.
5. Electron creates the secured window and waits for the renderer boot report.
6. Only after Host, loopback, window, and renderer readiness succeed does the generation become `last-known-good`.

Closing a window hides it by default. Explicit exit, signals, generation failure, and profile restart perform bounded teardown of the Host and managed process tree. A failed pending generation retains its failure fact and may recover once to the previous known-good target; a second failure requires manual recovery.

## Composition and Release

The compiler resolves runtime compatibility, bundle manifests, peer dependencies, static catalog entries, exact Git commits, lifecycle-script authorization, and the dependency closure. The input digest covers the cross-platform source inputs and the normalized YAML semantics of the root lockfile; the platform-selected closure remains resolution evidence in the resolved manifest and SBOM. The composer runs the real DSH loader to produce a configuration dump; a healthy dump is required for verification and packaging.

The release gate also checks package layout, dynamic imports, native files, SBOM and license notices, platform evidence, smoke results, signing, and update trust configuration. A local unsigned smoke proves only local structure and startup behavior; it cannot authorize production release.

## Fork Contract

Fork maintainers change the distribution identity, add a profile, audit external bundles in the static catalog, and rebuild from source. They do not copy DSH core, third-party plugin source, generated artifacts, or private provider code. The stable source/derived-file, installation, recovery, and release boundaries are defined in [`../engineering/foundation-boundaries.md`](../engineering/foundation-boundaries.md); configuration and public service details are defined in [`../reference/foundation-contracts.md`](../reference/foundation-contracts.md).

## Verification

Use the root scripts for the workflow relevant to a change:

```sh
pnpm run profile:resolve -- dsh-forge-official
pnpm run profile:verify -- dsh-forge-official
pnpm run package:desktop -- dsh-forge-official
pnpm run package:inspect -- dsh-forge-official
pnpm run package:smoke -- dsh-forge-official
```

The architecture document does not claim platform signing, notarization, or GitHub Pages deployment. Those facts belong to the engineering verification record and the documentation-site build output.
