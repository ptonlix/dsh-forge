# 文档盘点

本记录保存 `redesign-bilingual-documentation-site` 实施时的文档归属结论。它是仓库维护记录，不进入公开站点；其中私有 provider README 允许作为内部双语配对维护。

## 公开文档

| 文件 | 读者 | 唯一事实所有者 | 处理 |
| --- | --- | --- | --- |
| `README.md` | 使用者、Fork 维护者 | 项目定位、环境、快速启动和文档导航 | 改为英文入口，配对中文兄弟文件。 |
| `docs/README.md` | 全部公开读者 | 文档分类与权威来源导航 | 新增并配对。 |
| `docs/design/dsh-forge.md` | Fork 架构维护者 | 发行版架构、职责与运行时边界 | 保留路径，收敛重复 API/命令说明并配对。 |
| `docs/reference/foundation-contracts.md` | 配置与公开 service consumer | schema、稳定 service 和失败语义 | 保留路径，配对。 |
| `docs/engineering/foundation-boundaries.md` | 仓库维护者 | 源/产物、generation、恢复、安装与发布边界 | 保留路径，配对并发布。 |
| `packages/desktop-services/README.md` | 第三方 Host 插件作者 | `desktop-services` consumer API | 保留并配对；不得把私有 provider 当作 consumer API。 |
| `tools/profile-toolchain/README.md` | Fork 与工具链维护者 | 工具链入口、输入和操作参考 | 保留并配对；架构叙述链接到 design。 |

## 内部记录与删除

| 文件 | 归属 | 处理 | 原因 |
| --- | --- | --- | --- |
| `docs/engineering/foundation-verification.md` | 本地验证与平台覆盖 | 保留，不翻译、不发布 | 只记录实际执行证据，不能被解释为产品教程。 |
| `packages/desktop-services-local/README.md` / `README.zh.md` / `README.i18n.yaml` | 私有 provider 维护 | 保留，内部双语配对，不发布 | 说明 launcher、WAL 与恢复；不是第三方 API。 |
| `docs/engineering/agent-assets-migration.md` | 一次性上游资产迁移 | 删除 | 不描述当前发行版、工具链、桌面宿主、公开 service 或维护流程。 |

删除前的全仓库路径搜索只在本次 OpenSpec 提案中命中该路径，没有 README、设计、reference、工程文档、包 README、代码、脚本或站点清单的入站引用。删除后同样搜索，并保留提案中的历史删除理由；当前运行时和公开文档不引用该路径。

## 重复内容收敛

`README.md` 不再复制完整 profile、service 与发布语义；它链接到设计、参考和工程文档。design 不再复制公开类型字段，reference 不再重复完整工具链流程，包 README 只描述各自 consumer 或工具入口。生成物、签名与平台验证的实际执行情况只记录在 engineering 验证文件中。
