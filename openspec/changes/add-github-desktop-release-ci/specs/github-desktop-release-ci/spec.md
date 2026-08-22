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
- **THEN** 任务上传 `runtime-manifest.json`、`package-evidence.json`、
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
- **THEN** 汇总任务生成包含三个交付目标、文件 SHA-256、profile、version 和 CI run id 的索引，
  并允许进入 tag Release 判断

#### Scenario: 缺少目标证据

- **WHEN** 任一交付目标没有 artifact、runtime manifest、native verification 或 smoke report
- **THEN** 汇总任务失败且不得创建 GitHub Release

### Requirement: tag Release 必须通过生产发布门禁

仅 `v*` tag 触发的发布路径可以创建 GitHub Release；tag 版本 SHALL 等于
`distribution.yml.version`，且所有目标的 `release:gate` 必须通过。unsigned smoke artifact
可以用于 tag 构建和诊断，但不得被标记为生产更新包或绕过签名/公证要求。

#### Scenario: 版本 tag 且门禁通过

- **WHEN** tag 与 distribution version 一致、矩阵完整、平台签名/公证证据齐全且
  `release:gate` 返回成功
- **THEN** release job 使用最小 `contents: write` 权限创建一个不可覆盖的 GitHub Release，
  附加安装包和汇总索引

#### Scenario: unsigned 或版本不匹配

- **WHEN** 任一目标仍是 `unsigned-smoke`、签名/公证缺失，或 tag 版本与 distribution version
  不一致
- **THEN** release job 失败，不创建生产 Release，并保留 CI artifact 供诊断

### Requirement: PR 和手动工作流不得取得发布写权限

Pull request 和 `workflow_dispatch` 路径 SHALL 只使用 `contents: read`，不得读取发布 secrets，
不得启动 package、summary 或 release job。只有 `v*` tag 可以生成 run-scoped desktop artifact；
只有同时显式启用生产发布的受保护 tag release job 可以请求 `contents: write` 和平台签名相关
secrets。

#### Scenario: 外部 pull request

- **WHEN** 外部 pull request 触发工作流
- **THEN** 工作流只执行 `validate`，不注入签名 secrets、不启动原生 runner、不上传 desktop
  package artifact，也不创建 Release

#### Scenario: 版本 tag 触发平台打包

- **WHEN** 仓库收到与 `distribution.yml.version` 一致的 `v*` tag
- **THEN** 工作流在 `validate` 通过后启动三个原生 package 任务和 summary，并将产物限定在
  当前 run；未显式启用生产发布时 release job 保持跳过
