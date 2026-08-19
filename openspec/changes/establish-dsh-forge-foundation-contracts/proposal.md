## Why

现有设计已经确定 Electron、DSH Host、bundle、profile 与 Fork 发行版的总体边界，但 profile 事实来源、Cordis 组合语义、同进程插件信任、generation 恢复、可恢复安装以及发布运行时闭包仍缺少可执行契约。若直接实施，团队会在安全保证、配置所有权和失败恢复上形成互不兼容的实现，因此需要先把首版行为拆成可验证的规范。

## What Changes

- 定义版本化的 `distribution.yml`，使应用身份、默认 profile、支持平台和更新配置拥有唯一源文件及失败规则。
- 定义版本化的 `profile.yml` 编译流程，明确源文件、生成文件、锁文件、bundle 与插件依赖之间的映射，并与上游 DSH `package.json` profile 格式衔接。
- 将 patch 覆盖优先级与 Cordis 插件激活依赖分开，禁止把 bundle 列表顺序描述为运行时激活顺序。
- 定义 generation 启动、健康确认、提交、失败、重试和 last-known-good 回滚状态机，并覆盖 renderer 最终启动结果和崩溃恢复。
- 收紧 `desktopProfiles` 与 `desktopPnpm` 公共契约，定义并发、取消、进程树退出、过期 service、可恢复安装和安装后重启验证。
- 将第三方 Node 插件明确标记为 `trusted-in-process`，把兼容性声明、用户授权、审计事实和技术隔离分开；首版不宣称阻止同进程代码访问 Node 或 Electron。
- 定义打包运行时闭包、原生依赖、Electron ABI、平台签名、更新信任根、降级防护和真实安装包验证要求。
- 把插件市场、运行时动态目录、高级桌面布局、Tauri 宿主和独立插件进程留在本变更之外；首版只交付兼容模式和静态审定组合。

## Capabilities

### New Capabilities

- `distribution-identity`: 发行版身份、品牌、默认 profile、平台目标和更新入口的版本化源文件及验证规则。
- `profile-compilation`: `profile.yml` 到上游 DSH profile、依赖锁和构建清单的确定性编译与事实来源约束。
- `composition-semantics`: bundle patch、profile patch、home patch 和 launcher overlay 的覆盖优先级，以及 Cordis 激活依赖规则。
- `desktop-generation-lifecycle`: Electron、Host、renderer、profile 选择与 last-known-good 恢复的 generation 状态机。
- `desktop-plugin-services`: `desktopProfiles`、`desktopPnpm` 和可恢复插件安装的公开类型、时序、取消与失败契约。
- `plugin-trust-policy`: 同进程插件的兼容性、授权、审计、来源和明确非隔离安全声明。
- `packaged-runtime-release`: Electron 运行时闭包、原生依赖、跨平台产物、签名更新和发布验证要求。

### Modified Capabilities

无。仓库当前没有已发布的 OpenSpec capability。

## Impact

- 规划中的 `distribution.yml`、`profiles/*/profile.yml`、profile 编译器、bundle 包和 catalog schema 将受这些规范约束。
- 规划中的 Electron bootstrap、desktop plugin、profile 状态存储、package-manager provider、启动恢复和更新器需要按状态机实现。
- `desktopProfiles` 与 `desktopPnpm` 将成为版本化公共 API；`desktopRuntime` 和 launcher bootstrap facts 保持内部接口。
- 构建系统需要固定 DSH package family、Cordis peer、Electron、pnpm、Node ABI 和平台目标，并生成 resolved manifest、SBOM 与许可证通知。
- 测试需要覆盖结构化配置断言、真实 Loader、renderer boot report、安装恢复、打包运行时闭包以及 macOS/Windows 原生产物验证。
