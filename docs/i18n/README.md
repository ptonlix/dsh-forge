# 双语文档治理

本目录定义 DSH Forge 文档的中英文维护规则，不承载产品、工具链或运行时事实。
公开页面和内部双语文档的目录归属以 [public-documents.json](public-documents.json) 为准；文档站只从 `public` 清单投影正文。

每篇 `public` 或 `internalBilingual` 文档由同目录的三个文件组成：英文 `foo.md`、中文 `foo.zh.md` 和记录两侧 Git blob hash 的 `foo.i18n.yaml`。两种语言同等权威。修改任一侧时，维护者必须在同一变更中核对另一侧，并运行以下命令重写记录：

```sh
pnpm run docs:pair --write <英文文档路径>
```

`docs:check` 会拒绝缺失对侧、错误 hash、结构不一致、错误语言切换链接和未本地化的公开文档链接。规则细节见[翻译规则](translation-rules.md)，稳定术语见[术语表](terminology.md)。

`public` 文件会发布到文档站；`internalBilingual` 文件只接受同样的配对、结构、链接和 hash 检查，不会发布到文档站。`AGENTS.md`、`openspec/`、本目录的治理文档和内部验证记录仍不能因为位于仓库中而被自动翻译或发布。
