---
name: dsh-forge-pre-push-checks
description: 用于提交、推送、标记可审查或声称检查通过前，根据 DSH Forge 变更范围选择最小且可信的本地验证，不机械运行整个仓库，也不把未实现的平台能力当作通过。
---

# DSH Forge 提交前检查

本 skill 只选择和解释证据，不授予 commit、push、发布或删除权限。先看实际变更，再运行
能捕获该变更回归的最小检查；变更跨越多个所有权边界或用户明确要求时才扩大范围。没有
运行的检查必须明确写为未验证。

## 识别 outgoing change

开始前运行：

```sh
git status --short --branch
git rev-parse --show-toplevel
git diff --stat
git ls-files --others --exclude-standard
```

工作区中的未跟踪 README、fixture、schema 和 skill 也属于待审范围；不能只看 `git diff`
就声称变更为空。若是 PR 或指定提交，用户必须提供或允许验证基线；不要猜测远程分支、
PR base 或 stack parent。

阅读完整 diff 和足够上下文，按源目录、公共 exports、profile/catalog、运行时生命周期、
构建产物和文档链接分类。变更后如果重新生成了 `dist/` 或 `artifacts/`，验证它们的来源
和结构，但不要把生成物当作手工修改目标。

## 选择相关证据

测试选择和覆盖选择分开：运行某个 Vitest 文件只能说明该文件执行过，不能证明所有受影响
源文件、Loader、子进程或打包路径已覆盖。针对每种变更选择 owning test、真实入口和相应
门禁；不要用 `--passWithNoTests`、缩小范围或降低阈值隐藏缺口。

| 变更面 | 最小可信检查 |
|---|---|
| `.md`、README、skill、OpenSpec 或文档链接 | `pnpm run docs:check`、`git diff --check`；未跟踪文件另查尾随空格和相对链接。 |
| `packages/desktop-services` 类型、exports 或 README 示例 | `pnpm --filter @dsh-forge/desktop-services build`、`pnpm run test:desktop-services-consumer`、`pnpm run docs:check`。 |
| `packages/desktop-services-local`、generation、WAL、取消或进程树 | `pnpm --filter @dsh-forge/desktop-services-local build`、`pnpm run test:desktop-services-local`、`pnpm run boundaries:check`。 |
| `profiles/`、bundle manifest、组合或 profile 命令 | `pnpm run profile:resolve -- <profile>`、`pnpm run profile:verify -- <profile>`、`pnpm run dump-config -- <profile>`。 |
| `catalog/catalog.yml`、来源或信任逻辑 | `pnpm run catalog:verify`，并运行相关 profile resolve/verify 或 trust 测试。 |
| `schemas/`、profile-toolchain schema/parser | 工具链 build、对应 compiler/trust/release 测试、`pnpm run docs:check`。 |
| package exports、跨包依赖或目录边界 | 受影响 package build、consumer 类型检查和 `pnpm run boundaries:check`。 |
| Electron、窗口、导航、native runtime 或打包资源 | `pnpm run build`，相关运行时测试，再按平台运行 `pnpm run package:desktop -- <profile>`、`pnpm run package:inspect -- <profile>` 和 `pnpm run package:smoke -- <profile>`。 |
| acceptance、Fork 或发布门禁 | 先通过相关聚焦检查，再运行 `pnpm run acceptance` 或 `pnpm run release:gate -- <profile>`。 |

profile 范围命令必须明确记录实际选择的 profile。开发态 `--profile` 和打包时固定 profile
要分别验证；不能只验证默认 profile 就声称所有 profile 通过。修改安装事务时要覆盖非零
退出、取消、来源漂移、未知 lockfile、健康失败和人工恢复中适用的路径。

## 常用分层检查

文档或 skill 变更：

```sh
pnpm run docs:check
git diff --check
```

公开桌面 contract 变更：

```sh
pnpm --filter @dsh-forge/desktop-services build
pnpm run test:desktop-services-consumer
pnpm run boundaries:check
```

私有 provider 或运行时变更：

```sh
pnpm --filter @dsh-forge/desktop-services-local build
pnpm run test:desktop-services-local
pnpm run boundaries:check
```

跨模块变更或用户明确要求完整本地检查时：

```sh
pnpm run check:all
```

`check:all` 会包含构建、lint、测试、边界、profile、catalog 和文档门禁，可能明显超过
聚焦测试的时间；不要在每次普通 push 前机械重复。当前仓库没有 DeepSeek Harness 的
`change-scope`、`doc-sync`、coverage 100% 或 `check:pre-push` 脚本，不要在本项目凭空引用
这些命令。

## 失败处理

相关检查失败时，停止声称变更可交付：修复问题，或报告准确的命令、失败文件、平台、
环境前置条件和未覆盖范围。环境限制不能用放宽 schema、跳过边界、关闭 lint、忽略失败
退出码或未授权的 bypass 替代。

若检查启动了 Electron、pnpm、子进程或文件 watcher，确认它们已经退出并清理临时目录；
测试命令单次后台运行默认不得超过 60 秒。挂起时先定位未排空的 process、timer、promise、
generation 或 operation lease，不要简单增加超时。

## 推送和历史纪律

本 skill 不执行 `git commit`、`git push`、发布、签名、公证或删除操作，除非用户另行明确
授权。普通推送前先确认工作树、实际检查结果和未跟踪文件。需要改写远程历史时只能使用
带精确观察值的 `--force-with-lease=<branch>:<observed-oid>`，禁止裸 `--force`；改写后重新
获取远程 head 并重新审查变更范围，旧 commit hash 和评论行号不再是当前证据。

提交前检查清单：

- [ ] 未跟踪文件已纳入范围判断。
- [ ] 公开接口、profile、catalog、生成物和文档引用均已检查。
- [ ] 相关测试覆盖成功与适用的失败/取消/恢复路径。
- [ ] 真实 Loader、consumer、打包或 smoke 入口在适用时已运行。
- [ ] 未运行的平台、签名/公证、更新链路或外部 API 已明确标注。
- [ ] `docs:check`、`boundaries:check` 和 `git diff --check` 已按范围运行。
- [ ] 报告中只声明实际通过的命令，不把 CI 或用户环境假设写成本地证据。
