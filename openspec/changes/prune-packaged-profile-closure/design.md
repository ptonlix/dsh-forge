## Context

`copyPackagedProfileClosure()` 把已物化 profile 的 `node_modules` 解引用复制到最终应用的 `dsh-forge/profile`。pnpm 的嵌套链接因此变成多份实体目录；`node-pty` 的 npm 包还携带全平台 prebuilds 和 Windows PDB。runtime manifest 在复制之后扫描 `.node` 与 helper，因此裁剪必须发生在扫描之前。动机见 `proposal.md`。

## Goals / Non-Goals

**Goals:**

- 在打包脚本内对已复制的 profile `node_modules` 做确定性、按目标的文件删除。
- 把裁剪规则抽成可单测的纯文件系统函数，不依赖完整 Electron 打包。
- 保持当前目标的 `node-pty` 仍可从 `prebuilds/<os>-<arch>` 或 `build/Release` 加载。
- 更新工程文档中“完整闭包”的含义，避免读者以为 map/PDB 也必须上船。

**Non-Goals:**

- 不改插件发布物、lockfile、catalog、SBOM 或 profile compiler。
- 不删除 `.d.ts`、`typescript`、`mermaid`、`react-icons` 或 Electron 语言包。
- 不把 profile `node_modules` 打进 asar，也不改 Universal 与分架构发行策略。
- 不在 `cpSync` 的 filter 里做裁剪：需要先得到完整树，再按目标删除，并比较嵌套 `node-pty` 版本。

## Decisions

1. **所有权在打包脚本，不进 profile-toolchain 公开 API。**
   裁剪只作用于安装树，不是 compiler 契约。将函数放在 `scripts/` 旁的可导入模块（例如 `scripts/prune-packaged-profile-closure.ts`），由 `package-desktop.ts` 调用。替代方案是写进 `profile-toolchain`；那会把发行体积策略泄漏给非 Electron 消费者。

2. **先复制、再裁剪、再扫描 native。**
   继续在 builder 之后复制完整闭包，然后对目标目录 prune，最后 `createRuntimeManifest`。若在源 profile 上 prune，会污染后续 inspect 以外的 artifact，并破坏 Windows 短路径 rebuild 使用的源树。

3. **目标来自本次打包的 `os` + `architectures`，与 rebuild 相同。**
   `darwin-universal` 保留 `darwin-arm64` 与 `darwin-x64`。不按 `process.arch` 猜测，避免 Universal 丢掉另一切片。

4. **嵌套 `node-pty` 仅在 name+version 与 hoist 副本一致时删除。**
   覆盖 `dsh-better-sidebar/node_modules/node-pty` 以及任何同样重复的嵌套副本。版本不同则保留，避免 Node 解析到错误 ABI。替代方案是无条件删嵌套目录，风险是双版本并存时启动失败。

5. **许可证白名单按文件名，不按目录。**
   保留 `LICENSE`、`LICENCE`、`COPYING` 及其 `.md`/`.txt` 变体（大小写不敏感）。其他 `.md` 删除。不保留 `README.md`。

6. **当前目标既没有匹配 prebuild、也没有 `build/Release/pty.node` 则失败。**
   Linux/Windows 的 `@electron/rebuild` 把 addon 写到 `build/Release`；Darwin Universal 才把输出放进 `prebuilds/darwin-*`。使用稳定错误 code `PACKAGE_PROFILE_PTY_PREBUILD_MISSING`。只在闭包确实包含 `node-pty` 时检查。

## Risks / Trade-offs

- [某包运行时读取 README.md] → 规格明确只删文档；若 smoke 失败再对该包加白名单，不预先保留全部 Markdown。
- [node-pty loader 仍查找 `build/Release` 或 `bin/`] → 现有打包已从 app.asar 排除这两处，profile 侧 Universal 也会清 `build/Release`；prune 不删当前目标 `prebuilds`。inspect/smoke 验证加载路径。
- [删除嵌套副本后，模块解析走 hoist] → 仅在 version 相同时空；Node 从包目录向上查找 `node_modules/node-pty`。
- [Windows 仍需要 `.exe` helper] → 只删 `.pdb` 和异架构目录，保留当前 `win32-<arch>` 中的 `.exe`/`.node`。
- [安装包体积降幅小于安装后] → 可接受；P0 目标是安装后体积，map/PDB 对 DMG 压缩贡献有限。

## Migration Plan

已发布安装包不会自动变小，必须重新 `package:desktop`。无需迁移用户数据。回滚即去掉 prune 调用并重新打包。SBOM 与 lockfile 不变，不需要新的 artifact digest 兼容层。
