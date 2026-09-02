---
name: dsh-forge-add-plugin
description: 将 npm 包或 GitHub 仓库中的已验证 DSH bundle 引入 dsh-forge-official 或 developer profile；当用户要求添加、审核、锁定并验证插件时使用。
---

# DSH Forge 插件引入

将用户指定的第三方 DSH bundle 审核、锁定并引入目标 profile。此 skill 操作的是发行组合源，
不是运行时插件市场；最终 Electron 包在构建期固定 profile，页面端不会下载或安装插件。

## 输入和目标 profile

接受一个 npm 包名（可带精确版本）或 GitHub 仓库 URL，并可在自然语言中指定目标：

- 未指定目标、`official` 或 `office` 都表示 `dsh-forge-official`。
- `developer` 表示 `developer`。
- npm 输入未带版本时，查询 registry 的当前发布版本后将其固定为精确 SemVer；绝不把
  `latest`、范围版本或 tag 写入 `package.json`、profile 或 catalog。
- GitHub 输入必须能解析为 HTTPS 仓库和完整 40 位 commit。仅给出仓库 URL 时，bundle
  必须位于仓库根；根目录不是 bundle 时，要求用户提供准确的 package 子目录，不能猜测。

只接受自身 `package.json` 声明了 `dsh.bundle.patch`、patch 文件存在且会注册实际 entry
的 bundle。不能把普通 npm 包、原始插件源码、`@dsh-forge/desktop-layer` 或只重复挂载同一
entry 的空 wrapper 加入 profile。

## 必须先判断的来源边界

`dsh-forge-official` 的外部 bundle 只支持已发布的 npm 包：编译器要求 package 名称、精确
版本和 lockfile integrity 与 L1 catalog 条目一致，且 catalog 来源必须是 npm。用户只给出
GitHub URL 时：

- 若同一 bundle 存在可审计的 npm 发布版本，征得用户同意后按 npm 来源引入 official。
- 否则不能把该仓库直接引入 official，也不能修改校验、降级 catalog 或新建 wrapper 绕过。
  说明限制，并建议 `developer` 或先发布该 bundle 到 npm。

`developer` 可以使用 GitHub 来源，但依赖 spec 必须固定完整 commit；branch、tag、`main`
和浮动 URL 都必须拒绝。GitHub 仓库中的子目录 bundle 只有在用户明确给出路径时才可使用。

## 工作流

### 1. 建立变更范围

1. 读取根 `AGENTS.md`、`git status --short`、目标 profile、根 `package.json`、
   `pnpm-lock.yaml`、`catalog/catalog.yml` 和相关 active OpenSpec。先读取已有修改，使用
   可审查 patch 保留它们；禁止 reset、checkout 或手工修改 `artifacts/`。
2. profile、catalog、依赖来源和安装包闭包属于受控发行行为。为本次引入创建或更新活动
   OpenSpec 变更，记录目标 profile、来源、版本、能力、脚本、信任模式、验证平台和非目标；
   不修改归档变更。
3. 列出只会修改的手工源：根 `package.json`、`pnpm-lock.yaml`、
   `catalog/catalog.yml`、目标 `profiles/<name>/profile.yml`、必要的
   `pnpm-workspace.yaml`、当前 OpenSpec 和相应测试/文档。不要修改生成 profile、SBOM、
   notice 或 package evidence。

### 2. 获取并审计 bundle

1. npm 来源先查询 package 元数据与精确 tarball/integrity；GitHub 来源先用
   `git ls-remote` 解析 HEAD 或用户给出的 ref 到完整 commit，再在 `mktemp -d` 下获取该
   commit 的源码。下载或检查期间不得执行 package 生命周期脚本。
2. 读取 bundle manifest、patch、许可证、依赖、peer、可选依赖、生命周期脚本和
   `pnpm.allowBuilds`。确认 package 名称与 profile 声明一致、Cordis peer 与 runtime
   相容、所有 Git 依赖都固定完整 commit，并检查 patch 没有重复 entry。
3. 审阅源码和依赖闭包，基于实际行为记录 capabilities、`pluginRequest`、维护者、脚本和
   `trusted-in-process` 风险。使用 desktop 能力时，bundle 只能消费
   `@dsh-forge/desktop-services` 公开入口；不得导入 `desktop-services-local`、Electron、
   launcher、原始 IPC 或其他 workspace 的 `src/`。
4. 若发现生命周期脚本或 `allowBuilds`，在执行任何会运行脚本的 profile resolve 或 package
   命令前，向用户展示包名、脚本内容和将加入的 build 授权，等待明确确认。确认前可使用
   `--ignore-scripts` 解析元数据，不能把授权默认为 true。

### 3. 先取得真实平台证据

新的 L1 catalog 记录必须只填写已经实际验证的平台，不能把目标发行平台、CI 平台或用户
期望当成 `verifiedOn`。若没有可复用的审核证据：

1. 创建仅供本次验证的临时 profile，名称使用 `plugin-check-<bundle-id>`，复制
   `developer` 的 runtime 与基础 bundle，再加入候选 bundle。该 profile 不得成为默认
   profile，也不得提交或留在工作树中。
2. 用精确依赖执行 `profile:resolve`、`profile:verify`、`dump-config`、
   `package:desktop`、`package:inspect` 和 `package:smoke`。Linux runner 需要显示服务时，
   使用可用的 `xvfb-run` 包装 smoke。
3. 只有 smoke 成功后，才可将当前实际 OS/架构写入 catalog 的 `verifiedOn` 与当前日期
   写入 `verifiedAt`。验证结束后仅删除本次创建的临时 profile；失败时保留错误输出和
   artifacts 作为证据，但不要提升到目标 profile 或伪造审核事实。

### 4. 写入可审计组合

1. 用 `pnpm add -w --save-exact <package>@<version> --ignore-scripts` 将 npm bundle 写为根
   依赖并更新根 lockfile。GitHub developer bundle 使用固定 commit 的 Git spec 与同样的
   `--ignore-scripts`；绝不将 URL、branch 或 tag 直接写入依赖。
2. 在 `catalog/catalog.yml` 创建或更新同名条目。L1 条目必须如实包含精确版本、来源、
   integrity、许可证、维护者、依赖和脚本摘要、capabilities、`verifiedOn`、`verifiedAt`、
   `hostSupport`、`pluginRequest`、`grant`、`audit`、
   `executionMode: trusted-in-process` 和 `enforcement: unavailable`。npm 条目的 registry、
   tarball 和 integrity 必须与根 lockfile 的实际解析一致；Git 条目必须记录 HTTPS
   repository、完整 commit 和可重算的 source integrity。
3. 仅在用户确认的脚本需要执行时，为明确的包名更新 `pnpm-workspace.yaml` 的
   `allowBuilds`；已有 `false` 授权不能改成 `true`。catalog 的脚本摘要、OpenSpec 与该
   选择必须同步。
4. 在目标 `profiles/<name>/profile.yml` 的有序 `bundles` 中添加 bundle 名称一次。禁止顶层
   `plugins`，禁止重复 bundle，禁止持久化 `@dsh-forge/desktop-layer`。profile 名称、
   bundle 名称和 package manifest 名称必须一致。
5. 更新 OpenSpec 的任务状态、必要测试和最短 README 入口；不要把完整审核步骤复制回
   README。

### 5. 验证与交付

按目标 profile 运行，记录每个实际结果：

```sh
pnpm run catalog:verify
pnpm run profile:resolve -- <profile>
pnpm run profile:verify -- <profile>
pnpm run dump-config -- <profile>
pnpm run package:desktop -- <profile>
pnpm run package:inspect -- <profile>
pnpm run package:smoke -- <profile>
pnpm run docs:check
git diff --check
```

`package:desktop` 默认只构建当前 runner 的未封装 `dir` 产物；它与随后 `package:smoke`
共同构成当前平台的真实 Electron 验证。需要安装包时，仅在对应原生 runner 上增加
`--target` 与 `--formats`。不要把未运行的其他平台、签名、公证、更新或 release gate 写成
通过。

交付时报告选定 profile、来源、固定版本或 commit、catalog 审核事实、脚本授权、修改文件、
实际通过/失败命令，以及未验证的平台。任何验证失败都必须停止在可审查状态，不能静默移除
失败记录、回退用户修改或把 bundle 标为可发布。
