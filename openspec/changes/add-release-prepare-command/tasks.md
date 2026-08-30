## 1. 命令实现

- [x] 1.1 新增发布准备命令，严格校验精确 SemVer、当前版本和正安全整数 build。
- [x] 1.2 实现新版本重置 build、同版本递增 build、受控字段替换和失败恢复。
- [x] 1.3 在根 `package.json` 注册 `release:prepare` script，并输出版本/build 变化与 tag 提示。

## 2. 测试与文档

- [x] 2.1 增加命令测试，覆盖成功、预发布、非法输入、低版本、字段缺失、build 溢出和写入失败。
- [x] 2.2 更新发布参考文档，说明版本源、build 规则和 `pnpm run release:prepare -- <version>` 用法。

## 3. 验证

- [x] 3.1 已运行定向测试、相关 package build、typecheck、lint、docs:check、boundaries:check、
  OpenSpec 严格校验和 `git diff --check`，结果均通过。
