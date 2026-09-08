## Purpose

在 DeepSeek Harness 设置中提供「存储空间」页，让用户查看本应用管理数据的占用，并只通过固定 Remote 请求受确认的缓存或会话清理。

## ADDED Requirements

### Requirement: 设置必须注册独立的存储空间页面

桌面发行包 SHALL 在 DeepSeek Harness 设置中注册独立的「存储空间」页面。该页 MUST 通过 `settings.section` 挂载，标签为「存储空间」，并与既有「升级管理」页并存。

页面 MUST 只调用无路径参数的 Typert Remote 方法读取快照、刷新扫描、请求清理缓存和请求清理会话。它不得使用 Electron IPC、renderer Node 能力、任意 HTTP 路由，也不得传递绝对路径、目录候选、文件名或 Electron 对象。

#### Scenario: 用户打开存储空间页

- **WHEN** 用户在设置导航中选择「存储空间」
- **THEN** 页面显示存储空间内容，且「升级管理」入口仍然可用

#### Scenario: 页面不能指定删除路径

- **WHEN** 页面请求刷新或清理
- **THEN** Remote 调用不含路径、文件名或分类以外的渲染进程候选

### Requirement: 页面必须展示总量、磁盘对比和三类占用

页面 MUST 显示应用已用空间、该空间占 DSH Home 所在磁盘的百分比，以及应用已用、磁盘已用、磁盘可用的对比条。页面 MUST 分别显示缓存、会话数据、其他数据的字节数和简短说明：

- 缓存：使用过程中产生的可重建临时数据，清理不影响会话正文。
- 会话数据：会话记录等正文；清理会作用于共享 DSH Home。
- 其他数据：运行所需文件、凭据、当前受管 profile 及未分类剩余，本页不能删除。

快照尚未完成时，页面 MUST 显示加载或扫描中状态，不得把空字节显示成已确认的 0。扫描失败时 MUST 显示可理解错误，不得露出内部路径。`userData` 与 DSH Home 跨卷时，页面 MUST 说明磁盘对比条只代表 DSH Home 所在卷。

#### Scenario: 展示分类占用

- **WHEN** Remote 返回成功快照
- **THEN** 页面显示应用已用总量、磁盘占比、对比条以及缓存、会话数据、其他数据三类字节

#### Scenario: 扫描尚未完成

- **WHEN** 用户打开页面且扫描仍在进行
- **THEN** 页面显示扫描中，不把缺失快照渲染为 0 字节占用

#### Scenario: 跨卷提示

- **WHEN** 快照标明 `userData` 与 DSH Home 不在同一卷
- **THEN** 页面说明对比条只统计 DSH Home 所在磁盘

### Requirement: 清理入口必须把确认留给主进程

缓存分类 MUST 提供「前往清理」操作，会话数据 MUST 提供「前往清理会话」操作，其他数据 MUST NOT 提供删除按钮。点击清理后，页面 MUST 只调用对应的无参数 Remote；原生确认对话框 MUST 由主进程显示。用户拒绝后页面 MUST 保持当前快照，不得重试删除。

页面卸载或 generation 切换后 MUST 停止刷新，迟到的 Remote 结果 MUST NOT 写回已卸载页面。

#### Scenario: 从页面清理缓存

- **WHEN** 用户点击缓存的「前往清理」且主进程确认成功
- **THEN** 页面展示清理后的新快照，且未收到任何被删路径

#### Scenario: 其他数据没有删除按钮

- **WHEN** 页面渲染其他数据分类
- **THEN** 该分类没有删除或清理按钮，只显示占用说明

#### Scenario: 页面卸载后忽略迟到结果

- **WHEN** 扫描或清理返回时设置页已卸载或 generation 已切换
- **THEN** 迟到结果不更新 UI，也不抛出未处理异常
