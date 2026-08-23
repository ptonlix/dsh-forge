## Context

见 `proposal.md`。当前 `scripts/package-desktop.ts` 只执行当前宿主平台的 Electron
`--dir` 构建，并把一个 profile 固定进安装包；`distribution.yml` 声明
`darwin-arm64`、`darwin-x64`、`win32-x64`。`package:inspect`、`package:smoke` 和
`release:gate` 读取同一 profile artifact 中的 manifest/evidence。仓库没有现成
`.github/workflows`，也没有可把 unsigned 包当生产更新包的授权。

## Goals / Non-Goals

**Goals:**

- 在与目标 ABI 对应的 GitHub hosted runner 上构建每个平台交付目标；macOS 交付目标必须
  是一个同时包含 arm64/x64 的 universal 包，Linux 交付目标面向 Ubuntu 22.04 及以上
  LTS 的 x64 主机，避免用户下载两个 macOS 架构安装包。
- 让构建、证据、上传和 Release 汇总使用同一 profile 名称、distribution version 和
  输入 digest；失败目标不能被汇总 job 忽略。
- 让 pull request 和手动运行只执行代码、profile、catalog 与文档检查，让版本 tag 才使用
  原生 runner 构建 artifact 并走严格的 Release 门禁。
- 复用现有 profile-toolchain、`package:inspect`、`package:smoke` 和 `release:gate`，不在
  workflow 中重写解析、信任或恢复逻辑。

**Non-Goals:**

- 不在本变更中实现 signing/notarization/Authenticode provider、更新元数据服务或运行时
  更新客户端。
- 不允许发行包在运行时选择 profile，不新增在线插件下载或 GitHub Marketplace。
- Linux 仅支持 Ubuntu 22.04 及以上 LTS 的 x64 运行环境，不承诺其他发行版或 ARM Linux。

## Decisions

### 1. 使用原生 runner 的三目标矩阵

工作流矩阵固定为 `darwin-universal -> macos-14`、`win32-x64 -> windows-2022` 和
`linux-x64 -> ubuntu-22.04`，并在
脚本中再次核对 `process.platform/process.arch` 与 `distribution.yml`。macOS universal 构建
在 macOS runner 上同时准备 arm64/x64 的 Electron/native addon 输入，再由 electron-builder
生成一个 universal 应用和 `universal.dmg`；Windows 只构建 x64。选择原生 runner 是因为
`node-pty` 等 native addon 必须用目标 Electron ABI 重建，runner label 作为 workflow 常量
维护，平台淘汰时由一次变更更新矩阵。

Linux 构建使用 Ubuntu 22.04 runner，生成 x64 `AppImage` 与 `deb`；包的运行时兼容边界
记录为 Ubuntu 22.04 及以上 LTS，不承诺其他发行版或 ARM Linux。

### 2. 分离验证 job、构建 job 和汇总 job

`validate` 在 Ubuntu 上运行与平台无关的 typecheck、lint、profile/catalog/docs 门禁。
根 `typecheck` 在执行无输出的根 TypeScript 检查前，按 package exports 的依赖顺序构建
`desktop-services`、`profile-toolchain` 和 `desktop-services-local`；干净检出不得依赖本机残留的
`dist/*.d.ts`。
`package` 仅在 `v*` tag 上使用 `needs: validate` 的矩阵 job 执行 profile resolve、config
dump、目标打包、inspect、smoke，并上传一个按目标命名的 artifact。`release` 等待完整矩阵（不使用
`fail-fast`），下载全部 artifact 后验证 manifest 的 distribution/profile/version/target
一致性，再运行 `release:gate`；任何目标失败都阻止 Release。

这种分层避免重复静态检查，同时保留平台失败的独立日志。相比单 job 顺序构建，矩阵
还能确保一个平台失败时其他平台的证据仍可诊断。

### 3. 打包脚本提供显式 target 与 formats 参数

保留 `pnpm run package:desktop -- <profile>` 的默认行为，并增加仅供 CI/维护者使用的
`--target darwin-universal|win32-x64|linux-x64` 与 `--formats <csv>` 参数。脚本必须拒绝参数目标与
当前 runner、`distribution.yml` 不一致，并将实际架构集合写入 runtime manifest。CI 为
macOS 生成 `dmg,zip`，产物名中的架构固定为 `universal`；Windows 生成 `nsis,zip`，架构固定
为 `x64`；Linux 生成 `AppImage,deb`，架构固定为 `x64`。目录产物继续作为 inspect/smoke 的输入。安装包由同一次 builder 执行产生，命名
沿用 `${distribution.id}-${profile}-${version}-${os}-${arch}.${ext}`。

相比复制 MagicChat 的静态 `electron-builder.yml`，动态配置可以继续注入解引用 profile
闭包、resolved manifest、SBOM 和 license notice，也不会把未声明平台写进发行配置。

### 4. 证据优先于 Release 上传

每个 package job 将以下内容放入一个压缩 artifact：安装包、目录应用（如脚本生成）、
`runtime-manifest.json`、`package-evidence.json`、`native-verification.<target>.json`、
`package-smoke.<target>.json`、resolved manifest、SBOM 和 license notice。汇总 job 通过
结构化 manifest 索引检查“三个交付目标各一个、profile/version/digest 相同”，再决定是否允许
创建 Release。GitHub artifact 只是传输介质，权威事实仍是 profile artifact 中的 evidence。

### 5. 触发和权限采用最小授权

工作流响应 `pull_request` 和 `workflow_dispatch` 时只运行 `validate`，不创建 package、summary
或 Release job；只有 `push` 到 `v*` 才运行三平台 package 和 summary，且 tag 必须与
`distribution.yml.version` 一致。生产 Release 还要求仓库变量
`DSH_FORGE_PRODUCTION_RELEASE=true`，默认只保留 tag 对应的 run-scoped artifact。默认权限为
`contents: read`；只有启用后的 release job 使用环境保护和 `contents: write`。不把 secrets
暴露给 PR，签名相关环境变量只在受保护 release job 注入。

### 6. 失败与重跑语义

矩阵 job 使用 `fail-fast: false`，但 `release` 必须 `if: success()` 且检查三个 artifact
是否全部存在。缓存只缓存 pnpm store，缓存键包含 OS、arch、lockfile hash 和 Node/pnpm
版本；不缓存 `artifacts/`、`dist/`、native 二进制或最终安装包。重跑会生成新的 run-scoped
artifact，不覆盖源文件。

### 7. 跨平台 CLI 入口与长耗时构建

Node 工具不得直接执行 pnpm 的 `node_modules/.bin` shim。profile composer 通过固定依赖的
package manifest 解析 `@deepseek-ai/dsh` 的 JS bin，再由当前 Node runtime 执行；桌面打包脚本
通过 Electron package 返回的真实 runtime 获取 ABI，并通过真实 `electron-builder` JS CLI
启动构建。ABI 检查子进程清理继承的 `NODE_OPTIONS`，避免 tsx loader 污染 Electron 输出。

原生重建和 electron-builder 允许首次下载、缓存未命中及 macOS Universal 合并耗时；builder
超时提高到 15 分钟。所有失败统一记录 `spawnSync.error`、status、signal 以及有长度上限的
stdout/stderr，既保留诊断又避免把环境或凭据无限写入日志。

## Risks / Trade-offs

- [GitHub runner label 或镜像工具链变化] -> `pnpm 11.7.0` 要求 Node `>=22.13`，workflow
  固定 Node `22.14.0` 并在 job
  开始打印 runner、Electron、pnpm、profile 和 target；label 变化由验证失败暴露。
- [macOS/Windows secret 不完整] -> unsigned smoke 仍可上传诊断 artifact；tag Release 在
  `release:gate` 处明确失败，不创建生产 Release。
- [安装包体积较大、artifact 保留时间有限] -> 上传压缩包和结构化 evidence，设置明确
  retention-days；Release 只附安装包和证据索引。
- [builder 依赖网络或镜像不可用] -> 使用 lockfile/frozen install、Electron mirror
  环境变量和有限重试；不把未完成构建标记为成功。

## Migration Plan

1. 先合并 workflow、脚本参数和 CI fixture；pull request 和手动运行只验证代码与发行配置，
   使用版本 tag 生成 unsigned artifact。
2. 为仓库配置所需的 macOS/Windows 签名凭据和受保护 environment 后，使用版本 tag 验证
   `release:gate` 与 GitHub Release 权限。
3. 若需要回滚，禁用 workflow 的 tag trigger 并保留本地 `package:desktop`；不删除既有
   profile artifact 或历史 GitHub Release。

## Open Questions

无。平台矩阵、格式、触发和 unsigned/signed 边界已由当前 `distribution.yml`、发布门禁
和本变更规格确定。
