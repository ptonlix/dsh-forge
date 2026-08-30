# @dsh-forge/desktop-services-local

中文 | [English](README.md)

`@dsh-forge/desktop-services` 的私有 Cordis provider。它把 launcher 已验证的
`dshForgeDesktopCapability` 转换为当前 generation 的 `desktopProfiles`、`desktopPnpm`
和 `desktopServices`，并负责受管 pnpm operation、安装事务、来源复核、健康检查和
恢复事实。

这是一个**内部实现包**，不是第三方插件扩展点。只有以下两个位置可以使用它：

- `@dsh-forge/desktop-layer` 通过根入口加载默认 provider；
- `apps/desktop` 通过 `@dsh-forge/desktop-services-local/launcher` 创建 capability。

其他 bundle、feature、generator、Fork、测试 fixture 和普通 DSH 插件都不得导入本包。

第三方只应依赖 [`@dsh-forge/desktop-services`](../desktop-services/README.zh.md)。

## 导出与加载边界

| 导出 | 使用者 | 作用 |
|---|---|---|
| 默认导出 | desktop layer | 注册当前 generation 的三个公开 desktop service。 |
| `./launcher` | `apps/desktop` | 创建冻结的 launcher capability；不导出给业务 bundle。 |

根入口不是 standalone provider：它需要 Cordis Context 中已有
`dshForgeDesktopCapability`。缺少 capability 时不会伪造 profile、package 或 descriptor
service；正常的加载路径由 desktop layer 的 `cordis.patch.yml` 负责。

```yaml
- insert:
    - id: dsh-forge-desktop-services
      name: '@dsh-forge/desktop-services-local'
```

`apps/desktop` 创建 capability 后再加载该 provider：

```ts
import { Context } from '@deepseek-ai/cordis';
import localProvider from '@dsh-forge/desktop-services-local';
import { createDesktopHostCapability } from '@dsh-forge/desktop-services-local/launcher';

const generation = {
  id: 'generation-id',
  profile: 'dsh-forge-official',
  stage: 'prepared',
  closed: false,
};

const capability = createDesktopHostCapability({
  generation,
  profileDir: '/absolute/path/to/profile',
  profiles: [],
  manager: { select: async () => generation },
  catalog: [],
  reconcile: async () => {},
  verifyNextGeneration: async () => true,
});

const ctx = new Context();
ctx.provide('dshForgeDesktopCapability', capability);
await ctx.plugin(localProvider);
```

示例中的绝对路径、profile 摘要、catalog、manager 和生命周期 hook 必须由 launcher
使用真实已验证事实填充；业务插件不能自行构造 capability。

## Launcher capability

`createDesktopHostCapability(options)` 会复制并冻结 launcher 交给 provider 的事实，避免
provider 或第三方代码反向修改 launcher 状态。

| 字段 | 必填 | 含义 |
|---|---:|---|
| `generation` | 是 | `{ id, profile, stage, closed }`；所有 service 和 operation 的生命周期边界。 |
| `profileDir` | 是 | 当前受管 profile 的绝对目录，必须已存在。pnpm 的 cwd 固定为此目录。 |
| `profiles` | 是 | launcher 已解析的只读 profile 摘要列表。 |
| `manager` | 是 | 提供 `select(profile)` 的 generation 管理器；provider 不直接访问 state store。 |
| `catalog` | 是 | 当前 generation 使用的静态 catalog 快照。安装确认只能绑定此快照。 |
| `reconcile` | 是 | pnpm 成功后刷新受管 profile 的解析事实。 |
| `verifyNextGeneration` | 是 | receipt 提交前验证下一 generation 是否健康。返回 `false` 会进入人工恢复。 |
| `pnpm` | 否 | pnpm 可执行文件；默认 `pnpm`。 |
| `pnpmArgs` / `pnpmEnv` | 否 | launcher 维护的固定参数和环境；消费者不能覆盖。 |
| `transactionDir` | 否 | WAL 目录；默认是 `<profileDir>/.recovery`。 |
| `spawn` | 否 | 测试或宿主提供的进程树启动器；生产默认使用受管 `spawnTree`。 |
| `initializeProfile` | 否 | 启动 package operation 前初始化 profile 的 hook。 |
| `upgradeManager` | 否 | 当前 generation 的升级协调器；未注入时为不可用快照，仅由 desktop layer 使用。 |

`createDesktopHostCapability()` 只负责冻结和转交事实，不验证 catalog 业务正确性，也不
改变 generation；profile、来源和平台验证由 launcher 与 profile-toolchain 在更早阶段完成。

## Provider service

### 注册与释放

provider 在同一个 Cordis generation 内发布：

- `desktopProfiles`：由 `DesktopProfilesProvider` 持有 generation、manager 和只读 profile 摘要；
- `desktopPnpm`：由 `DesktopPnpmProvider` 持有 profile 目录、catalog、进程 lease 和恢复状态；
- `desktopServices`：协议 `1`、执行模式 `trusted-in-process` 及三个 service 名称的冻结 descriptor。
- `upgradeManager`：私有 Typert Remote gateway，仅暴露 `status`、`check`、`startUpgrade` 三个无参数方法。

fiber 卸载时，provider 先将 package service 标记为关闭，取消受管进程树，等待当前
operation 的 `done` 完整结算，再移除 service。已关闭 generation 的旧引用不能访问或
改变新 generation。

profile service 的公开方法、只读快照和 `select()` 语义见
[`@dsh-forge/desktop-services` README](../desktop-services/README.zh.md#service)。
本包只负责把 launcher 的真实 manager 接到该 contract，不在 provider 内实现第二套
profile 状态机。

## Package operation

所有 pnpm 调用都从 `profileDir` 启动，并由一个 generation 级 lease 串行化。provider
不接受原始参数数组；公开 command 会被转换为固定参数：

| 公共 command | 固定 pnpm 参数 | 成功后的动作 |
|---|---|---|
| `inspect/list` | `list [--depth=N] --filter ./` | 只读，不执行 reconcile。 |
| `inspect/why` | `why <package> [--depth=N] --filter ./` | 只读，不执行 reconcile。 |
| `reconcile` | `install --lockfile-only --ignore-scripts --filter ./` | 成功后调用 `reconcile()`。 |
| `remove` | `remove --ignore-scripts <package> --filter ./` | 成功后调用 `reconcile()`。 |
| `install` | `add --save-exact --ignore-scripts <spec> [--registry=...] --config.allowBuilds=... --filter ./` | 成功后执行 reconcile、lockfile 来源复核、下一 generation 健康检查和 receipt 提交。 |

`inspect.depth` 只能是 `0..20` 的整数；`why` 必须提供 package 名称；所有 package
名称和精确版本都会在启动子进程前校验。operation 运行时，第二个 operation 以
`PACKAGE_BUSY` 失败；取消 signal 会在启动前以 `PACKAGE_CANCELLED` 失败。

## 安装确认与来源复核

`install()` 只接受带运行时 brand、深度冻结且绑定当前 generation profile 的
`ConfirmedPluginInstall`。provider 会重新读取当前静态 catalog，逐项比较 package 名称、
精确版本、来源和 integrity，不能信任调用方自行修改的展示对象。

支持的来源：

- **registry**：使用 catalog 的 HTTPS registry、tarball 和 integrity；lockfile 必须保留
  相同 tarball 与 integrity。
- **git**：使用 catalog 的 repository 和完整 40 位 commit；lockfile 必须保留相同仓库和
  commit，禁止 branch、tag、`main` 或 `latest`。
- **workspace**：可以进入 catalog 和构建 profile，但明确拒绝动态安装。

构建脚本只来自 request 的 `allowBuilds` 白名单，并作为 pnpm `allowBuilds` 配置传入；
provider 默认仍使用 `--ignore-scripts`。catalog 确认是来源和审核事实的绑定，不是对
Node/Electron 代码的安全隔离。

## 安装事务与恢复

安装事务使用 `<transactionDir>/install-*.json` WAL。一次安装的结算顺序是：

1. 占用 generation lease，校验 signal、generation、确认 brand 和 catalog。
2. 对 `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml` 保存写前快照并写入 WAL。
3. 在受管 profile 目录启动 pnpm，并把 stdout、stderr 和取消句柄暴露给 operation。
4. 进程非零退出、信号终止或取消时恢复受保护文件，写入 `.failed` 记录并结束事务。
5. 进程成功时执行 `reconcile()`，从实际 lockfile 验证 package 来源和完整性。
6. 启动下一 generation 做健康检查；通过后写入 `.receipt` 并删除 WAL。

reconcile、lockfile 解析或健康检查失败时，provider 会恢复受保护文件，写入
`.manual-recovery`，将状态标记为人工恢复，并以 `INSTALL_MANUAL_RECOVERY` 拒绝后续
package operation，直到 launcher 重新建立可验证 profile。WAL 只保护上述三个声明和
lockfile 文件，**不承诺回滚 `node_modules`**；恢复事实会明确要求人工检查。

进程结束不等于 operation 结束：`done` 还会等待 reconcile、来源复核、健康检查和
receipt/恢复完成。dispose 同样等待这一完整结算，避免旧 generation 的延迟回调写入
新 generation。

## 错误与生命周期边界

provider 使用 profile-toolchain 的 `ForgeError`，调用方应按稳定 code 分支，而不是匹配
错误文案。常见 code 包括：

| Code | 触发条件 |
|---|---|
| `SERVICE_CWD` | `profileDir` 不是绝对路径或目录不存在。 |
| `SERVICE_ARGUMENT` | profile 名称、package 名称或 inspect depth 无效。 |
| `GENERATION_CLOSED` | provider 或 generation 已关闭。 |
| `PACKAGE_BUSY` | 当前 generation 已有 operation。 |
| `PACKAGE_CANCELLED` | operation 在启动前已被取消。 |
| `CATALOG_CONFIRMATION_REQUIRED` | 安装请求未冻结、未确认或不匹配 catalog。 |
| `CATALOG_PROFILE_MISMATCH` | 请求绑定了其他 profile。 |
| `CATALOG_INSTALL_SOURCE` | 来源类型不支持或 workspace 被用于动态安装。 |
| `INSTALL_SOURCE_DRIFT` | lockfile 来源或完整性与确认事实不一致。 |
| `INSTALL_LOCKFILE_UNKNOWN` | lockfile 缺失、格式未知或没有目标 package。 |
| `INSTALL_MANUAL_RECOVERY` | 安装后 reconcile、来源复核或健康检查无法证明 profile 可用。 |

`dispose()` 会关闭 provider、取消当前 operation 并等待其 `done`；它不会伪造成功结果，
也不会删除人工恢复记录。

## 模型体验

无直接模型影响。该 provider 只注册桌面 service 和受管 package operation，不注册 prompt、
tool、session event 或模型可见文本。若上层插件将 package 输出或 profile 摘要展示给模型，
应由上层 README 单独说明内容来源和 token 行为。

#### KV Cache 影响

无直接影响；任何模型请求前缀变化都由上层消费方负责。

## 完整安装包 OTA

`./launcher` 还仅向 `apps/desktop` 提供 `createFullPackageUpdater()`。它读取固定的 GitHub
Release 资产
`https://github.com/ptonlix/dsh-forge/releases/latest/download/version.json`，严格校验完整的
`windows`、`macos`、`ubuntu` 条目，先比较精确 SemVer 再比较正整数 `build`，并在用户确认后将
完整安装包下载到 `<userData>/dsh-forge/ota` 下的唯一受控文件名。应用传入
`app.getVersion()` 和随包 `package.json` 的 `dshForgeBuild`；本地 build 缺失或无效只会拒绝检查，
不会改变当前 generation。

Windows 使用 `.exe`，macOS 使用 `.dmg`。Linux 仅在 `/etc/os-release` 为 Ubuntu 22.04 及以上，
且 `APPIMAGE` 是可写的绝对常规文件时使用 AppImage 条目。更新器不显示 Electron UI、不退出进程，
也不执行安装器；`apps/desktop` 持有原生确认，并在用户确认且下载文件已关闭后交给平台 helper。

generation 就绪后，`apps/desktop` 创建的 `UpgradeCoordinator` 会静默检查一次，并在每次结算后
12 小时再检查；检查不会弹出确认或下载。`@dsh-forge/desktop-layer` 通过固定的
`upgradeManager/status`、`upgradeManager/check` 和 `upgradeManager/startUpgrade` 无参数 Typert
Remote 注册“升级管理”设置页，并在设置入口发现可用版本时显示非阻塞的橙色提示。页面只显示版本、
build、检查时间、状态和可用版本；“立即升级”会在主进程重新检查仍有更新后才显示原生确认。设置
入口提示只引导用户进入该页面，不会在外层按钮中嵌套直接升级控件。设置面板打开后，“升级管理”
导航项也会显示同一枚橙色提示，帮助用户定位目标页面。generation 释放时会取消检查/下载并清理调度器。
该导航项还会使用独立的更新/刷新图标替代通用设置齿轮，同时保留设置外壳的状态颜色和点击行为。

这不是公开 desktop service 或第三方扩展 API。清单和完整安装包刻意不校验摘要、清单签名或运行时
信任根；本流程仅依赖 HTTPS、用户确认以及 macOS 系统签名/公证。下载取消、失败或 generation 关闭时，
会删除未完成的暂存文件。

## 已知限制与暂缓事项

- **私有 provider，不是扩展点**：第三方 bundle 不能依赖本包；其 API 只服务 launcher 和 desktop layer。
- **当前没有页面端安装流程**：`install()` 是受控底层能力，首版发行包不提供插件目录、确认 UI 或在线下载入口。
- **单 generation 单 operation**：同一 generation 不支持并行 reconcile、remove 或 install；必须等待上一 operation 完整结算。
- **不回滚 node_modules**：失败恢复只覆盖声明文件和 lockfile，node_modules 状态必须通过下一 generation 验证或人工检查确认。
- **不提供跨版本迁移**：WAL、receipt 和恢复记录使用当前 schema；格式变化需要独立迁移设计。
- **执行模式不是隔离边界**：`trusted-in-process` 下的 Node 插件仍与 Host 共用进程权限。
- **不校验安装包完整性**：完整安装包 OTA 只校验 HTTPS URL 形状，不校验安装包摘要或签名清单。
- **Linux 仅支持 AppImage**：发行版只生成 Ubuntu AppImage；非 Ubuntu Linux、不可写 `APPIMAGE` 和其他分发方式不支持 OTA。

## 维护验证

```sh
pnpm --filter @dsh-forge/desktop-services-local build
pnpm run test:desktop-services-local
pnpm run boundaries:check
```

公开 contract 的消费方类型检查使用：

```sh
pnpm run test:desktop-services-consumer
```

真实加载、service teardown、generation 失效、WAL、来源漂移、健康失败和受管进程取消
覆盖在 `tests/desktop-loader.test.ts` 与 `tests/runtime-services.test.ts`。OTA 版本、暂存下载、
取消、平台条件与 helper 回滚覆盖在 `tests/full-package-ota.test.ts` 和
`tests/desktop-upgrade-helper.test.ts`。
