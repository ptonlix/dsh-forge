## Why

当前桌面应用会把会话、投影缓存、受管 profile、OTA 暂存和 Electron `userData` 写到磁盘，但设置中没有入口查看这些数据占用了多少空间，也无法清理可重建缓存。用户只能自己翻 DSH Home 或 `userData`，容易误删凭据、会话或正在使用的 profile。需要在设置中提供钉钉「存储空间」同类的只读占用视图，以及受确认约束的有限清理。

## What Changes

- 在 `@dsh-forge/desktop-services-local` 增加 generation 所有的私有存储能力：扫描当前 DSH Home 与 Electron `userData` 中由本应用管理的目录，汇总总量、本机磁盘占比和分类占用，并执行允许清单内的清理。
- 在 DeepSeek Harness 设置中增加独立「存储空间」页面，展示应用已用空间、所在磁盘已用/可用对比条，以及缓存、会话数据、其他数据三类占用。
- 页面通过固定、无路径参数的 Typert Remote 读取快照并请求清理；renderer 不得收到绝对路径、Electron 对象或任意目录候选。
- 缓存类（可从会话日志重建的投影缓存、Electron 缓存、OTA 暂存残留）允许在原生确认后清理；清理不得删除会话正文、凭据或当前 generation 的受管 profile。
- 会话数据允许在更强原生确认后清理，并明确警告 DSH Home 与 CLI/其他 DSH 进程共享；其他数据（凭据、当前受管 profile、未分类剩余）本变更只展示，不提供删除。
- 不把该能力做成公开 `@dsh-forge/desktop-services` contract，也不把 `desktop-services-local` 当作第三方插件扩展点。

## Capabilities

### New Capabilities

- `desktop-storage-accounting`: 主进程按固定根目录扫描并分类本应用管理的磁盘占用，提供只读快照和允许清单内的清理；generation 关闭后拒绝扫描与删除。
- `storage-space-settings`: 设置中的「存储空间」页展示占用快照，并只通过固定 Remote 触发缓存或会话清理；不向页面暴露路径或 Electron 对象。

### Modified Capabilities

- 无

## Impact

- 修改 `packages/desktop-services-local/`（私有 capability、Remote gateway、扫描/清理实现）、`apps/desktop/`（volume 统计、原生确认、generation 注入）和 `@dsh-forge/desktop-layer`（设置 slot 与页面）。
- 扩展 launcher capability，不新增公开 desktop service、协议版本或第三方插件安装入口。
- 更新私有 provider README、desktop-layer 说明和基础契约/设计文档中与设置页相关的当前行为。
- 增加扫描、分类、取消、generation 关闭、并发、确认拒绝和 Remote 边界测试。
