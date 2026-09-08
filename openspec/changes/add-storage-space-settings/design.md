## Context

设置页已有「升级管理」先例：`apps/desktop` 持有 generation 生命周期和原生对话框，`@dsh-forge/desktop-services-local` 提供私有 capability 与 Typert Remote gateway，`@dsh-forge/desktop-layer` 通过 `settings.section` 注册页面。公开 `@dsh-forge/desktop-services` 只有 `desktopProfiles`、`desktopPnpm` 和 `desktopServices`，第三方 bundle 不应获得磁盘遍历或删除权。

DSH Home 默认 `~/.dsh`（或 `$DSH_HOME`），与 CLI 和其他 DSH 进程共享；会话和凭据不在 Electron `userData`。OTA 暂存在 `<userData>/dsh-forge/ota`。`session_projcache` 可从会话日志重建，不兼容时启动器已会将其移出运行路径。见 proposal.md 的动机与范围。

## Goals / Non-Goals

**Goals:**

- 复用升级管理的三层所有权：主进程统计与确认，私有 Remote 投影只读事实，desktop-layer 只画设置页。
- 用固定分类映射代替用户选路径，避免 renderer 指定任意目录。
- 扫描按 generation lease 串行，打开页面或显式刷新才遍历，关闭时取消。

**Non-Goals:**

- 不新增公开 desktop service，不升 `DESKTOP_SERVICES_PROTOCOL`。
- 不统计安装包本体，不做跨卷容量加总，不提供按单条会话勾选删除。
- 不在本页删除凭据、当前受管 profile 或 `other` 数据，不在文件管理器中揭示绝对路径。
- 不把 `desktop-services-local` 做成可被普通插件导入的扩展点。

## Decisions

### 1. 私有 capability，而不是公开 desktop service

存储能力挂在 launcher capability 上，形状对齐 `upgradeManager`：`status()`、`refresh()`、`cleanCache()`、`cleanSessions()`。`desktop-services-local` 的 Typert gateway 把这些方法暴露给 desktop-layer；Cordis 公开 service 列表不变。

备选：把 `desktopStorage` 加进 `@dsh-forge/desktop-services`。拒绝，因为第三方 Host 插件没有合法理由遍历或删除用户 Home，且会把协议版本和 consumer fixture 一并扩大。

备选：只在 `apps/desktop` 用 IPC 做页面。拒绝，因为升级管理已经证明 Remote + settings slot 能把路径挡在 renderer 外，并保持 Host 与 Client 契约可校验。

Typert 以 package 名为 Remote 贡献身份，同一包不能 `$mount` 两次。升级与存储方法必须放进 `@dsh-forge/desktop-layer` 的同一份 descriptors，由 desktop-layer Client 一次挂载；Host 侧仍是两个 `TypertRemoteService`（`upgradeManager` 与 `storageManager`）。

### 2. 固定根目录与分类映射

扫描根只有启动器已解析的 DSH Home 和 `app.getPath('userData')`。分类在主进程写死：

| 分类 | 计入 |
|---|---|
| `cache` | `storages/session_projcache`、同目录不兼容隔离残留、Electron `Cache` / `Code Cache` / `GPUCache` 等缓存目录、`<userData>/dsh-forge/ota` 中非活动暂存 |
| `sessions` | DSH Home `sessions/` |
| `other` | 其余 DSH Home 与 `userData` 中本应用管理文件，含凭据、`profiles/`、`.dsh-forge` 备份 |

遍历使用 `lstat`，不跟随符号链接；硬链接按每次遇到的字节计，允许少量重复计算，避免引入 inode 表。活动 OTA 下载文件不算可清理目标，以免与升级管理抢同一暂存文件。

磁盘占比取 DSH Home 所在卷的总量、已用、可用。`userData` 跨卷时快照带布尔标记，页面只解释、不画第二根伪造总条。

备选：把安装包体积算进「应用已用」。拒绝，因为无法安全清理，且与钉钉数据占用页的语义不一致。

### 3. 按需扫描与 generation lease

`StorageCoordinator` 由 `apps/desktop` 创建并注入 capability。打开「存储空间」或调用 `refresh` 才扫描。lease 与 `desktopPnpm` 相同：一 generation 一项操作，第二项 `STORAGE_BUSY`。AbortSignal 绑定 generation dispose。快照字段仅含字节、卷容量、分类、阶段、`errorCode`、跨卷标记和扫描完成时间。

原生确认留在 `apps/desktop`：Remote 的 `cleanCache` / `cleanSessions` 无参数，协调器先弹对话框再删除。desktop-layer 不自己做确认。

### 4. 会话清理的产品边界

会话正文可删，但确认框必须写出共享 DSH Home 和不可从本页恢复。不在本变更做会话列表、按 workspace 筛选或回收站。`other` 无删除 API，调用直接失败。

## Risks / Trade-offs

- [受管 profile 的 `node_modules` 使扫描变慢] → 按需扫描、lease 串行、页面显示扫描中；不在启动路径上遍历。
- [共享 DSH Home 导致桌面清理影响 CLI 会话] → 会话清理强制原生警告；缓存清理不碰 `sessions/`。
- [硬链接或跨设备文件重复计字节] → 接受与系统「显示大小」可能有偏差，文档写明按遇到的普通文件累加。
- [清理与 OTA 下载并发] → 活动 OTA 暂存排除在 cache 允许清单外；`STORAGE_BUSY` 不与 `PACKAGE_BUSY` 合并，但 cache 清理不得 unlink 协调器标记为 in-flight 的文件。
- [部分目录无权限] → 快照进入 error 或部分完成，不把未知字节并入某一类。

## Migration Plan

无需迁移已有用户数据。开发态与打包应用都走同一设置页；旧版本没有该页。回退即不注册 section、不注入 capability。不改 profile schema、catalog 或公开协议。

## Open Questions

- ~~Electron 各平台缓存目录名是否还有需要纳入 `cache` 的稳定子目录（例如 `DawnCache`）~~：实现时按 Electron 43（`apps/desktop` 锁定版本）在 `userData` 下的实测目录补全允许清单为 `Cache`、`Code Cache`、`GPUCache`、`DawnCache`、`DawnGraphiteCache`、`DawnWebGPUCache`；三类语义不变，后续 Electron 升级需要同步复核该清单。
