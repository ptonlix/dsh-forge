## Purpose

为主进程提供当前 generation 内本应用管理数据的磁盘占用快照，以及仅覆盖可重建缓存与会话正文的受确认清理。

## ADDED Requirements

### Requirement: 存储快照必须只覆盖固定根目录和固定分类

当前 generation 的存储能力 MUST 只扫描启动器已解析的 DSH Home 与 Electron `userData`。应用安装目录、系统目录、用户任意路径和符号链接指向的根外目标 MUST NOT 计入占用，也 MUST NOT 被删除。

快照 MUST 将占用归入且仅归入以下分类：

- `cache`：可从会话日志或其他权威数据重建的投影缓存、Electron 缓存，以及 `userData` 下 OTA 暂存残留。
- `sessions`：DSH Home 中的会话正文（`sessions/`）。
- `other`：同一 DSH Home 与 `userData` 中其余本应用管理数据，包括凭据、当前受管 profile、profile 备份和未分类剩余。

应用已用字节 MUST 等于三类字节之和。快照 MUST NOT 包含绝对路径、文件名列表、Electron 对象或原始目录候选。安装包或 `.app` / `.exe` / AppImage 本体 MUST NOT 计入应用已用字节。

若 DSH Home 与 `userData` 位于不同卷，快照 MUST 以 DSH Home 所在卷作为磁盘占比基准，并标记 `userData` 不在同一卷；不得把两个卷的容量相加后伪造单一占比。

#### Scenario: 分类汇总固定根目录

- **WHEN** 当前 generation 对已解析的 DSH Home 与 `userData` 完成一次扫描
- **THEN** 快照给出 `cache`、`sessions`、`other` 三类字节和应用已用总量，且三类之和等于总量

#### Scenario: 根外路径不计占用

- **WHEN** 固定根目录内存在指向根外的符号链接
- **THEN** 扫描不跟随该链接，不把根外目标计入任何分类，也不将其作为可清理目标

#### Scenario: 跨卷时不以相加容量计算占比

- **WHEN** DSH Home 与 `userData` 不在同一卷
- **THEN** 磁盘总量、已用和可用取自 DSH Home 所在卷，快照标明 `userData` 跨卷，且不把两卷容量相加

### Requirement: 扫描必须可取消、串行且随 generation 关闭

每个 generation 同时最多只能有一项扫描或清理。重复请求 MUST 以稳定错误 code `STORAGE_BUSY` 失败，且不得开始第二次磁盘遍历或删除。

扫描与清理 MUST 接受 generation 关闭与取消：关闭或取消后 MUST 停止继续遍历和删除，迟到的结果 MUST NOT 写回已关闭 generation。调用已关闭 generation 的存储能力 MUST 以稳定错误失败。

首次进入设置页或显式刷新时 MUST 重新扫描；应用启动或 generation 就绪 MUST NOT 自动遍历全部数据目录。

权限不足、目录消失或遍历中断时，快照 MUST 进入可投影的失败或部分完成状态并带稳定 `errorCode`，不得抛出未分类异常，也不得把未知字节并入某一分类。

#### Scenario: 并发扫描被拒绝

- **WHEN** 一项扫描仍在进行时再次请求扫描或清理
- **THEN** 第二次调用以 `STORAGE_BUSY` 失败，第一次扫描继续，磁盘上不开始第二项删除

#### Scenario: generation 关闭取消遍历

- **WHEN** 扫描或清理进行中当前 generation 被释放
- **THEN** 遍历和删除停止，已关闭 generation 的迟到结果被丢弃，新 generation 不会继承旧快照写回

#### Scenario: 启动时不扫描

- **WHEN** 新 generation 就绪且用户尚未打开「存储空间」页或请求刷新
- **THEN** 主进程不遍历 DSH Home 或 `userData` 统计占用

### Requirement: 缓存清理不得删除会话、凭据或当前 profile

`cache` 清理 MUST 只删除允许清单内的可重建缓存和 OTA 暂存残留。该操作 MUST NOT 删除 `sessions/`、凭据文件、当前 generation 的受管 profile 目录或 `other` 分类中的数据。

清理开始前，主进程 MUST 使用原生确认对话框；用户拒绝或关闭对话框时 MUST NOT 删除任何文件。确认文案 MUST 说明清理缓存不影响会话正文。清理结束后 MUST 返回新的占用快照。

#### Scenario: 用户确认清理缓存

- **WHEN** 用户确认清理缓存且允许清单目录存在可删除文件
- **THEN** 这些缓存和 OTA 暂存残留被删除，会话正文、凭据和当前受管 profile 仍在原位置，快照中 `cache` 字节下降

#### Scenario: 用户拒绝清理缓存

- **WHEN** 原生确认被拒绝或关闭
- **THEN** 磁盘不变，快照保持确认前的分类字节

### Requirement: 会话清理必须警告共享 DSH Home 并保留凭据

`sessions` 清理 MUST 只删除 DSH Home 的会话正文，MUST NOT 删除凭据、当前受管 profile 或 `cache` 允许清单以外的目录。

清理开始前，主进程 MUST 使用原生确认对话框，并明确说明 DSH Home 可能与 CLI 或其他 DSH 进程共享，删除后无法从本页恢复。用户拒绝或关闭对话框时 MUST NOT 删除任何文件。确认后 MUST 在当前 generation 仍存活时执行删除，并返回新快照。

本变更 MUST NOT 提供删除凭据、当前受管 profile 或未分类 `other` 数据的操作。

#### Scenario: 用户确认清理会话

- **WHEN** 用户在含共享 Home 警告的原生确认中接受
- **THEN** 会话正文被删除，凭据和当前受管 profile 保留，快照中 `sessions` 字节下降

#### Scenario: 拒绝删除 other 数据

- **WHEN** 调用方请求清理 `other`、凭据或当前受管 profile
- **THEN** 请求以稳定错误失败，磁盘不变
