## 1. 建立设计目录和包边界

- [x] 1.1 创建 `tools/profile-toolchain` workspace 包，配置其 TypeScript、构建入口和受限 package exports，并将 `tools/*` 纳入 workspace。
- [x] 1.2 建立目录所有权与跨包依赖检查，覆盖 `apps/desktop`、`packages/desktop-plugin`、`packages/bundles`、`tools`、`profiles`、`catalog`、`templates` 和 `schemas`。
- [x] 1.3 为禁止根级 `src/`、跨包相对导入、未导出子路径和应用到工具反向依赖建立失败夹具与测试。
- [x] 1.4 明确构建产物、`dist/`、`artifacts/` 和测试夹具不参与生产源码解析，并在构建配置中固定排除规则。

## 2. 迁移发行版工具链

- [x] 2.1 将 schema、错误、digest、版本和共享类型从根级 `src/core` 与 `src/types` 迁入工具包内部模块，修正内部导入并保留中文注释和强类型约束。
- [x] 2.2 将 compiler 和 composer 迁入工具包，确保 profile 解析、fixtureRoot、bundle 解析、patch 组合和生成物路径不再依赖根级相对路径。
- [x] 2.3 将 catalog、trust、release、acceptance 与 CLI 迁入工具包，建立 CLI 的正式包入口和独立无 Electron 构建。
- [x] 2.4 更新 `scripts`、测试和所有 package script 的导入，全部改用工具包 exports 或同包内部相对路径，不创建旧路径 re-export。
- [x] 2.5 更新 TypeScript、lint、format、构建和测试 glob，验证工具包在没有 Electron 窗口环境时可独立编译和执行。
- [x] 2.6 在新路径测试通过后删除根级 `src/`，运行旧路径搜索和边界检查，确认仓库没有双轨实现。

## 3. 收敛 desktop-plugin 包边界

- [x] 3.1 将 generation-scoped desktop service provider、安装恢复和 profile 快照实现迁入 `packages/desktop-plugin/host`，并将 contracts 保持为唯一公开类型源。
- [x] 3.2 检查并收紧 `packages/desktop-plugin/package.json` 的 exports，使 profile service、pnpm service 和根入口均只暴露受支持模块。
- [x] 3.3 更新 Electron 应用和工具对 desktop-plugin 的消费，禁止跨包导入 host 源码；验证公开导入与未导出导入分别通过和失败。
- [x] 3.4 将 provider 的并发、取消、过期 generation、WAL 恢复和真实 fixture 测试移动到 package 所属测试边界，并保留现有服务契约。

## 4. 实现 desktopRuntime 与 Electron 安全策略

- [x] 4.1 在 `apps/desktop/native-runtime.ts` 定义内部 `desktopRuntime` 能力合同，覆盖单实例、用户数据目录、窗口工厂、受控外链和退出动作。
- [x] 4.2 将窗口与平台实现迁入 `apps/desktop/platform/`，使 `main.ts` 只负责 runtime、Host generation 和公开 service 的组装。
- [x] 4.3 接入单实例锁：第二个进程只通知并聚焦现有窗口后退出，不得启动第二个 Host 或 generation。
- [x] 4.4 固定 renderer 的 sandbox、context isolation、禁用 Node integration，并以当前 generation 的 loopback authority 限制主框架导航。
- [x] 4.5 配置新窗口拦截和外部链接策略：拒绝应用内新窗口，允许的 HTTP、HTTPS、mail 链接交给系统处理程序，未知 scheme 拒绝。
- [x] 4.6 为 runtime fake、BrowserWindow 配置、单实例、同源导航、跨源导航、新窗口和外链补充单元与 Electron 集成测试。

## 5. 统一 profile 命令选择与产物隔离

- [x] 5.1 实现统一 profile resolver，读取 `distribution.yml` 默认值，严格校验显式名称、schema、目录和 runtime 兼容性。
- [x] 5.2 让 `profile:resolve`、`profile:verify`、`dump-config`、`package:desktop`、`package:inspect`、`package:smoke` 和 `release:gate` 透传并报告 profile 名称。
- [x] 5.3 更新 artifact 查找和写入规则，使用发行版 ID、profile 名称和输入摘要隔离锁文件、runtime manifest、SBOM、诊断和安装包输入。
- [x] 5.4 更新 `package.json`、shell 脚本和 CLI 帮助，覆盖默认 profile、Fork profile、无效 profile 和参数透传示例。
- [x] 5.5 增加默认选择、显式选择、不存在 profile、schema 无效 profile、连续构建两个 profile 和不得静默回退的测试。

## 6. 按唯一目标架构修订文档

- [x] 6.1 重写 `docs/design/dsh-forge.md` 的目录、职责和运行时章节，使其只描述迁移后的目标实现，不出现“当前已实现布局”“后续目标布局”或并列替代方案。
- [x] 6.2 修正设计文档中的 `distribution.yml`、`profile.yml`、bundle manifest、默认 profile、公开 exports 和 CLI 示例，使每个示例符合真实 schema 与命令。
- [x] 6.3 更新 `docs/reference` 与 `docs/engineering`，将 desktop service 类型、generation 事实、工具包入口、产物平面和恢复边界链接到唯一权威来源。
- [x] 6.4 为需要执行的 YAML、TypeScript 和命令示例建立带标记的文档夹具，并由 parser、TypeScript 编译测试和 CLI 帮助检查验证。
- [x] 6.5 扩展 `docs:check`，检查本地链接、尾随空格、双轨表述、标记示例、公开接口路径和命令参数；失败诊断包含文件位置。

## 7. 质量门禁与交付验证

- [x] 7.1 更新 lint、format、typecheck、build 和 test 脚本，覆盖新目录并删除旧 `src` glob；确认不使用兼容性路径别名。
- [x] 7.2 运行工具链、desktop-plugin、profile、runtime 安全和文档相关的最小测试集，补齐失败场景的中文诊断和注释。
- [x] 7.3 运行完整 `check:all`、profile 默认与 Fork 验证、Electron 集成冒烟、`docs:check`、OpenSpec 严格验证和 `git diff --check`。
- [x] 7.4 使用旧路径搜索、workspace 依赖图和生成物清理后的重建验证，证明设计目录是唯一生产实现来源。
- [x] 7.5 记录实际验证命令、已知平台限制和迁移结果；未运行的检查不得标记为通过。
