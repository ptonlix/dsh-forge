---
name: dsh-forge-simplification
description: 用于审计 DSH Forge 中没有生产消费者、重复保存事实、投机扩展或可由成熟依赖替代的复杂表面，并为真实的简化候选建立代码、配置、构建和测试证据。
---

# DSH Forge 简化审计

这是证据驱动的简化审计，不是“看起来复杂就删”。目标是减少真实维护面、依赖面、
状态面或失败路径；优先提出少量可以由实现和生产消费者证明的候选。该 skill 是指导，
不是删除脚本，也不会替用户决定公共 API 或产品范围。

## 开始前读取的上下文

审计前先读取根 `AGENTS.md`、[`README.md`](../../../README.md)、
[`docs/design/dsh-forge.md`](../../../docs/design/dsh-forge.md)、
[`docs/reference/foundation-contracts.md`](../../../docs/reference/foundation-contracts.md)、
相关 `docs/engineering/` 文档和对应 OpenSpec 变更。特别确认以下当前边界：

- 打包应用在构建期固定单一 profile，profile 选择只在开发态或构建命令中发生。
- `catalog` 是静态来源和审核快照，不是启动时动态插件市场。
- 第三方依赖构建期解析、锁定并随安装包交付；当前没有页面端插件目录或在线安装入口。
- `desktop-services` 是公开 contract，`desktop-services-local` 是只允许 launcher/desktop
  layer 使用的私有 provider。
- Electron renderer 安全策略、generation dispose、安装 WAL 和 lockfile 来源校验是受保护
  的生命周期/供应链边界，不能因为当前 UI 没有调用者就直接删除底层能力。
- 没有真实消费者和可测试职责时，不创建 `templates/`、空的 `packages/features` 或
  `packages/generators`。

## 什么是强候选

强候选必须能指出当前代码、配置、构建路径或生产入口中的成本，并且简化后仍能通过
对应门禁。典型候选包括：

- 公开方法、事件、配置项、注册通知或 package 没有生产消费者，且不是受保护的开发态、
  launcher 或未来明确契约。
- 两个持久化或运行时表示重复保存同一事实，导致同步、恢复或文档需要维护两份来源。
- 每个实现都必须提供但没有任何消费者使用的扩展点，并且没有 OpenSpec 保护理由。
- 仅为演示、fixture 或测试存在的独立 package 增加了 workspace、构建和依赖成本。
- 没有产品所有者的多 profile、动态安装、模板生成、通用 registry 或回滚能力增加了
  API、状态机和恢复路径。
- 手写协议解析、重试、glob、diff 或文件操作可以由 Node.js `>=20` 的内置能力或健康
  依赖完整替代，而且替换后会删除实现、专用测试、文档和维护路径。
- 同一 catalog、resolved manifest、SBOM 或 bundle 事实在多个源文件中手工复制，导致
  修改后可能漂移。

以下通常不是强候选：一个拼写问题、一次 `knip`/搜索命中、只删除测试断言、被文档提到
但由动态 Loader 使用的 entry，以及“未来可能用到”却没有成本证据的投诉。

## 证据流程

1. 明确审计 scope、模式和输出目标；默认只读 `automatic`，用户明确要求写入时才创建
   OpenSpec 或修改代码。
2. 用 `git status --short` 和 `rg --files` 建立范围，始终排除 `vendor/`、`node_modules/`、
   `dist/`、`artifacts/`；生成物只用于理解输入和验证，不作为删除证据。
3. 用 `rg` 搜索精确符号、事件、配置键、package 名称、CLI 字符串、manifest 字段和
   Loader entry；同时搜索 `.ts`、YAML、JSON、测试、README、设计文档和 OpenSpec。
4. 将命中分为生产消费者、构建/打包消费者、开发态消费者、测试/fixture、文档/提案和
   未知动态入口。不要把“测试没有调用”直接等同于“生产没有调用”。
5. 读取每个生产调用点，确认是否存在动态 profile 解析、Cordis patch、package exports、
   spawn、配置生成、catalog 绑定、IPC、恢复或外部启动入口。
6. 检查设计文档和 OpenSpec 是否明确保护该 service、格式、目录或安全边界；已有决策
   只有在新证据能推翻其理由时才允许降级。
7. 画出值和生命周期的所有权：谁创建、谁借用、谁冻结、谁持久化、谁取消、谁 dispose；
   对多套 sentinel、readiness、lease 或恢复标记，证明它们确实重复同一状态后再合并。
8. 计算净删除：实现、测试、README、schema、脚本、依赖和维护路径减少了什么，新增的
   适配层、迁移、兼容和验证成本是什么。

## 供应链和依赖替代审计

依赖替代是有效的简化方向，但必须先检查：

- 依赖在 Node.js `>=20` 和当前 pnpm workspace 可用，许可证、维护状态、版本和传递依赖
  可以接受。
- 依赖确实覆盖手写实现的语义；未覆盖的来源校验、取消、错误 code、WAL、平台行为或
  Electron ABI 仍由本仓库负责，不能把差异藏在 wrapper 中。
- 新依赖会减少实现和专用测试，而不是只把复杂度移动到一个薄适配层。
- package 来源、精确版本、integrity、允许脚本和 catalog 记录能够加入现有供应链门禁。
- 方案不会让 profile-toolchain 反向依赖 `apps/desktop`，也不会让第三方 bundle 获得私有
  provider 或 Electron API。

## 必须降级或拒绝的情况

降级为分析记录或拒绝删除，当出现以下任一情况：

- 存在生产调用方，删除会改变用户可见行为、打包闭包、公开 exports 或安装包结构。
- 该表面保护 profile、catalog、lockfile、WAL、generation dispose、renderer 安全或
  native ABI，而新证据没有证明替代方案等价。
- persisted、wire、manifest 或安装包格式仍需要读取，即使当前写入路径不再使用。
- 只剩一个 transport、默认值或 presentation 被移除，功能本身仍然存在。
- 删除会迫使无关模块大量改名/重构，却没有减少公共 API、状态或依赖。
- 结论只来自测试数量、静态工具警告或“将来可能用到”，没有生产入口证据。

不要为了满足简化目标而删除测试、放宽校验、隐藏错误、保留兼容 re-export 或把缺失
消费者改成动态字符串。若只有局部清理价值，使用短小的 `TODO(tag)`，不要制造长期
设计决策。

## 形成可实施提案

真正的行为删除、公共 API 收缩、目录移动、格式变更或依赖替换必须先创建 OpenSpec
变更，而不是直接删除。变更至少说明：

- 当前表面的唯一所有者和所有生产/非生产消费者；
- 要删除、合并、降级或迁移的精确文件、符号、字段、命令和测试；
- 不保留它的原因、替代方案、放弃的能力、用户影响和重新引入条件；
- catalog、profile、lockfile、artifact、README、schema 和文档链接的清理范围；
- 可观察的验收标准、负向测试、恢复行为和 `docs:check`/`boundaries:check` 等门禁。

提案完成后，搜索旧路径、符号、配置键、wire 字符串和 package 名称；确认没有动态加载、
生成文件或文档仍依赖旧表面。实现完成后，OpenSpec 任务、代码、测试和当前文档必须同步，
不能修改历史记录来伪造“从未存在”。

## 输出格式

审计报告按严重程度列出少量候选，每条包含：

1. **位置和对象**：文件、符号、配置键或 package。
2. **消费者分类**：生产、构建、开发态、测试、文档、OpenSpec 或未知动态入口。
3. **证据**：搜索命令、调用点、加载路径和设计/契约引用。
4. **建议动作**：删除、合并、迁移、降级为私有 helper、添加 TODO 或保留。
5. **净收益与风险**：删除的实现/测试/依赖，新增迁移/兼容/验证成本，行为变化和
   重新引入条件。
6. **验证缺口**：已运行和未运行的检查，不把未运行的测试写成通过。

审计结束时说明调查过的目录、刻意保留的受保护表面，以及哪些候选因证据不足被拒绝。
