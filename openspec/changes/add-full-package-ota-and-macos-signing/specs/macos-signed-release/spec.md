## ADDED Requirements

### Requirement: tag macOS package 必须使用受控 Apple 配置签名和公证最终应用

仅在 tag 触发的 `darwin-universal` GitHub Actions package job 中，工作流 SHALL 要求
普通 Variables 中的 `APPLE_API_ISSUER`、`APPLE_API_KEY_ID` 以及 Secrets 中的
`MACOS_CERTIFICATE_P12_BASE64`、`MACOS_CERTIFICATE_PASSWORD` 和
`MACOS_NOTARY_API_KEY_P8_BASE64` 均非空。它 MUST 在
`$RUNNER_TEMP` 解码 P12/P8、以随机临时密码建立 keychain、导入 P12 并仅把必要路径和标识传给
打包进程。P12 必须提供唯一可用的 Developer ID Application identity。

任何 pull request、普通分支手动运行、Windows/Linux package job 和 release job MUST 不读取、引用
或输出这些签名配置。工作流不得将 base64 内容、P12/P8 内容、证书密码、Apple API key 或临时
keychain 归档或写入日志。无论成功或失败，临时 keychain、P12、P8 与 notarization ZIP MUST 在 job
结束时清理。

#### Scenario: tag macOS job 使用完整配置集

- **WHEN** `v*` tag 的 universal macOS package job 启动，且两个 Variables 与三个 Secrets 都可用
- **THEN** job 创建仅供本次运行使用的临时凭据，并启用 `DSH_FORGE_MACOS_SIGNING=1` 的最终应用
  签名和公证流程

#### Scenario: 配置缺失或证书身份不合格

- **WHEN** 任一 Variable 或 Secret 缺失、P12 无法导入，或 keychain 没有唯一 Developer ID Application identity
- **THEN** macOS package job 在生成可发布 artifact 前失败，summary 和 release 均不得继续，且日志
  不得包含秘密值

### Requirement: profile 注入后的最终 macOS 应用必须签名、公证并 staple

macOS `.app` 的完整 profile 闭包注入后，打包脚本 MUST 使用 Developer ID Application identity、
hardened runtime 和 timestamp 对所有需签名的 Electron framework、helper、native code 与顶层 bundle
完成签名。它 MUST 将最终 `.app` 提交给 `xcrun notarytool` 的 API key 流程并等待 Accepted，再运行
`xcrun stapler staple`。DMG/ZIP MUST 从已签名并 staple 的应用生成，且不得在此后修改 `.app` 内容。

打包脚本 MUST 在 artifact 生成前执行 `codesign --verify --deep --strict`、
`spctl --assess --type execute` 和 `xcrun stapler validate`。三者任一失败、notary 返回非 Accepted，或
运行在非 macOS 平台时误启用 signing 模式，均必须以稳定打包错误失败。成功的 macOS runtime manifest
MUST 标记 `signing.signed: true` 及 `signing.kind: macos-developer-id-notarized`。

#### Scenario: 最终 universal app 完成公证

- **WHEN** profile 闭包注入完成，Developer ID 签名和 Apple notary 请求均成功
- **THEN** `.app` 完成 stapling 和本机验证，随后生成 DMG/ZIP，runtime manifest 记录已签名且
  已公证的 macOS 状态

#### Scenario: 公证或本机验证失败

- **WHEN** `notarytool` 未返回 Accepted，或 `codesign`、`spctl`、`stapler` 任一验证失败
- **THEN** 不生成或上传 macOS 分发包，macOS package job 失败，Release 不得创建或补充附件

### Requirement: 未启用的本地和非 macOS 构建必须如实保留 unsigned 状态

本地 `package:desktop`、PR validate、Windows package 和 Linux package 在没有显式
`DSH_FORGE_MACOS_SIGNING=1` 的情况下 MUST 不尝试读取 Apple 凭据或伪造签名成功。它们的 runtime
manifest 必须继续记录 `unsigned-smoke`。macOS 已签名证据只由通过真实 Apple 服务的 tag macOS runner
产生，不能由静态测试、本机 Linux/Windows 构建或未签名 macOS 包替代。

#### Scenario: 本地未配置签名运行

- **WHEN** 维护者在本地运行 `pnpm run package:desktop`，且未设置 signing 模式
- **THEN** 构建不需要 Apple 凭据，产物明确为 `unsigned-smoke`，且不得声称可作为 macOS OTA
  发布证据
