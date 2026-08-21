# @dsh-forge/desktop-services-local

此包是 launcher 与 `@dsh-forge/desktop-layer` 的私有实现。desktop layer 的
`cordis.patch.yml` 是唯一 provider 注册位置；其他 bundle、feature、generator、Fork
和第三方 fixture 都不能导入本包。应用仅可使用 `@dsh-forge/desktop-services-local/launcher`
创建 Host capability。

provider 在同一 Cordis generation 中发布 `desktopProfiles`、`desktopPnpm` 和
`desktopServices`。fiber 卸载时先关闭新 operation、取消受管进程树、等待 operation 的
完整结算，再移除 service。已关闭 generation 的 service 不会访问或改变新 generation。

安装事务为 `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml` 写入 WAL。它不承诺
回滚 `node_modules`。pnpm 退出、reconcile、lockfile 名称/版本/来源/完整性校验、下一
generation 健康检查和 receipt 提交由同一 lease 覆盖；任何失败、取消、来源漂移或未知
lockfile 都恢复受保护文件并记录失败或人工恢复事实。

registry 安装必须由 catalog 提供 HTTPS registry、完整 tarball 与 integrity；Git 安装必须
固定完整 40 位 commit。确认品牌只是 `trusted-in-process` 的 API 审计辅助，不能隔离
已执行的 Node 插件。

维护验证：`pnpm --filter @dsh-forge/desktop-services-local build`、
`pnpm run test:desktop-services-local`、`pnpm run boundaries:check`。
