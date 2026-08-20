# DSH Forge 基础工程边界

本文描述源平面、产物平面、恢复事务和更新发布的维护边界。适用于首版 `trusted-in-process` 兼容模式。

## 源平面与产物平面

可维护源只有 `distribution.yml`、`profiles/*/profile.yml`、profile patch、bundle manifest 和静态 catalog。`artifacts/` 可以删除并重建；构建与运行时禁止回写源 profile 或 source patch。

`profile:verify` 比较规范化输入、锁定依赖、工具版本和生成的 resolved manifest。锁文件说明一次解析结果，SBOM 说明组成；两者都不单独证明来源可信、许可证正确、签名有效或插件安全。

## Generation 与恢复

状态文件位于私有用户目录，版本化字段包括 active、pending、lastKnownGood、generation ID 与最近失败事实。写入拒绝符号链接，使用 `wx` 临时文件与原子 rename。状态损坏不会被静默接受，而是记录恢复诊断并回退到可验证的目标。

健康提交依次需要 Host entry settle、loopback readiness、沙箱化窗口和 renderer boot report。pending 失败最多自动恢复一次到 last-known-good；恢复再失败后进入 manual recovery。窗口关闭仅隐藏；显式退出、信号、profile 切换和失败恢复等待 Host 与受管子进程完成有界 teardown。

## 安装与更新

插件安装必须由明确用户确认触发。启动期只读取静态 catalog，禁止自动下载或执行 package manager。安装 WAL 保护 profile 配置文件，不能声称回滚依赖目录。

更新在独立暂存目录下载。应用前验证 channel 元数据签名、发行版身份、平台/架构、产物摘要、信任根和严格版本升级；然后 dispose generation 并交给平台安装器。未签名产物只能标记为本地或 CI smoke，不能进入生产更新 channel。macOS 生产产物需要签名与公证，Windows 生产产物需要 Authenticode 发布者验证。

## 本地验证

```sh
pnpm run check
pnpm run profile:verify -- official
pnpm run dump-config -- official
pnpm run catalog:verify
pnpm run package:inspect
pnpm run boundaries:check
```

生产发布还需要在每个声明的平台执行真实安装包启动、renderer boot、退出、更新入口和诊断导出 smoke，并完成平台签名验证。

已执行的本地命令与适用范围见[基础契约验证记录](foundation-verification.md)。
