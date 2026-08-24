## Purpose

为 DSH Forge 提供可重复、可审计且按目标平台隔离的 GitHub Actions desktop 构建流程，
使声明的每个 macOS/Windows 架构都能产出独立包和对应的运行时验证证据。

## ADDED Requirements

### Requirement: CI 必须按声明目标在原生平台构建

GitHub Actions SHALL 为每个交付目标创建独立矩阵任务，并在目标平台 runner 上执行 Electron
native rebuild 和 desktop 打包。macOS 的交付目标 SHALL 是一个同时包含 `arm64` 和 `x64`
的 universal 包；Windows 的唯一交付目标 SHALL 是 `x64`；Linux 的唯一交付目标 SHALL 是
Ubuntu 22.04 及以上 LTS 可运行的 `x64` 包。任务必须拒绝未在
`distribution.yml` 中声明的平台/架构组合，且不得把一个交付目标的成功结果复用为另一个。

#### Scenario: universal macOS、Windows x64 与 Ubuntu Linux x64 构建

- **WHEN** 工作流以有效 profile 运行且 `distribution.yml` 声明 macOS `arm64/x64` 与
  Windows `x64` 以及 Linux `x64`
- **THEN** Actions 产生三个可区分的矩阵任务，macOS 上传一个包含两个架构的
  `universal.dmg`（以及对应 zip），Windows 只上传 x64 安装包和 zip，Linux 上传 x64
  `AppImage` 和 `deb`；每个任务记录 runner、target、Electron ABI，并只上传自身交付目标
  的包和证据

#### Scenario: runner 与声明目标不匹配

- **WHEN** 矩阵任务的实际 `process.platform` 与交付目标不一致，或 universal 包缺少任一
  macOS 架构
- **THEN** 打包命令失败并返回稳定的目标不支持错误，汇总任务不得将该目标标记为通过

### Requirement: 构建必须使用固定 profile 和锁定输入

CI SHALL 在打包前选择一个明确 profile，执行 `profile:resolve`、`profile:verify`、健康的
config dump、`catalog:verify` 以及 lockfile 冻结安装。发行包必须把该 profile 的 resolved
manifest、SBOM 输入和 license notice 作为证据随包归档；工作流不得在运行时切换 profile。
CI SHALL 使用满足 `pnpm 11.7.0` engine 的 Node.js `>=22.13`；当前固定版本为 `22.14.0`。
根 `typecheck` SHALL 在干净检出中先生成 workspace package exports 指向的类型声明，不得要求
仓库预先包含未跟踪的 `dist` 目录。

#### Scenario: profile 或依赖输入漂移

- **WHEN** profile、catalog、lockfile 或工具链校验失败
- **THEN** 当前平台不生成可发布包，任务输出失败诊断，且不上传伪造的成功 evidence

#### Scenario: pnpm 启动所需 Node runtime

- **WHEN** Actions 安装或调用固定的 `pnpm 11.7.0`
- **THEN** job 使用 Node.js `22.14.0`，可以加载 `node:sqlite`，且不得在 Node 20 上继续执行

#### Scenario: 干净检出执行 typecheck

- **WHEN** Actions 完成 frozen install 且 workspace package 尚无 `dist/*.d.ts`
- **THEN** `pnpm run typecheck` 先按依赖顺序构建 workspace 类型出口，再执行根 TypeScript 检查

#### Scenario: 手动运行选择 profile

- **WHEN** `workflow_dispatch` 提供一个有效 profile 名称
- **THEN** `validate` 使用该 profile 执行 resolve、verify 和 config dump，且不得启动平台打包
  矩阵或上传 desktop package artifact

### Requirement: 每个平台必须完成结构检查和真实 smoke

每个成功的 package 任务 SHALL 执行 `package:inspect` 和 `package:smoke`，生成带 target 后缀
的 native verification 与 package smoke report。macOS smoke SHALL 检查 universal 应用的
Mach-O 架构切片和 Electron ABI；Linux smoke SHALL 在 Ubuntu runner 上启动 AppImage 解包
目录或等价的 x64 应用入口；smoke 使用可清理的临时 DSH Home/用户数据，并核对 runtime
manifest 和最终包结构。

#### Scenario: 平台 smoke 通过

- **WHEN** 安装包启动、Host entry、profile Loader 和 native addon 校验全部成功
- **THEN** 任务在目标 runner 上生成并上传 `package-inspection.<target>.json`、
  `runtime-manifest.json`、`package-evidence.json`、
  `native-verification.<target>.json` 和 `package-smoke.<target>.json`

#### Scenario: 平台 smoke 失败

- **WHEN** 安装包无法启动、ABI 不一致、profile 闭包缺失或 smoke 超时
- **THEN** package 任务失败并保留诊断日志，release 汇总拒绝创建 Release

### Requirement: 产物必须按目标隔离并可汇总验证

工作流 SHALL 为每个目标上传独立且确定命名的安装包/归档和 evidence；汇总任务 SHALL 下载所有
目标 artifact，验证 distribution id、version、profile、input digest 和 target 一致性，
并在缺少任一目标或 evidence 时失败。

#### Scenario: 完整矩阵汇总

- **WHEN** universal macOS、Windows x64 与 Linux x64 artifact 均成功上传且 manifest 字段一致
- **THEN** 汇总任务生成包含三个交付目标、文件 SHA-256、profile、version、CI run id 和
  `package-inspection.<target>.json` 的索引，并允许进入 tag Release 判断；发布 runner 不重新
  检查其它平台的应用目录

#### Scenario: 缺少目标证据

- **WHEN** 任一交付目标没有 artifact、runtime manifest、native verification 或 smoke report
- **THEN** 汇总任务失败且不得创建 GitHub Release

### Requirement: tag Release 必须通过发布门禁

由 `push` 事件、GitHub Release `published` 事件或从 `v*` Tag ref 手动运行触发的 `v*` tag
发布路径可以创建或补充 GitHub Release；tag 版本 SHALL 等于
`distribution.yml.version`，且所有目标的 `release:gate` 必须通过。当前发布门禁 SHALL
允许明确标记为 `unsigned-smoke` 的安装包；本变更不要求代码签名、公证或自动更新 channel。

#### Scenario: 版本 tag 且门禁通过

- **WHEN** tag 与 distribution version 一致、矩阵完整、安装包结构、native evidence、SBOM、
  license 和真实 smoke 均通过且 `release:gate` 返回成功
- **THEN** release job 使用最小 `contents: write` 权限创建或补充 GitHub Release；push 或
  Tag ref 手动运行重新获取并校验 annotated tag，显式读取其正文作为发布公告，非 annotated
  Tag 直接失败；Release 事件向已有 Release 上传安装包和汇总索引且不覆盖已有公告；安装包
  可以是 `unsigned-smoke`

#### Scenario: 门禁失败或版本不匹配

- **WHEN** 任一目标缺少完整 evidence、真实 smoke 失败、`release:gate` 失败，或 tag 版本与
  distribution version 不一致
- **THEN** release job 失败，不创建 GitHub Release，并保留 CI artifact 供诊断

### Requirement: PR 和手动工作流不得取得发布写权限

Pull request 和普通分支上的 `workflow_dispatch` 路径 SHALL 只使用 `contents: read`，不得读取发布
secrets，不得启动 package、summary 或 release job。从 `v*` Tag ref 手动运行、`push` 或 Release
事件可以生成 run-scoped desktop artifact；
只有 package、summary 和 `release:gate` 全部成功的 tag release job 可以请求 `contents: write`。

#### Scenario: 外部 pull request

- **WHEN** 外部 pull request 触发工作流
- **THEN** 工作流只执行 `validate`，不注入签名 secrets、不启动原生 runner、不上传 desktop
  package artifact，也不创建 Release

#### Scenario: 版本 tag 触发平台打包

- **WHEN** 仓库收到与 `distribution.yml.version` 一致的 `v*` tag
- **THEN** 工作流在 `validate` 通过后启动三个原生 package 任务和 summary，并将产物限定在
  当前 run；完整门禁通过后 release job 创建 GitHub Release

#### Scenario: 普通分支手动运行

- **WHEN** 通过 `workflow_dispatch` 选择普通分支
- **THEN** 工作流只运行 `validate`，package、summary 和 release job 均被跳过

#### Scenario: GitHub 网页发布 Release

- **WHEN** 在 GitHub 网页发布一个带 `v*` Tag 的 Release
- **THEN** `release.published` 触发三平台构建，完成后向已有 Release 上传安装包和汇总索引

#### Scenario: Tag 在构建期间漂移

- **WHEN** release job 发现 `${GITHUB_REF_NAME}^{commit}` 与 `GITHUB_SHA` 不一致
- **THEN** release job 在下载产物或创建 GitHub Release 前失败

### Requirement: 跨平台工具入口必须独立于 pnpm shim

profile resolve、Electron ABI 检查和 electron-builder SHALL 通过固定 package manifest 解析真实
JS bin 或 Electron runtime，不得直接执行 `node_modules/.bin` 下的 POSIX shell 或 Windows cmd
shim。用于 ABI 查询的 Electron 子进程 SHALL 清理继承的 `NODE_OPTIONS`，并在失败时记录启动错误、
退出状态、signal 以及长度受限的 stdout/stderr。

#### Scenario: macOS 和 Linux ABI 查询

- **WHEN** 原生 runner 运行 `package:desktop`
- **THEN** ABI 查询使用已安装的 Electron 43.4.0 runtime 输出合法 ABI，并继续进入 native rebuild；
  不因 `.bin/electron` shim 或 tsx loader 造成空/非 JSON 输出而失败

#### Scenario: Windows profile 与 builder 启动

- **WHEN** Windows x64 runner 运行 profile resolve 或 electron-builder
- **THEN** 子进程由 Node 直接执行真实 JS 入口，不依赖 `.bin/dsh`、`.bin/electron-builder` 的
  shell/cmd 文件，并且启动失败会显示可操作的 `ENOENT`/`EACCES` 等错误

#### Scenario: 首次构建耗时较长

- **WHEN** builder 首次下载缓存缺失、执行 Universal 组合或执行原生依赖重建
- **THEN** package job 使用不少于 15 分钟的 builder 超时预算，超时仍以失败结束并保留结构化诊断
