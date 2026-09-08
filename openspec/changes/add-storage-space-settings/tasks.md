## 1. 私有契约与 Remote

- [x] 1.1 在 `desktop-services-local` 增加只读存储快照类型、`STORAGE_BUSY` 等稳定错误 code，以及 `status` / `refresh` / `cleanCache` / `cleanSessions` capability
- [x] 1.2 扩展 launcher capability 注入存储协调器，缺省返回不扫描、不可清理的安全快照
- [x] 1.3 增加无路径参数的 Typert Remote gateway 与 Host/Client 共享校验，拒绝绝对路径和 Electron 对象

## 2. 扫描、分类与清理

- [x] 2.1 实现固定根目录遍历：DSH Home 与 `userData`，`lstat` 不跟随符号链接，按 `cache` / `sessions` / `other` 累加
- [x] 2.2 读取 DSH Home 所在卷容量；`userData` 跨卷时只标记、不把两卷容量相加
- [x] 2.3 实现 generation lease：同时一项扫描或清理，关闭或取消时停止遍历和删除，迟到结果不得写回
- [x] 2.4 缓存清理仅删除允许清单（投影缓存、Electron 缓存、非活动 OTA 暂存），原生确认拒绝则不改磁盘
- [x] 2.5 会话清理仅删除 `sessions/`，确认文案包含共享 DSH Home 警告；`other`、凭据和当前受管 profile 的删除请求失败

## 3. 设置页

- [x] 3.1 在 desktop-layer 注册 `settings.section`「存储空间」，与「升级管理」并存
- [x] 3.2 渲染总量、磁盘占比、对比条和三类说明；扫描中不显示假 0；跨卷时说明对比条范围
- [x] 3.3 缓存和会话提供清理按钮，其他数据不提供删除；页面只调无参数 Remote，卸载后停止刷新

## 4. 测试与文档

- [x] 4.1 覆盖分类求和、符号链接、跨卷、并发 `STORAGE_BUSY`、generation 关闭、确认拒绝、禁止删除 `other` 的测试
- [x] 4.2 覆盖设置页 Remote 边界、加载态、跨卷文案、无删除按钮和卸载清理的客户端测试
- [x] 4.3 更新私有 provider README、desktop-layer 说明和设置相关设计/参考文档，明确非公开 service、共享 Home 和三类清理边界
- [x] 4.4 运行受影响包测试、类型检查、边界检查、文档检查和 `git diff --check`
