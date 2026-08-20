## Purpose

确保 DSH Forge 的设计和参考文档是可执行的当前契约，使目录、配置、公开接口和命令示例与受支持实现同步，而不是保存历史实现或未来猜测。

## ADDED Requirements

### Requirement: 设计文档必须只描述唯一目标架构
顶层设计文档 MUST 将其中声明的目录、模块职责、运行时边界和 Fork 路径视为仓库的唯一目标架构。文档不得把未实现的替代目录或 API 标记为“当前布局”“后续目标布局”或与实现并列的第二套事实来源。

#### Scenario: 审阅目录设计
- **WHEN** 维护者检查顶层设计文档中的仓库目录和包职责
- **THEN** 每项生产目录与职责均可在实现或本变更的已验收契约中找到唯一归属

### Requirement: 配置与命令示例必须可由受支持输入验证
文档中的 `distribution.yml`、`profile.yml`、bundle manifest 和命令示例 MUST 使用当前 schema、公开命令和参数规则。质量门禁 MUST 将示例解析或与其声明的 schema、CLI 帮助和 package script 进行一致性验证。

#### Scenario: 校验 profile 示例
- **WHEN** 文档检查处理 profile YAML 示例
- **THEN** 示例通过当前 profile schema，且只包含被该 schema 接受的字段和有效的 YAML 值

#### Scenario: 校验命令示例
- **WHEN** 文档检查处理 profile 解析、验证或打包命令
- **THEN** 每个命令、参数位置和 profile 选择行为均与 CLI 的可执行帮助一致

### Requirement: 公开接口参考必须来自包 exports
设计和参考文档中面向第三方的 TypeScript 类型、服务方法和返回值 MUST 与 package exports 中的声明一致。文档不得把 launcher 内部能力、已移除的方法或非导出源码路径描述为公开接口。

#### Scenario: 校验 desktop service 示例
- **WHEN** 文档检查处理 `desktopProfiles` 或 `desktopPnpm` 的类型示例
- **THEN** 示例可由对应公开 contract 的声明验证，且不引用私有模块

### Requirement: 文档漂移必须阻断质量门禁
文档检查 MUST 验证本地 Markdown 链接、禁止的双轨表述、配置示例、命令示例和公开接口引用；任何不一致 MUST 使检查失败并给出源文档位置。

#### Scenario: 修改公开 service 未更新文档
- **WHEN** 公开 desktop contract 的方法或类型发生变化而文档仍保留旧签名
- **THEN** 文档检查失败，直到参考文本与当前 exports 同步
