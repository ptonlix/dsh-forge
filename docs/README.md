# DSH Forge Documentation

English | [中文](README.zh.md)

This map points readers to the single owner of each public DSH Forge fact. It covers the current Electron distribution only; it does not describe an application plugin marketplace, runtime profile UI, or online installation flow.

## Start Here

- [`../README.md`](../README.md): project scope, prerequisites, and common commands.
- [`design/dsh-forge.md`](design/dsh-forge.md): distribution architecture, ownership, and runtime lifecycle.
- [`reference/foundation-contracts.md`](reference/foundation-contracts.md): configuration and public desktop service contract.
- [`engineering/foundation-boundaries.md`](engineering/foundation-boundaries.md): source/derived files, recovery, installation, and release boundaries.

## Package Documentation

- [`../packages/desktop-services/README.md`](../packages/desktop-services/README.md): public consumer API for Host plugins.
- [`../tools/profile-toolchain/README.md`](../tools/profile-toolchain/README.md): profile compilation, validation, and release tooling.

`../packages/desktop-services-local/README.md` and [`engineering/foundation-verification.md`](engineering/foundation-verification.md) are internal maintenance records. They remain in the repository but are not public site pages or third-party consumer documentation.

## Language Maintenance

Every page in this map has an English source, Chinese sibling, and `foo.i18n.yaml` consistency record. Read [`i18n/README.md`](i18n/README.md) before changing a public page. The static site projects these canonical files; it does not keep a second copy of their prose.
