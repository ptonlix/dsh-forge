## Why

当前应用虽然会在“升级管理”页显示可用版本，但用户必须先打开设置并进入该页面才能发现更新。需要在设置入口提供非阻塞提示，缩短从发现更新到主动升级的路径，同时继续遵守主进程复查、原生确认和完整包 OTA 的安全边界。

## What Changes

- 在设置入口增加由升级状态驱动的“发现新版本”橙色提示。
- 提示在支持 OTA 且主进程确认存在可用版本时显示，检查中、当前最新、失败或不支持时隐藏。
- 提示入口保持设置外壳的原有打开行为；用户在“升级管理”页使用现有“立即升级”操作。
- 复用现有无参数 `upgradeManager/status` 与 `upgradeManager/startUpgrade` Remote，不向 renderer 暴露 URL、路径或命令。
- 允许自动检查更新后出现被动提示，但不得弹窗、自动下载或打断用户。
- 增加入口提示的生命周期、无障碍、状态和回归测试，并同步升级文档。

## Capabilities

### New Capabilities

- `upgrade-settings-badge`: 在设置入口呈现可用版本提示，并将用户引导至既有升级管理流程。

### Modified Capabilities

- 无

## Impact

- 修改 `@dsh-forge/desktop-layer` 的 renderer slot 注册和样式。
- 扩展客户端测试 fixture，覆盖状态映射、轮询清理和 Remote 边界。
- 更新升级管理参考文档和 OpenSpec 规范。
- 不新增运行时依赖，不修改 OTA 下载器、Electron 安装器或公开 desktop service。
