# 基础契约验证记录

本记录对应 OpenSpec 变更 `establish-dsh-forge-foundation-contracts` 以及后续的
`align-repository-with-distribution-design`。以下命令于 2026-08-19 在 macOS 开发环境执行；
结果覆盖当前工作区的 schema、profile 编译、真实 DSH 配置转储、generation/service 契约、
catalog、更新签名、目录边界和未签名 Electron 产物输入。

## 本地桌面开发启动

安装依赖后，可直接使用以下命令启动未打包的 Electron 桌面端：

```sh
pnpm dev
```

该命令会先编译 TypeScript 和 workspace 包，再执行 Electron。启动 profile 默认读取
`distribution.yml` 的 `defaultProfile`（当前为 `dsh-forge-official`），因此开发启动不需要追加
profile 参数。需要启动仓库中的其他 profile 时，使用 `pnpm dev -- --profile <name>`；启动器会将
已选 profile 写入 `~/.dsh/profiles/<name>`，但拒绝覆盖没有 DSH Forge 归属标记的同名目录。

```sh
pnpm run check
pnpm run acceptance
pnpm run profile:resolve
pnpm run profile:verify
pnpm run dump-config -- dsh-forge-official
pnpm run catalog:verify
pnpm run check:all
pnpm run boundaries:check
pnpm run profile:resolve -- developer
pnpm run profile:verify -- developer
pnpm run dump-config -- developer
pnpm dev -- --profile developer
pnpm run package:desktop -- developer
pnpm run package:inspect -- developer
pnpm run package:smoke -- developer
pnpm run package:desktop -- dsh-forge-official
pnpm run package:inspect -- dsh-forge-official
pnpm run package:smoke -- dsh-forge-official
pnpm run docs:check
git diff --check
openspec validate "align-repository-with-distribution-design" --type change --strict --no-interactive
```

已通过的本地证据包括 40 个测试、临时目录冻结 pnpm 锁解析、官方与 developer profile
产物隔离、真实 DSH patch dump、generation 恢复与进程树取消、静态 catalog、Ed25519 更新
元数据校验、Fork 身份投影、Markdown 链接检查、目录边界检查、OpenSpec 严格校验，以及
清理旧 `dist` 后的重新构建。Electron 目录产物的 `package:inspect` 和 `package:smoke` 均
已在当前 macOS arm64 环境通过。

当前没有 macOS 代码签名/公证身份或 Windows Authenticode 身份。`pnpm run package:signing -- darwin` 因缺少身份以退出码 2 结束，明确只允许 `unsigned-smoke`；`release:gate` 必须拒绝生产发布。

## 文档站实施验证（2026-08-22）

本次双语文档与静态站变更实际运行了以下门禁：

```sh
pnpm exec vitest run tests/bilingual-docs.test.ts tests/website-docs.test.ts
pnpm run docs:check
pnpm run docs:build
DOCS_BASE=/dsh-forge/ pnpm run docs:build
./node_modules/.bin/tsc -p tsconfig.json --noEmit
pnpm dlx @fission-ai/openspec@latest validate redesign-bilingual-documentation-site --type change --strict --no-interactive
git diff --check
```

文档站构建输出 14 个双语路由、raw Markdown twin 和 `llms.txt`，并通过站内链接、fragment、发布清单与 GitHub Pages base path 检查。构建只使用仓库内容和 website workspace 依赖，不读取 Electron、DSH Home、profile 产物或外部插件状态。

`pnpm run check:all` 曾在文档站变更期间运行但未通过：当时既有运行时测试要求官方外部 bundle
`dsh-better-sidebar` 的 catalog tier 为 `L1`，而 `catalog/catalog.yml` 记录为 `L0`，因此
compiler、composer、acceptance 和 profile selection 测试在该事实冲突处失败。当前发行 CI 变更已
按编译器契约将该外部 bundle 记录修正为 `L1`，本段保留历史验证事实，不代表当前门禁状态。

本次没有执行 GitHub Pages 实际部署、token/凭据验证、平台签名、公证、Authenticode 或生产发布 smoke；这些能力不属于本变更的授权范围。

当前仍没有 macOS 代码签名/公证身份或 Windows Authenticode 身份；本次 Electron 产物明确标记为
`unsigned-smoke`，不能作为生产发布证据。Windows 目标、macOS 签名/公证、native ABI 和
更新发布链路仍需在对应平台构建机与平台身份上执行。

## 官方 profile 发行验证（2026-08-21）

在本机 macOS arm64 对 `dsh-forge-official` 执行了 `profile:resolve`、`profile:verify`、config
dump、catalog 验证、`package:desktop`、`package:inspect` 和 `package:smoke`。产物中的
`Contents/Resources/dsh-forge/profile/node_modules` 是从物化 profile 解引用复制的完整闭包；Windows
产物对应路径为可执行文件同级的 `resources/dsh-forge/profile/node_modules`。package inspect
在打包 Electron runtime 中通过 Cordis Loader 导入每个 profile entry，覆盖
`dsh-better-sidebar` 对 `@deepseek-ai/dsh-llm` 等 peer 的动态解析链。

本次 native evidence 以 `native-verification.darwin-arm64.json` 和
`package-smoke.darwin-arm64.json` 保存，记录 Electron `43.4.0`、ABI `148`，并引用同一 runtime
manifest 的 SHA-256 `f340ff5fc1afb36b76433611836e8087cacc797b7f67f3e08b653000891462e1`。manifest 与
evidence 均保存在对应 profile artifact 中，记录所有最终 `.node` 文件和 native helper 的安全相对路径、
可执行位与 SHA-256。`release:gate` 汇总 artifact 内按目标命名的 smoke evidence，并要求每个声明目标
都有独立的通过记录。

`darwin-x64` 与 `win32-x64` 没有本机 native evidence，仍是发布门禁。它们不得因本次
`darwin-arm64` smoke 通过而标记为已验证；`release:gate` 会继续拒绝缺少声明目标 evidence 的发布。

## GitHub Desktop Release CI（2026-08-22）

`add-github-desktop-release-ci` 引入 `.github/workflows/release-desktop.yml`，使用三个原生
runner 目标：`macos-14` 构建一个同时包含 `arm64/x64` 的 `darwin-universal`，`windows-2022`
构建 `win32-x64`，`ubuntu-22.04` 构建面向 Ubuntu 22.04 及以上 LTS 的 `linux-x64`。对应输出为
`universal.dmg`/zip、Windows x64 `nsis`/zip 和 Linux x64 `AppImage`/deb；每个目标还上传
`runtime-manifest.json`、`package-evidence.json`、native verification、smoke report、resolved
manifest、SBOM 输入和许可证通知。

工作流分为 `validate`、原生 `package` 矩阵和 `summary`/`release`。Pull request 与
`workflow_dispatch` 只执行 `validate`，不会启动 macOS、Windows 或 Linux runner；只有与
`distribution.yml.version` 一致的 `v*` tag 才启动三平台 package 和 summary。summary 使用
`pnpm run release:index` 检查三个目标是否齐全，并比较 distribution、version、profile、input
digest 及文件 SHA-256；缺少或漂移的 evidence 会阻止后续 job。普通 job 只有
`contents: read`，tag 打包只产生 run-scoped artifact。生产 Release 默认关闭；只有仓库变量
`DSH_FORGE_PRODUCTION_RELEASE=true`、签名/公证证据齐全且 `release:gate` 通过时，受保护的
release job 才会请求 `contents: write`。

当前仍未配置或执行代码签名、公证和 Windows Authenticode。unsigned smoke artifact 可以用于
诊断和平台验证，但 `release:gate` 会拒绝未签名或缺少更新信任根的生产 Release。Linux 只承诺
Ubuntu LTS x64；未覆盖 ARM Linux、其他发行版和跨平台交叉编译。
