## Context

基础契约已经实现 profile 编译、组合、generation、桌面 service 和发布检查，但实现以根级 `src/` 为主要生产源码面。`apps/desktop/main.ts` 同时承担 Electron 适配和 DSH 启动细节，未形成设计要求的 `desktopRuntime` 边界；CLI 固定选择默认 profile，文档中的目录、配置、公开 contract 和命令也已发生漂移。详见 `proposal.md` 的动机以及本变更的四项能力规格。

本次迁移必须将 `docs/design/dsh-forge.md` 作为唯一的完成态描述。迁移期间可以使用版本控制回退，但仓库中不允许以 re-export、复制实现或文档中的“现状/目标”并列方式保存两个生产架构。

## Goals / Non-Goals

**Goals:**

- 让每个生产模块拥有与设计一致且可由工具检查的唯一目录归属。
- 将 Electron 专有行为隐藏在内部原生运行时提供方后，并完整落实单实例和导航安全规则。
- 使任何已定义的 profile 操作都能显式处理官方或 Fork profile，且不会静默改变选择。
- 以 exports、schema 和 CLI 的可执行行为驱动文档验证，消除手工维护的失效示例。
- 在不改变已定义的 profile、generation、安装恢复和发行语义前提下完成迁移。

**Non-Goals:**

- 不重新设计 DSH 的 agent loop、Cordis 行为、会话协议或第三方插件的进程隔离。
- 不为没有真实产品功能或代码生成行为的 `features`、`generators` 目录制造空实现包；其集合目录在有可测试职责时创建实际包。
- 不为旧的根级 `src/` 路径或未导出的实现路径提供兼容层。
- 不在本变更中修改发行版身份、profile schema 或已有 `desktopProfiles`、`desktopPnpm` 的公开业务语义，除非为 package exports 和选定 profile 传递所必需。

## Decisions

### 1. 以 package 化的工具面取代根级 `src/`

根级 `tools/` 新增一个受 workspace 管理的 profile 工具包，拥有 profile 解析、组合、catalog、发布、schema、CLI 及其共享类型。该包通过受限 exports 向 Electron 应用和构建脚本提供 profile、发行和检查能力；其内部文件不被跨包导入。原 `src/compiler`、`src/composer`、`src/core`、`src/release`、`src/trust`、`src/acceptance`、`src/cli` 与根级共享类型按职责迁入此工具包。

`apps/desktop` 只保留 Electron 应用和宿主编排：`main.ts` 调用工具包和 desktop-plugin 的公开模块，不再从根级 `src/` 导入。`packages/desktop-plugin/host` 拥有 generation 范围的 desktop service 实现；`contracts` 保持唯一公开类型源；`client` 仅容纳真正的桌面客户端代码。`packages/bundles` 继续只保存 bundle 内容。

目标布局如下；`features` 与 `generators` 是实际包的集合根，不以空包冒充功能：

```text
dsh-forge/
├── apps/desktop/
│   ├── main.ts
│   ├── native-runtime.ts
│   └── platform/
├── packages/
│   ├── desktop-plugin/
│   │   ├── host/
│   │   ├── client/
│   │   └── contracts/
│   ├── bundles/
│   ├── features/
│   └── generators/
├── tools/profile-toolchain/
├── profiles/
├── catalog/
├── templates/
├── schemas/
├── scripts/
└── docs/
```

选择单一工具包而不是继续保留根级 `src/` 并添加路径别名，是为了让包的 exports、依赖方向和构建输入可以被静态验证。为每个现有小模块建立独立 workspace 会增加发布和依赖面，当前没有相应的独立消费者。

### 2. 用内部 `desktopRuntime` 隔离 Electron

`apps/desktop/native-runtime.ts` 定义应用私有的 runtime capability，并由 Electron adapter 实现。合同至少覆盖单实例生命周期、私有 user-data 路径、主窗口创建、受控外链打开和进程退出；`apps/desktop/platform/` 承载窗口和平台特定的实现。启动器只接受该 runtime capability，Host、bundle 和 desktop-plugin contract 永不接收 Electron 对象。

现有 `createElectronWindowFactory` 被拆分为 platform 实现与与 runtime 无关的启动编排。创建窗口时固定 sandbox、context isolation 和禁用 Node integration；运行时在加载前保存本 generation 的规范 loopback URL，并同时拦截主框架导航与新窗口请求。仅 HTTP、HTTPS、mail 允许通过系统处理程序打开，其他协议拒绝。

不把 Electron API 直接注入 Cordis 或扩展 `desktopProfiles`、`desktopPnpm` 来承载原生能力。前者会破坏替代宿主边界，后者会把兼容 API 错当成任意原生权限通道。

### 3. 将 profile 选择作为所有范围命令的显式输入

工具 CLI 为所有 profile 范围命令统一解析可选位置参数 `<profile>`。缺失参数时，从解析后的 `distribution.yml` 获取默认 profile；存在参数时，先验证名称、目录、schema 和 runtime 兼容性，再进入解析、验证、打包或检查。命令结果始终输出选择后的 profile 与对应 artifact 路径。

`package.json` 仅作为参数透传器：例如 `pnpm run profile:resolve -- developer` 与直接调用 CLI 的选择结果相同。打包脚本和检查脚本使用同一 resolver，不能自行读取“最新 artifact”替代显式 profile；artifact 查找必须同时限定发行版 ID、profile 名称和 resolved manifest 输入摘要。

将 profile 选择散落在每个脚本中会导致默认值、错误处理和产物隔离不一致，因此采用单一 resolver。也不使用环境变量隐式选择 profile，因为命令输出将无法证明选择来源。

### 4. 将文档示例转为可执行一致性输入

文档不复制完整 schema 或手写的 contract 定义。`docs/design/dsh-forge.md` 只保留架构、职责和指向权威参考的链接；`docs/reference/` 从 exports 和 schema 的稳定事实生成或校验精简接口片段。示例 YAML 提取到文档测试夹具，并由实际 parser 验证；命令示例由 CLI 的声明式命令表和 package scripts 验证；公开类型示例由 TypeScript 编译测试验证。

`docs:check` 扩展为上述一致性检查，同时保留链接和格式检查，并明确拒绝“当前已实现布局”“后续目标布局”等双轨表述。文档不描述迁移过程，迁移取舍仅保留在 OpenSpec 设计与变更记录中。

不通过手写正则尝试解析整份 Markdown 中所有 TypeScript 或 YAML 代码块：这样的规则会将说明性片段误当成输入。每个需要执行校验的示例使用可识别的文档标记并映射到专用 fixture，其余说明文本由链接和关键短语检查覆盖。

### 5. 用迁移门禁证明单一架构

迁移完成时，TypeScript 项目引用和脚本 glob 覆盖 `apps`、`packages`、`tools`、`scripts` 和 `tests`；workspace 包含 `tools/*`。静态边界测试检查禁止路径、公开 exports 和依赖方向。Electron 测试使用受控 runtime fake 验证单实例、导航、新窗口和外链决策，再用 Electron 集成冒烟确认安全偏好实际写入 BrowserWindow。

所有历史源码在新路径测试和导入替换完成后一次性删除。无需运行期的兼容代码；如果迁移失败，使用 Git 回退整个变更而不是恢复 `src/` 的并存实现。

## Risks / Trade-offs

- 工具包迁移可能破坏大量内部导入 → 先建立 exports 和编译测试，再按依赖图迁移，最后删除根级 `src/` 并用禁止路径测试收尾。
- Electron 导航 API 的时序差异可能遗漏窗口创建路径 → 在 runtime fake 中覆盖 `will-navigate` 与 `setWindowOpenHandler`，并对真实 BrowserWindow 做集成断言。
- profile 参数会改变现有脚本调用 → 默认 profile 保持 `distribution.yml` 语义，所有显式参数的错误均为失败而非回退，并补充 package script 测试。
- 文档校验可能成为脆弱的文本检查 → 只校验带标记的可执行示例和有限的禁止短语；接口事实从 schema、CLI 命令表和 exports 获得。
- 移动文件会使现有未提交修改难以合并 → 迁移前保留并逐处携带工作树变更；不重置、不覆盖，也不保留旧文件作兼容副本。

## Migration Plan

1. 建立 `tools/profile-toolchain` workspace、其 exports、构建配置和边界测试；迁移无 Electron 依赖的 schema、编译、组合、信任、发布、CLI 与共享类型，并更新脚本和测试导入。
2. 将 generation-scoped desktop service 实现迁入 `packages/desktop-plugin/host`，保持现有公开 contract 子路径，更新应用通过 package exports 消费它。
3. 抽取 `desktopRuntime`、Electron adapter 和 `platform` 窗口实现；接入单实例锁、规范 loopback authority、导航拦截、新窗口拒绝和允许协议的系统外链。
4. 为工具 CLI 引入统一 profile resolver，更新每个 profile 范围命令、package script、artifact 查找和 profile/Fork 测试。
5. 删除根级 `src/`，收紧 TypeScript include、lint/format glob、workspace 包及禁止路径检查；确认任何生产导入均未穿透 workspace 源码。
6. 同一实现提交中修订设计、参考和工程文档，使其引用迁移后的目录、可解析 YAML、当前 exports 和真实命令；为标记示例添加文档测试夹具。
7. 运行类型检查、lint、格式检查、相关单元与 Electron 测试、profile 默认和 Fork 参数测试、文档检查、OpenSpec 严格验证及 `git diff --check`。

回滚以 Git 变更为单位进行。不得通过恢复根级 `src/`、保留旧 module exports 或让文档重新出现旧布局来进行运行时回滚。

## Open Questions

无。
