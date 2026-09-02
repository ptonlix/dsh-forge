## Context

`@deepseek-ai/dsh@0.1.2-alpha.4` 的发布依赖闭包将 DSH 子包推进到同一预发布版本，
并将 Cordis 依赖范围推进到 `^4.0.2`。`RUNTIME_MATRIX` 会拒绝 profile 与矩阵漂移，
因此必须同时更新 DSH 与 Cordis 精确版本后再重解析锁文件。

官方 profile 已选择 `dsh-better-sidebar` 与 `dsh-dream-skin`。sidebar 的 latest 仍是
`0.17.1`，但该版本从 `@deepseek-ai/dsh-settings` 导入 `settingsNamespace`，与
`0.1.2-alpha.4` 的导出不兼容。匹配该 runtime 的已发布版本是
`dsh-better-sidebar@0.18.0-alpha.0`。dream-skin latest 为 `8.30.1`。两者仍声明
`dsh.bundle.patch`，npm lifecycle scripts 为空，Cordis peer 为 `^4.0.1`。

## Decisions

1. 使用 npm 已发布的精确版本 `0.1.2-alpha.4`，不使用 `alpha` tag、范围版本或本地
   Git 路径。npm `latest` 仍指向 `0.1.1-rc.2` 不影响本次固定。
2. Cordis 必须升到精确 `4.0.2`。desktop-layer、desktop-services 与
   desktop-services-local 的 Cordis 声明改为同一精确版本，避免 `PEER_MISMATCH`。
   `@deepseek-ai/dsh-client-runtime` 在 `0.1.2-alpha.4` 不再发布；desktop-layer 的
   client inject/peer 改为 `@deepseek-ai/dsh-client-modules@^0.1.2-alpha.4`。缺失的
   inject 包在上游 client-modules 图中会被跳过，因此第三方 bundle 仍声明旧
   `dsh-client-runtime` inject 时不得因此阻断编译。官方 agent preset 随
   `@deepseek-ai/dsh-agent-presets` 的 `presets/` 交付，启动器不再从
   `@deepseek-ai/dsh/config/agent-presets` 读取。
3. 官方外部 bundle 使用 `dsh-better-sidebar@0.18.0-alpha.0` 与
   `dsh-dream-skin@8.30.1`。sidebar 不使用 latest `0.17.1`，因为 Host 无法加载。
4. catalog 按锁文件实际 integrity 更新来源事实；`verifiedOn` 只写本次实际验证平台。
   sidebar 新增 runtime 依赖 `dompurify`、`react-icons`、`@codemirror/lang-vue`。
   dream-skin 仍无 runtime dependency，但新增 peer `@deepseek-ai/dsh-client-store`。
5. 不改写历史 OpenSpec 中的旧版本事实。developer profile 必须同步 runtime 矩阵，
   但不新增这两个外部 bundle。
6. pnpm 11.7 默认 `minimumReleaseAge` 约一天。`0.1.2-alpha.4` 发布未满该窗口时，
   根工作区用 `minimumReleaseAgeExclude` 列出这些 `@deepseek-ai/dsh*` 精确版本。
   profile 编译使用 `--ignore-workspace` 且产物目录不继承该 exclude，因此
   `runPnpm` 固定附加 `--config.minimum-release-age=0`，只作用于已审核锁文件的
   编译/物化，不关闭开发者直接执行的根 `pnpm install` 策略。

## Compatibility note

第三方 bundle 的 DSH peer 元数据仍多为 `^0.1.0-rc.8` 或 `^0.1.0-rc.6`。compiler
使用 `includePrerelease` 比较，因此 `0.1.2-alpha.4` 可以通过 peer 检查。pnpm 默认
不会把这些范围解析到预发布版本，会把 `dsh-attachment`、`dsh-settings`、`dsh-sandbox`
等协议包留在 `0.1.1-rc.2` / `0.1.0-rc.7`，Host 启动时出现跨版本 named export 失败。
根 `pnpm-workspace.yaml` 用精确 `overrides` 把这些包钉到 `0.1.2-alpha.4`，只覆盖实际
漂移的协议包，不使用通配 override。profile 产物不是工作区：投影 lockfile 时删除
`overrides` 指纹，避免 `--ignore-workspace` 的 frozen install 因配置不匹配失败。

`dsh-better-sidebar@0.18.0-alpha.0` 的“添加插件”界面只把安装命令复制到剪贴板，并打开仓库
链接；它不是 Forge 页面端插件市场，也不改变当前发行包禁止运行时安装的边界。

## Risks and Verification

- 上游导出、Loader 或 desktop layer peer 可能变化；通过 profile resolve/verify、
  Loader 测试、typecheck/lint 和当前平台 `package:desktop`/`package:inspect`/
  `package:smoke` 覆盖。
- sidebar 继续依赖 `node-pty`；现有 `allowBuilds.node-pty: true` 保持不变。
- 未运行的其他 OS/架构不得写入 catalog `verifiedOn`，也不得称为已通过。本次实际验证为
  `darwin-arm64`（`2026-09-02`）。未覆盖：`darwin-x64`、`win32-*`、`linux-*`。
- `0.1.2-alpha.4` 的 `session_projcache` 新增 `identity.isSeeded` 与
  `inheritedEventCount`。旧缓存会使 Host 无法加载；启动器在该 schema 失败时把
  `storages/session_projcache` 移出运行路径并重试一次。死进程留下的
  `.credentials.yaml.lock` 会阻塞 30s，必须在 boot 前按 PID 存活状态拒绝或清理。
- `dsh-client-connection` 要求根页面携带 process launch `token`。窗口不得再加载
  无 query 的 `http://127.0.0.1:<port>/`，否则 401 明文
  `dsh web authentication required`。
