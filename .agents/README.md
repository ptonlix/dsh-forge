# DSH Forge Agent 工作资产

`.agents/` 存放帮助智能体维护 DSH Forge 的决策记录与工作流技能。它不是产品运行时，也不承载 DSH 核心源码。

## 本次采用的内容

- `skills/dsh-forge-doc-standards`：文档放置、层级、链接和验证规则。
- `skills/dsh-forge-prose-standard`：保持契约完整，删除重复和推理过程残留。
- `skills/dsh-forge-code-review`：按正确性、安全性、生命周期和公开契约审查变更。
- `skills/dsh-forge-simplification`：用调用方证据识别可以删除或合并的表面。
- `skills/dsh-forge-pre-push-checks`：根据变更范围选择最小但可信的本地验证。
- 提案、设计决策、任务拆分和验收状态统一由 `openspec/` 管理。

这些内容参考了 `deepseek-harness/.agents`，但已经去除了对上游包路径、脚本、VitePress、双语配对和 DSH 内部运行时的直接依赖。

## 有意暂缓的内容

- 上游 2,000 余份运行时实现 Note：它们描述的是 DeepSeek Harness 的内部服务、事件和包边界，不是 DSH Forge 的发行版组合层。
- 双语翻译工作流：当前项目的设计文档按中文单语维护，尚未建立英文对侧和配对门禁。
- 文档站点同步：当前仓库没有 `website/` 或生成投影目录。
- 浏览器 GIF、堆叠 PR 和上游专用发布流程：等桌面应用和协作基础设施真正存在后再引入。

新增工程基础设施时，应先创建 OpenSpec 变更，说明为什么启用对应工作流以及它的验证入口。
