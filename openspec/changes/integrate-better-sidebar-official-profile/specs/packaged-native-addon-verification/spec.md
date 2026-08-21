## Purpose

定义含原生 addon 的第三方 bundle 在 Electron 发行物中的重建、可追溯性和目标平台验证要求，避免 Node ABI 偶然匹配掩盖不可启动的安装包。

## ADDED Requirements

### Requirement: 原生 addon 必须针对 Electron 目标重建
当 profile 闭包包含原生 `.node` 文件时，桌面打包流程 SHALL 使用当前 Electron 版本和目标操作系统、架构重建这些 addon。重建失败 MUST 阻止生成该目标的可发布运行时。

#### Scenario: 为当前目标打包
- **WHEN** 打包闭包中包含 `node-pty` 等原生 addon
- **THEN** 产物使用当前 Electron ABI 的原生二进制且打包流程记录重建成功

#### Scenario: 原生 addon 重建失败
- **WHEN** 任一目标原生 addon 无法为 Electron 目标重建
- **THEN** 打包失败且不会生成该目标的 runtime manifest

### Requirement: runtime manifest 覆盖实际原生文件
桌面打包流程 SHALL 扫描最终应用目录中的原生 `.node` 文件，并将每个文件的相对路径和 SHA-256 摘要写入该目标的 runtime manifest。manifest MUST 不得声明不存在的文件，也 MUST 不得遗漏最终应用目录中的原生文件。

#### Scenario: 打包应用含原生文件
- **WHEN** Electron builder 完成且应用目录包含原生 `.node` 文件
- **THEN** runtime manifest 为每个原生文件记录存在的相对路径和匹配摘要

#### Scenario: manifest 漏记原生文件
- **WHEN** 最终应用目录含有未记录的原生 `.node` 文件
- **THEN** 包前验证失败并拒绝发布该应用目录

### Requirement: 已声明目标必须具有原生兼容性验证
官方发行版的每个已声明目标 SHALL 具有包含第三方原生 addon 的独立验证证据。缺少任一 `darwin-arm64`、`darwin-x64` 或 `win32-x64` 目标的证据时，该目标 MUST 不得标记为该 profile 的已验证发布目标。

#### Scenario: 目标平台验证完成
- **WHEN** 目标平台完成打包、manifest 校验和启动冒烟
- **THEN** 发行证据记录该平台、架构、原生文件摘要与验证结果

#### Scenario: 缺少目标平台证据
- **WHEN** profile 选择含原生 addon 的第三方 bundle且某个声明目标没有验证证据
- **THEN** 发布验证报告该目标缺失并拒绝将其视为已验证
