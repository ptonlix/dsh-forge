# 翻译规则

本规则适用于 [public-documents.json](public-documents.json) 中 `public` 和 `internalBilingual` 列出的每个英文源文件及其中文兄弟文件。

## 配对与审查

- 英文文件使用 `foo.md`，中文文件使用 `foo.zh.md`，记录使用 `foo.i18n.yaml`；三者必须位于同一目录。
- 两侧文件均以标题后的语言切换行开始：英文侧链接到同目录中文兄弟文件，中文侧链接回同目录英文文件。
- 翻译审查检查读者可观察的行为、限制、失败后果和命令，而不只检查文字是否流畅。包名、命令、API、schema、错误 code 和路径保持原文。
- sidecar 保存两侧的 Git blob hash，而不是 commit hash，因此可以记录尚未提交的同一变更内容。仅在两侧确认同步后运行 `pnpm run docs:pair --write <path>` 更新它。

## 结构与链接

- 标题层级、列表形状、表格列数和行数、代码围栏语言序列必须相同。
- 对方语言的相对文档链接必须指向对应的兄弟文件；例如英文 `foundation-contracts.md` 在中文侧对应 `foundation-contracts.zh.md`。
- 链接到未纳入公开清单的内部文件时，两侧可以使用同一路径，但不得将私有 provider 文档写成第三方 consumer API。
- `internalBilingual` 文档必须保留在 `excluded` 清单中；它们接受双语一致性检查，但不进入文档站发布清单。
- 表格、命令、YAML 和 TypeScript 示例属于结构的一部分。示例含义、字段和失败条件必须同步。

## 责任

修改公开文档的维护者负责完成两侧和 sidecar；评审者负责检查术语、产品边界和链接目标。自动检查只发现结构、链接和记录漂移，不宣称机器翻译或语义审查已经完成。
