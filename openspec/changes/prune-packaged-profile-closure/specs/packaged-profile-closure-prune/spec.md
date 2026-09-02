## Purpose

在桌面打包把锁定的 profile 依赖写入安装树之后，删除当前目标不需要的调试、文档和异架构 native 文件，同时保留可加载的 addon 与包级审计事实。

## ADDED Requirements

### Requirement: 闭包裁剪发生在注入之后、清单之前

桌面打包流程 SHALL 在最终应用的 `dsh-forge/profile/node_modules` 写入完成后，对这棵目录执行目标相关裁剪。runtime manifest 与 package inspect SHALL 只描述裁剪后的文件集合。裁剪 MUST 不得修改 profile lockfile、resolved manifest、SBOM 或 catalog。

#### Scenario: 生成已解包应用

- **WHEN** 打包脚本把 profile `node_modules` 复制进最终应用
- **THEN** 在生成 runtime manifest 之前完成裁剪
- **AND** 清单中的 native 文件与裁剪后目录中的 `.node` 和 helper 一致

### Requirement: 删除非运行时文档与调试文件

对 `dsh-forge/profile/node_modules` 内的文件，打包流程 SHALL 删除：

- 扩展名为 `.map` 的 source map
- 扩展名为 `.pdb` 的调试符号
- 名为 `demo` 的目录及其内容
- 扩展名为 `.md` 或 `.markdown` 的文档

许可证文件 MUST 保留，包括不带扩展名的 `LICENSE`/`LICENCE`/`COPYING`，以及 `LICENSE.txt`、`LICENSE.md`、`LICENCE.md` 和 `COPYING.md`。裁剪 MUST 不得删除包的 `package.json`。

#### Scenario: 含 map 与 README 的包

- **WHEN** 某依赖同时包含 `dist/index.js.map`、`README.md` 和 `LICENSE`
- **THEN** 安装树删除 map 与 README，保留 `LICENSE` 与运行时 JS

#### Scenario: Windows PDB 出现在非 Windows 目标

- **WHEN** 目标操作系统不是 `win32`，且闭包中存在 `.pdb`
- **THEN** 这些 `.pdb` 不得出现在最终应用中

### Requirement: 只保留当前目标的 node-pty prebuilds

对每个 `node-pty` 包目录中的 `prebuilds/<os>-<arch>`，打包流程 SHALL 只保留当前打包目标声明的操作系统与架构组合。`darwin-universal` SHALL 同时保留 `darwin-arm64` 与 `darwin-x64`。其他 `os-arch` 目录 MUST 删除。当前目标若既没有匹配的 `prebuilds/<os>-<arch>`，也没有 `build/Release/pty.node`，打包 MUST 失败。Linux 与 Windows 的 Electron rebuild 把 addon 写到 `build/Release`，不得仅因缺少 prebuild 目录而失败。

#### Scenario: 打包 darwin-arm64

- **WHEN** 目标是 `darwin` + `arm64`
- **THEN** 保留 `prebuilds/darwin-arm64`
- **AND** 删除 `prebuilds/win32-x64`、`prebuilds/win32-arm64`、`prebuilds/linux-x64`、`prebuilds/darwin-x64` 以及其中的 PDB 与 EXE

#### Scenario: 打包 darwin-universal

- **WHEN** 目标是 `darwin` + `arm64` 与 `x64`
- **THEN** 同时保留 `prebuilds/darwin-arm64` 与 `prebuilds/darwin-x64`
- **AND** 删除非 Darwin 的 prebuild 目录

#### Scenario: 打包 linux-x64 且只有 rebuild 输出

- **WHEN** 目标是 `linux` + `x64`，且 `node-pty` 只有 `build/Release/pty.node`、没有 `prebuilds/linux-x64`
- **THEN** 打包成功
- **AND** 异架构 `prebuilds` 目录仍被删除

### Requirement: 删除与 hoist 副本相同的嵌套 node-pty

若 `node_modules/node-pty` 存在，且某包下的 `node_modules/node-pty` 与其 `package.json` 的 `name` 和 `version` 相同，打包流程 SHALL 删除该嵌套副本。版本或名称不一致时 MUST 保留嵌套副本。

#### Scenario: better-sidebar 嵌套相同版本

- **WHEN** hoist 的 `node-pty` 与 `dsh-better-sidebar/node_modules/node-pty` 名称和版本相同
- **THEN** 删除嵌套目录
- **AND** hoist 的 `node-pty` 仍可从 profile 包锚点解析

#### Scenario: 嵌套版本不同

- **WHEN** 嵌套 `node-pty` 的 version 与 hoist 副本不同
- **THEN** 两份目录都保留，并各自按当前目标裁剪 prebuilds
