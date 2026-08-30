## Context

发行版身份的版本唯一来自根 `distribution.yml`；打包脚本使用该版本生成安装包名称、运行时
manifest 和 Release 索引。Electron 的 `app.getVersion()` 来自打包后的根 `package.json`，因此其
`version` 必须与 `distribution.yml` 同步；`dshForgeBuild` 用于同一 SemVer 的重建排序，由打包脚本
复制到最终应用。发布工作流还会将 annotated `v<version>` tag 与 `distribution.yml` 版本进行严格比较。

## Decisions

### 1. 命令参数和版本比较

命令只接受一个不带 `v` 前缀的精确 SemVer。实现使用本地纯 TypeScript SemVer 解析与比较，
覆盖预发布标识和忽略构建元数据的排序规则，不依赖构建后的 workspace `dist`。

目标版本低于当前版本直接失败；目标相等表示同一 SemVer 重发，目标更高表示新版本。

### 2. 源文件更新范围

实现以受控的行级替换更新 `distribution.yml` 顶层 `version`、根 `package.json` 顶层 `version` 和
`dshForgeBuild`，保留其他字段、顺序、注释和空白，避免 JSON/YAML 序列化带来无关 diff。写入前要求
两个版本源已经一致，避免从不明确的状态创建发布提交。

所有输入先读取和校验，再计算目标 build。新版本 build 固定为 `1`；同版本重发在当前正安全
整数基础上加一。

### 3. 失败和恢复

命令在写入前验证目标文件存在、字段唯一、版本有效和 build 合法。写入采用同目录备份与恢复
策略；若第二个文件写入失败，恢复此前已更新的文件并返回非零结果。成功后删除临时备份，不创建
提交、tag 或 Release。

### 4. 发布边界

命令只准备版本源文件，不运行 profile resolve、打包、签名、公证、上传或发布。维护者仍需
提交变更、创建与版本一致的 annotated `v<version>` tag，并由 CI 执行完整发布门禁。

## Verification

- 测试新版本、同版本重发、预发布版本、非法参数、低版本、无效 build 和字段缺失。
- 使用临时 fixture 确认只修改目标字段并验证写入失败恢复。
- 运行 release prepare 定向测试、typecheck、lint、docs:check、boundaries:check 和
  `git diff --check`。
