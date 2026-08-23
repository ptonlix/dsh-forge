## 1. 打包入口与证据契约

- [x] 1.1 为 `scripts/package-desktop.ts` 增加 `darwin-universal|win32-x64|linux-x64` target 和 formats 参数、目标一致性校验、双架构 native rebuild 及可安装格式输出；验证现有 `pnpm run package:desktop -- dsh-forge-official` 默认行为保持不变，并生成 `universal.dmg`/zip、Windows x64 包及 Ubuntu x64 `AppImage`/`deb`
- [x] 1.2 为打包脚本补充 target/formats 的成功、未声明目标、runner 不匹配和格式错误测试；验证相关 Vitest/Node 测试覆盖失败语义
- [x] 1.3 增加 CI 产物索引/manifest 汇总辅助逻辑，验证跨目标 profile、version、input digest 和 SHA-256 一致性检查会拒绝缺失或漂移 evidence

## 2. GitHub Actions 编排

- [x] 2.1 新增 `validate` job，在 Ubuntu 上执行 frozen install、typecheck、lint、profile resolve/verify、config dump、catalog verify 和 docs check；验证 workflow YAML 静态检查与本地对应命令通过
- [x] 2.2 新增原生 runner 的三目标矩阵 job（`macos-14` universal、`windows-2022` x64、`ubuntu-22.04` x64），执行 profile 编译、打包、inspect、universal 架构检查、Linux smoke 并上传独立 artifact；验证 workflow fixture 检查矩阵和命令参数
- [x] 2.3 新增汇总 job，下载全部矩阵 artifact、生成结构化索引并在任一目标失败/缺证据时失败；验证模拟缺失目标和 manifest 漂移的测试
- [x] 2.4 配置 pull request、workflow_dispatch 和 `v*` tag 触发、concurrency、缓存和最小权限；验证外部 PR 不读取 secrets，普通 job 只有 `contents: read`

## 3. Tag 发布与文档

- [x] 3.1 增加 tag 版本与 `distribution.yml.version` 校验，并让 release job 仅在完整矩阵和 `release:gate` 成功时创建 GitHub Release；验证 unsigned、版本不匹配和签名缺失均不会发布
- [x] 3.2 更新工程验证记录和发布参考，说明 CI 目标、artifact 内容、unsigned smoke 限制、所需 secrets 和未覆盖平台；验证 `pnpm run docs:check` 与 `git diff --check`
- [x] 3.3 运行受影响的 package build、测试、`pnpm run boundaries:check`、OpenSpec 严格校验，并记录 universal macOS、Windows x64、Ubuntu Linux x64 及未执行的平台签名/公证结果

## 4. Tag-only 打包触发

- [x] 4.1 将 package/summary 限定为 `v*` tag，PR 与 `workflow_dispatch` 只运行 validate；修正 Windows runner 的 profile 参数引用，并让未显式启用的生产 Release 默认跳过
- [x] 4.2 增加 workflow 静态测试并更新工程文档，验证 PR/tag job 条件、最小权限、OpenSpec 严格校验、文档和 diff 门禁

## 5. CI Node 与 pnpm 兼容性

- [x] 5.1 将仓库工具链 Node 下限对齐到 pnpm 11.7 要求，并将 CI 固定到 Node 22.14；增加静态回归测试并同步开发环境文档

## 6. 干净检出 typecheck

- [x] 6.1 让根 typecheck 在检查应用前构建 workspace 类型出口，验证 fresh CI 不依赖未跟踪的 dist 声明文件

## 7. 跨平台子进程与打包稳定性

- [x] 7.1 统一解析真实 DSH、Electron 和 electron-builder 入口，移除对 pnpm `.bin` shim 的依赖
- [x] 7.2 保留 spawnSync 启动错误、状态、signal 和截断输出，清理 ABI 子进程的 NODE_OPTIONS
- [x] 7.3 将 electron-builder 超时提高到 15 分钟，补充入口解析与诊断回归测试
