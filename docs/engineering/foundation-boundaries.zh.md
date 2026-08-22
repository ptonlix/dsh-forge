# DSH Forge 工程边界

中文 | [English](foundation-boundaries.md)

本文负责源文件、生成证据、generation 恢复、package operation 和发布工作的维护边界。架构见 [`../design/dsh-forge.zh.md`](../design/dsh-forge.zh.md)；配置和公开 service 事实见 [`../reference/foundation-contracts.zh.md`](../reference/foundation-contracts.zh.md)。

## 源文件与派生文件

手工维护的组合源是 `distribution.yml`、`profiles/*/profile.yml`、profile patch、bundle manifest 和静态 catalog。`artifacts/` 是可删除并可重建的生成目录。构建和运行时代码不能回写 source profile 或 source patch。

`profile:verify` 比较规范化输入、解析依赖、工具版本、lockfile 和 resolved manifest。Lockfile 记录一次解析，SBOM 记录组成；两者都不能独立证明来源可信、许可证正确、签名有效或插件安全。

## Generation 与恢复

私有状态记录 active、pending、last-known-good、generation ID 和最近失败事实。写入会拒绝符号链接，使用排他临时文件和原子 rename。状态损坏会记录诊断并回退到可验证目标，绝不静默接受。

健康提交需要 Host entry settle、loopback readiness、sandboxed window 和 renderer boot report。Pending 失败最多恢复到 last-known-good 一次，之后需要人工恢复。窗口关闭默认隐藏；显式退出、信号、profile 选择和恢复都会等待有界的 Host 与受管进程 teardown。

`@dsh-forge/desktop-services-local` 是私有 provider。只有 desktop layer 注册它，`apps/desktop` 通过 `./launcher` export 创建启动器 capability。它的 Cordis fiber 拥有 profile service、package lease、进程树和 WAL。Consumer 只能使用 `@dsh-forge/desktop-services`。

## Package Operation

安装只能在明确确认后开始。启动期只读取静态 catalog，禁止下载或运行 package manager。确认绑定 catalog 条目、profile、精确 SemVer、来源、integrity、允许构建脚本和时间；provider 在启动 pnpm 前会将这些事实与当前 catalog 比较。

安装 WAL 保护 `package.json`、`pnpm-lock.yaml` 和 `pnpm-workspace.yaml`，不回滚 `node_modules`。未知 lockfile、来源漂移、进程非零退出、取消、reconcile 失败或下一 generation 健康失败，必须恢复受保护文件或记录人工恢复。

## 发布边界

更新在独立暂存目录下载，并在 dispose generation 且交给平台安装器前验证 channel metadata 签名、发行版身份、平台/架构、产物摘要、信任根和严格版本升级。未签名安装包只属于本地或 CI smoke 证据，不能进入生产更新 channel。macOS 生产包需要签名和公证，Windows 生产包需要 Authenticode 发布者验证。

## 维护检查

```sh
pnpm run check
pnpm run profile:verify -- dsh-forge-official
pnpm run dump-config -- dsh-forge-official
pnpm run catalog:verify
pnpm run package:inspect
pnpm run boundaries:check
```

实际本地命令记录和平台覆盖见 [`foundation-verification.md`](foundation-verification.md)。该记录是内部文档，不属于公开文档站页面。
