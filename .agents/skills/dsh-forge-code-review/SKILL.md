---
name: dsh-forge-code-review
description: 用于审查 DSH Forge 的提交或变更，重点检查正确性、生命周期、安全性、供应链和公开契约，而不是罗列格式性意见。
---

# DSH Forge 代码审查

这是面向 DSH Forge 的语义审查指导，不是自动修改器或完整清单。默认只读：审查时不改
代码、文档、测试、OpenSpec 或配置，也不执行 commit、push、发布、签名或删除。只有用户
明确要求修复时，才在审查报告之后进入实现流程。发现必须有可定位的代码、配置、测试或
文档证据；没有可复现影响的纯风格偏好不应阻塞变更。

## 与 DeepSeek Harness 的边界

本仓库没有 Harness 专属的 change-scope、Agent Notes、docs/defensive-patterns.md、
双语 review/translation pairing、GitHub stack 流程或 invariant 包规则。不要把这些路径、
命令或门禁写成 DSH Forge 的既有要求。Forge 的审查范围由当前工作树、用户提供的提交基线、
根 AGENTS.md、设计/reference/engineering 文档、活动 OpenSpec 和实际 package scripts
确定。

## 建立审查范围

本地变更先运行：

~~~sh
git status --short --branch
git diff --stat
git diff
git ls-files --others --exclude-standard
~~~

若审查提交或 PR，必须由用户提供或允许验证 base/head；不要猜测远程分支、PR base 或
stack parent。完整读取变更和足够的上下文，特别是调用方、package.json exports、配置
来源、生成物来源、Loader、错误传播、资源释放和测试入口。未跟踪的 README、schema、fixture
和 skill 也属于审查范围，不能只看 git diff。

先读取与变更相关的权威上下文：

- 根 AGENTS.md；
- docs/design/dsh-forge.md；
- docs/reference/foundation-contracts.md；
- docs/engineering/foundation-boundaries.md 和 foundation-verification.md；
- packages/desktop-services/README.md 与 packages/desktop-services-local/README.md；
- 影响范围内的 schemas/、profiles/、catalog/、tools/profile-toolchain/ 和活动
  openspec/changes/。

审查前建立变更地图：列出修改的 package、入口、公开 exports、profile/bundle/catalog、
产物、运行时状态、文档和测试；为每一项标注生产、构建、开发态、测试、fixture 或未知动态
消费者。没有消费者不等于可以删除，必须继续检查 Loader、Cordis patch、CLI、spawn、生成
配置和打包闭包。

## 阻塞要求

以下问题在有证据证明会影响正确性、数据完整性、安全边界、公开契约或可交付产物时应作为
阻塞发现；不要仅因命名或格式偏好阻塞。

1. **接口两端一致**：追踪每个变更接口的调用方和实现方，核对参数约束、返回值、错误
   code、取消、所有权、持久化、副作用和时序；不能只看类型或单侧实现。新增公开字段、
   类型或子路径必须同步 exports、README、基础契约和 consumer fixture。
2. **Generation 生命周期**：检查 Host entry、loopback readiness、窗口加载、renderer
   boot report、last-known-good 提交和失败恢复的顺序。dispose 后旧引用、回调、
   operation lease 和子进程不得触碰新 generation；关闭、信号、崩溃和启动失败必须有界
   teardown。
3. **异步、取消与进程树**：对每个 await、callback、watcher、timer 和子进程追踪取消、
   re-entry、独立错误报告和最终排空；cancel() 可重复调用且调用方仍需等待 done。
   检查非零退出、健康检查失败、取消和重启时是否留下孤儿进程或未释放 lease。
4. **WAL 与安装恢复**：安装请求必须来自深度冻结的 ConfirmedPluginInstall，并重新绑定
   当前 generation 的静态 catalog。提交 receipt 前核对包名、精确版本、来源、commit 或
   tarball 和 integrity；来源漂移、未知 lockfile、pnpm 失败、取消、reconcile 失败或下
   一代健康检查失败时，受保护文件必须恢复并记录失败/人工恢复事实。不要把 WAL 误写成
   node_modules 回滚保证。
5. **Electron 安全**：确认 BrowserWindow 使用 sandbox、context isolation 和
   nodeIntegration: false；renderer 只能导航当前 generation 的 loopback authority；
   未知协议、任意文件路径、任意新窗口和 Node 访问必须拒绝。单实例锁应先于 Host/generation，
   第二实例只能通知并聚焦现有窗口后退出。Electron 私有对象不得进入公开 service、bundle
   manifest 或第三方插件。
6. **Profile 和产物隔离**：发行包必须在构建期固定一个 profile；开发态 --profile 不得
   被写成运行时切换能力。显式 profile 无效必须失败，不能静默回退；每个 profile 的
   resolved manifest、lockfile、SBOM、license notice 和安装包必须使用自己的 artifact
   目录，不能复用另一个 profile 的结果。
7. **Catalog 与供应链事实**：外部 bundle 的来源、精确版本、integrity、许可证、能力、
   审核等级、Git 依赖完整 40 位 commit、构建脚本和 allowBuilds 必须可追溯。catalog 是
   静态审核快照，不是启动时动态下载目录；锁文件、SBOM 或 catalog 不能被当作作者可信或
   代码安全的证明。
8. **公开/私有边界**：第三方 bundle 只能依赖 @dsh-forge/desktop-services；不得导入
   desktop-services-local、launcher、Electron、原始 IPC、profile 路径或 pnpm 参数。私有
   provider 的根入口只由 desktop layer 注册，./launcher 只由 apps/desktop 创建 capability；
   profile-toolchain 不得反向依赖 apps/desktop。
9. **当前能力与文档一致**：不能把 desktopPnpm.install() 写成当前页面功能，不能宣称有
   在线插件目录、运行时下载、profile UI、模板生成、Tauri、托盘/终端 UI 或签名/更新链路，
   除非对应代码和独立 OpenSpec 已落地。代码、README、设计/reference、OpenSpec 和错误提示
   的模态强度必须一致；新增 prose 按 dsh-forge-prose-standard 检查。
10. **真实入口和测试强度**：涉及 package exports、bundle、Loader、子进程、Electron 或
    打包路径时，测试必须经过真实 consumer、Loader、构建产物、package:inspect 或
    package:smoke 等入口（按变更适用）。测试应观察外部状态、事件、日志、文件、进程和
    dispose 结果；只重复实现逻辑、手工挂载插件或只看覆盖率不能证明行为正确。

## 手工审查路径

按以下顺序推进，避免先被局部风格吸引：

1. **意图与范围**：将用户请求、活动 OpenSpec 的目标/非目标和实际 diff 对齐，标出无关
   功能、投机扩展、兼容层和未说明的行为变化。
2. **数据与契约**：追踪 schema、YAML/JSON parser、运行时手写校验、错误 code、序列化和
   生成物；确认未知字段、缺失字段、来源漂移、坏版本和边界输入不会静默通过。
3. **所有权与生命周期**：画出 generation、service、operation、WAL、process tree、窗口、
   receipt 和 artifact 的创建者、借用者、冻结点、持久化者、取消者和 dispose 者；重点检查
   await 期间关闭、并发调用、late callback 和恢复后的旧引用。
4. **权限与执行边界**：沿每条拒绝路径追踪到真正执行点，检查是否存在绕过 schema、prompt、
   facade、wrapper、IPC 或 listener 顺序的直接调用；检查 workdir、环境、命令参数、脚本权限
   和网络/文件权限是否由 provider 控制。
5. **构建与发布**：确认 profile/bundle 组合、静态 catalog、lockfile、SBOM、native addon、
   Electron 资源和 package artifact 的来源唯一且可复现；生成物只能由源文件重新生成。
6. **文档与测试**：逐段审查新增 Markdown、JSDoc、注释、诊断和可见字符串；检查测试是否
   覆盖成功以及适用的失败、取消、并发、恢复和安全负向路径。只报告实际运行的检查。

## 按变更范围选择证据

不要机械运行全仓库；选择能捕获该回归的最小真实检查，并在跨边界时追加检查：

- 文档、skill、README、OpenSpec：pnpm run docs:check、git diff --check；根 README、根
  AGENTS.md 和 .agents/skills 不在 docs:check 扫描范围内，需额外人工复读和链接检查。
- packages/desktop-services contract、exports 或示例：对应 package build、
  pnpm run test:desktop-services-consumer、pnpm run boundaries:check。
- packages/desktop-services-local、generation、WAL、取消或进程树：对应 package build、
  pnpm run test:desktop-services-local、pnpm run boundaries:check。
- profiles/、bundle、组合或 profile-toolchain：pnpm run profile:resolve -- <profile>、
  pnpm run profile:verify -- <profile>、pnpm run dump-config -- <profile>；catalog 变更
  追加 pnpm run catalog:verify。
- schema、trust、release 或 acceptance：运行对应工具链测试，并按范围追加
  pnpm run release:gate -- <profile> 或 pnpm run acceptance。
- Electron、native runtime、窗口/导航或打包资源：相关 runtime 测试，以及适用的
  pnpm run package:desktop -- <profile>、pnpm run package:inspect -- <profile>、
  pnpm run package:smoke -- <profile>。
- 跨模块、公开契约与发行链路同时变化：在聚焦证据通过后才考虑 pnpm run check:all，不
  用它替代对失败/取消/恢复和真实入口的语义审查。

测试或后台命令单次最长 60 秒；挂起时先定位未排空的 process、timer、promise、generation
或 operation lease，不要只增加超时。未运行、平台不可用、需要网络/凭据、签名/公证或外部
服务的检查必须在报告中标为未验证。

## 报告格式

报告先列 findings，再列假设、测试缺口和简短变更总结。每条 finding 使用以下结构：

~~~text
[严重程度] 文件:行号
缺陷：具体说明违反了什么契约或不变量。
影响：说明用户、数据、进程、供应链、安装包或下游 consumer 会如何受影响。
证据：引用代码/配置/测试/文档路径、调用链、命令输出或可复现步骤。
修复方向：给出最小修复边界；若涉及行为删除、公共 API、格式、目录或依赖替换，先创建
OpenSpec，不在 review 中直接实施。
~~~

严重程度应反映可观察后果：阻断发布/破坏安全或数据恢复的错误最高；改变公开契约、丢失
生命周期清理或破坏 profile/catalog 可复现性的错误次之；仅在证据充分且影响明确时报告
低风险建议。位置应落在能让作者修复的最小 diff 范围；跨文件所有权或架构问题放在变更级
别说明，不要伪装成局部行号问题。

若没有发现，明确写“未发现可阻塞问题”，同时列出实际运行的检查、未运行的平台/发布链路
和仍存的残余风险。不要把 CI、用户环境或审查者推断写成本地通过证据。
