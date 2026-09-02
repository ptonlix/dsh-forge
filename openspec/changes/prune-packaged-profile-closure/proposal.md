## Why

官方桌面包把 profile `node_modules` 原样解引用复制进安装树。当前 macOS 产物里，source map、Windows PDB、非目标架构的 `node-pty` prebuilds、文档/demo，以及 `dsh-better-sidebar` 嵌套的第二份 `node-pty`，使安装后体积接近 1 GB，其中约 200 MB 不是当前目标的运行时文件。SBOM 与 lockfile 仍按包名、版本和 integrity 审计；这些文件不必随安装包交付。

## What Changes

- 在最终应用写入 profile 闭包之后、生成 runtime manifest 之前，按当前打包目标裁剪 `dsh-forge/profile/node_modules`。
- 删除 `*.map`、`*.pdb`、非目标 `os-arch` 的 `node-pty/prebuilds`、`**/demo/**` 以及 Markdown 文档；保留 `LICENSE` 类许可证文件。
- 当 hoist 的 `node-pty` 与嵌套副本名称和版本一致时，删除 `dsh-better-sidebar/node_modules/node-pty`，只保留 hoist 的一份。
- 裁剪不得删除 lockfile 声明的包目录、不得改 SBOM/catalog，也不得让当前目标缺少可加载的 `node-pty` prebuild。
- 为裁剪规则增加可重复的单元测试，并让 `package:inspect` 在裁剪后的树上手动/门禁验证 native 清单。

## Capabilities

### New Capabilities

- `packaged-profile-closure-prune`: 打包应用在注入 profile 闭包后，按目标平台删除非运行时文件，同时保留当前目标的 native addon 与包级审计事实。

### Modified Capabilities

无。根 `openspec/specs/` 没有已归档的对应 capability；本次不修改其他变更目录中的历史 spec。

## Impact

- 影响 `scripts/package-desktop.ts` 的 profile 闭包复制，以及可能抽出的可测试裁剪 helper。
- 影响 `package:inspect` / runtime manifest：扫描到的 native 文件集合会变小，但必须与裁剪后的树一致。
- 不影响 profile compiler、catalog、lockfile、SBOM 生成或第三方 bundle 源码。
- 文档需把“完整闭包”澄清为：锁定包集合完整，安装树不含调试符号、文档和异架构 prebuild。
