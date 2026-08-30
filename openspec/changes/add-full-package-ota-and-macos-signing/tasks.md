## 1. 版本与 OTA 私有能力

- [x] 1.1 在根 `package.json` 增加并校验 `dshForgeBuild`，让 staging 应用保留该字段；为缺失、非
  整数和未递增 build 增加测试。
- [x] 1.2 在 `desktop-services-local` 实现严格 `version.json` 解析、Windows/macOS/Ubuntu AppImage
  平台映射、SemVer/build 比较、受控暂存下载和取消/关闭清理；只通过 `./launcher` 暴露给
  `apps/desktop`。
- [x] 1.3 添加 Windows/macOS/Ubuntu AppImage 版本、无效清单、降级/同 build、非 Ubuntu 或不可写
  `APPIMAGE`、拒绝、下载失败、取消和 generation 关闭的定向单元测试，并将它们纳入
  `test:desktop-services-local`。

## 2. Electron 升级交接

- [x] 2.1 在 `apps/desktop` 接入原生升级确认，确保只有当前 generation 就绪、用户确认和完整下载后
  才准备平台 helper；失败时继续现有应用。
- [x] 2.2 实现受控 Windows NSIS、macOS DMG 和 Ubuntu AppImage helper，覆盖 PID 等待、成功后删除包、
  Ubuntu 原子替换与回滚、失败保留包和受控参数；为 helper 输入、退出顺序与失败清理添加 fake 测试。
- [x] 2.3 更新 local provider README 与桌面架构/工程边界文档，说明私有所有权、无摘要/签名更新
  限制、平台范围和实际验证命令。

## 3. macOS 签名与公证

- [x] 3.1 重构 macOS 打包顺序，在最终 profile 闭包注入后启用显式 signing 模式，完成 Developer ID
  signing、notarytool、stapling 和 `codesign`/`spctl`/`stapler` 验证；将已签名状态写入 runtime manifest。
- [x] 3.2 更新 GitHub Actions macOS tag matrix：读取两个 Variables 和三个指定 Secrets，安全解码三个
  敏感 Secrets、建立临时 keychain、注入
  受限环境、确保 `always()` 清理；缺失凭据、身份异常或公证失败必须阻断 Release。
- [x] 3.3 扩展 release workflow、打包和 manifest 测试，覆盖签名材料不泄露、PR/非 macOS 不读取签名配置、
  最终签名顺序、失败阻断和 unsigned 本地模式。

## 4. 发布清单和验证

- [x] 4.1 在 tag Release 生成并上传固定名 `version.json`，同时将三个生产平台安装包复制为固定的
  `dsh-forge-windows.exe`、`dsh-forge-macos.dmg` 和 `dsh-forge-ubuntu.AppImage` 资产；清单中的 URL
  指向同一 tag 下的 GitHub Release 资产，并在发布前校验 HTTPS 与文件扩展名。
- [x] 4.2 同步 release OpenSpec、发行参考和工程验证记录，移除“macOS 只允许 unsigned-smoke”的
  当前事实，并明确 Windows、Ubuntu AppImage、非 AppImage Linux 与无摘要/签名 OTA 的限制。
- [ ] 4.3 运行受影响 package build、`test:desktop-services-local`、release workflow 测试、
  `boundaries:check`、`docs:check`、`git diff --check` 及本地可执行的 package/inspect/smoke；在
  GitHub macOS runner 运行真实签名、公证和 stapling，并如实记录未覆盖的平台。
- [x] 4.4 将 Ubuntu 发行格式收敛为 AppImage，移除 `.deb` 打包、Release 附件与文档中的当前支持声明。

## 5. 升级管理设置页

- [x] 5.1 扩展私有 OTA 检查以接受 `AbortSignal`，确保 generation 释放会取消 manifest 请求且不会遗留
  网络请求或写回结果。
- [x] 5.2 在 `apps/desktop` 实现 generation 所有的 `UpgradeCoordinator`：启动静默检查、检查结束后
  12 小时调度、手动/定时单飞、支持状态、失败 code、重新检查后升级及 dispose 清理，并覆盖生命周期测试。
- [x] 5.3 用私有 `DesktopHostCapability` 和固定 Typert Remote 暴露 `status`、`check`、`startUpgrade`，
  不接受 renderer 的候选版本、URL、路径或命令参数，并为 endpoint 与状态投影补充测试。
- [x] 5.4 在 `@dsh-forge/desktop-layer` 注册“升级管理”设置页，显示版本/build、上次检查、状态、
  平台不支持原因、检查按钮与条件化升级按钮；通过真实 Remote contribution 调用，不增加 Electron IPC。
- [x] 5.5 移除启动即确认，接入启动/退出 lifecycle，补充升级管理文档、OpenSpec 场景和定向验证证据。
