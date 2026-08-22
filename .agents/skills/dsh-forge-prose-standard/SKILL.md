---
name: dsh-forge-prose-standard
description: 用于审查或编写 DSH Forge 的 Markdown、JSDoc、注释、提示词、诊断、CLI 和可见字符串，保留完整契约并删除重复、装饰、推理过程和未实现功能承诺。
---

# DSH Forge Prose 规范

写作目标是让读者在没有会话记录的情况下理解当前行为、限制、风险和验证边界。该 skill
负责编辑判断与必要的 prose 覆盖，是指导而不是自动重写脚本；文档放置和层级使用
[`dsh-forge-doc-standards`](../dsh-forge-doc-standards/SKILL.md)，变更前后的门禁使用
[`dsh-forge-pre-push-checks`](../dsh-forge-pre-push-checks/SKILL.md)。

`contract`、`boundary`、`surface`、`seam`、`gate` 等词不是禁词。先判断是否应该直接
写出具体的 API、字段、校验、时序、权限、组件或失败状态；只有这些词准确命名技术对象
时才保留。

## 输入与排除

开始前必须明确 `scope` 和 `mode: automatic | interactive`。未给出 scope 时，报告所需
范围并停止，不自行扩大为全仓库审查；mode 默认 `automatic`，只有用户明确要求提问或
校准时才进入 `interactive`。

mode 只控制是否提问，不授予写权限：review/audit 默认只报告；用户明确要求 write、fix、
trim 或 rewrite 后才能编辑。无论 mode 如何，都必须按用户授权范围操作。

发现、审查和编辑始终排除：

- `vendor/`、`node_modules/`、`dist/`、`artifacts/` 和构建缓存；不得跟随 symlink 进入这些目录。
- 由构建生成的 manifest、SBOM、license notice、package evidence 和 smoke evidence；应
  修改 profile、catalog、脚本或生成源后重新生成。
- 测试生成的临时 fixture 和快照，除非用户明确要求修改该场景；修改 fixture 前先确认它
  是场景源而不是派生结果。
- 已归档的 OpenSpec 变更或历史记录，除非任务明确要求修复归档事实；当前设计和活动
  OpenSpec 变更可以正常更新。

DSH Forge 没有 DeepSeek Harness 的固定双语 README 配对流程。新增或修改文档默认使用
中文；包名、命令、API、schema、错误 code、协议字段和稳定路径保留原文，不为了套用上游
仓库的双语结构创建未完成的翻译文件。

## 完整命题

编辑前先识别段落中的每个事实命题，并保留：

- 行动者和动作；
- 条件、顺序、时机和适用范围；
- `必须`、`可以`、`禁止`、`不会` 等模态强度；
- 负向保证和例外；
- 所有权、持久化、副作用、取消、失败模式和失败后果；
- 当前实现与未来独立变更之间的边界。

删除形容词、重复、审查过程和控制流旁白，只有在所有事实仍然存在且更清楚时才成立。
字数变少不是质量目标。架构、算法、历史和长示例只保留必要结论，并链接到唯一权威
来源；调用方必须在当前位置看到足够的行为、失败、所有权和安全使用条件。

## 按内容类型覆盖

- **公共 JSDoc**：说明调用方可观察的返回区别、抛出/拒绝、参数约束、副作用、所有权、
  时序、取消和持久化。类型已表达的字段不要逐行重述。
- **内部注释**：只说明代码难以表达的生命周期、竞态顺序、恢复不变量、权限边界或非显然
  的架构理由；删除控制流解说和变量赋值旁白。
- **模块注释**：说明模块职责、依赖、所有权和为何存在的非显然边界；链接到设计或契约
  文档，不复制整章设计。
- **包 README**：按“包定位 → 配置/入口 → API 或行为 → 生命周期/失败 → 模型影响（如有）
  → 已知限制 → 维护验证”组织，并区分公开 `desktop-services` contract 与私有
  `desktop-services-local` provider。
- **设计文档**：描述当前直接子系统、目录职责和关键行为；不能把未来的插件市场、模板、
  profile UI 或 Tauri 宿主写成当前承诺。
- **工程文档**：保留迁移边界、恢复、平台覆盖和已执行验证；删除未执行的“已通过”声明。
- **OpenSpec**：保留动机、目标/非目标、决策、替代方案、后果、验收和覆盖缺口；删除
  评审对话、临时执行日志和不再适用的计划旁白。
- **示例和配置注释**：说明加载顺序、权限、边界、失败和常见误用；配置已经明显表达的
  字段不添加逐项解释。
- **诊断与 CLI/UI 字符串**：命名失败对象、违反的规则、稳定错误 code 和可操作修复；
  不泄露密钥、完整环境、用户数据路径或内部执行细节。
- **测试注释**：只解释为什么必须走真实 Loader、生成物、子进程、平台 fake、间接观察或
  失败路径；删除测试 walkthrough 和断言清单。
- **Skills/Agent instructions**：说明触发条件、行为护栏、排除范围、写权限和验证方式，
  明确“指导而非脚本/清单”时不要过度承诺自动化能力。

## 工作流程

1. 确认 scope、mode、用户授权、当前分支和适用的根/子目录 `AGENTS.md`。
2. 读取当前代码、配置、测试、package README、设计/reference 和相关 OpenSpec；不要只按
   文件名判断文档事实。
3. 判断文档是教程、参考、设计、工程记录、README、skill 还是 OpenSpec，并把深度细节
   放到所属文档；必要时先搜索入站链接再移动。
4. 用 `rg` 查找重复短语、旧路径、删除包名、错误 code、命令、配置字段和未来功能承诺；
   读取命中上下文，区分当前事实、负向保证和提案。
5. 将候选分类为保留、补充、精简、重组、迁移或暂缓。自动模式下对明确结论直接编辑；
   真正有两个等价版本时记录取舍，不削弱命题来消除歧义。
6. 先更新权威来源，再同步包 README、设计/reference、OpenSpec 或生成产物；不要反过来
   手工修改派生文件。
7. 复读修改后的全文，检查代码围栏、列表、相对链接、命令和可执行示例；运行相关门禁、
   `git diff --check` 和需要的行为测试。
8. 报告 scope、明确改动、刻意保留、暂缓项和实际运行的检查；不得把未运行检查写成通过。

## 当前项目的文案护栏

以下表述必须与实现保持一致：

- 打包发行包固定构建时选择的 profile；开发态 `--profile` 不是终端用户运行时切换能力。
- catalog 保存静态审核事实，不等于插件下载目录；当前没有页面端动态安装流程。
- `desktopPnpm.install()` 是受控底层操作，不是当前产品 UI；`trusted-in-process` 不是安全
  隔离。
- `desktop-services-local` 是私有 provider，第三方 README 和示例不得将它当作 consumer
  API。
- `templates/`、空 `features/generators`、在线更新、托盘/终端 UI 和 Tauri 只在明确标注
  为未来独立变更时出现。
- `dist/`、`artifacts/`、lockfile 和 resolved manifest 的生成事实不能被写成手工源文件。

## 边界判断

案例只有在至少两个版本都保留完整命题、但在简洁性、查找效率、架构层级或当前用户目标
之间存在真实取舍时才算 borderline。一个事实只有一种清楚写法时，不要用“存在分歧”拖延
编辑。

自动模式下直接选择符合当前代码和权威文档的版本；交互模式下只提出两或三个可行版本，
标出模态强度、失败后果和结构差异，推荐一个，不提供明显劣质选项。用户决定后，将原则
应用到 scope 内的同类段落，而不是只修一处。

## 验证

文档和 skill 变更至少运行：

```sh
pnpm run docs:check
git diff --check
```

其中 `docs:check` 当前扫描 `docs/`、`openspec/` 和两个桌面 service README，检查尾随空格、
Markdown 相对链接、文档命令、已删除路径、标记 YAML 和公开 consumer 示例；根
`README.md` 与根 `AGENTS.md` 不在该脚本扫描范围内，修改它们时必须额外手工检查。

涉及代码注释、诊断或包 API 时，按变更范围再运行相应 package build、consumer 类型检查、
provider 测试、`boundaries:check` 或 profile/catalog 门禁。
