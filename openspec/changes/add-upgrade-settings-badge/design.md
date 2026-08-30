## Context

现有 `UpgradeCoordinator` 已在 generation 就绪后静默检查并保存 `UpgradeManagerStatus`；`desktop-layer` 通过固定的 `upgradeManager/status`、`check` 和 `startUpgrade` Remote 渲染升级管理设置页。设置外壳的 `settings.trigger` 是 single slot，默认由上游设置包注册，slot registry 支持使用不同 priority 进行受控 shadow。

## Goals / Non-Goals

**Goals:**

- 在设置齿轮入口显示可用版本的橙色被动提示。
- 只读取现有状态 Remote，不引入 renderer 直连网络或 Electron 能力。
- 复用现有升级页和原生确认流程，保证取消、失败和关闭语义不变。
- 清理入口组件的轮询和迟到结果。

**Non-Goals:**

- 不实现静默下载、自动安装、启动弹窗或差分更新。
- 不修改 `UpgradeCoordinator` 的 12 小时调度和 OTA provider。
- 不在外层设置按钮内嵌第二个 button；本次不改变上游设置 shell 的公开契约。

## Decisions

1. **使用 `settings.trigger` 的低 priority shadow。** 当前 trigger 为 single slot，直接以相同 priority 注册会失败；使用明确的较低 priority 复用 slot registry 的 shadow 语义，同时保留设置外壳的外层按钮和打开行为。自定义 trigger 复制上游图标/本地化文字，并在尾部增加提示元素。
2. **入口只轮询本地 `status()`。** 当前 Remote 没有推送订阅协议；入口挂载读取一次并以 30 秒间隔刷新，窗口交互时可再次刷新。`status()` 只读取主进程快照，不会重复请求 `version.json`。轮询回调使用活动标志，卸载后丢弃迟到结果。
3. **升级动作仍由升级管理页完成。** 入口提示本身不嵌套交互控件，避免违反外层 button 的无障碍语义；用户进入设置后使用已有“立即升级”按钮，主进程仍负责复查和原生确认。
4. **共享提示状态规则。** 仅 `phase === 'available'` 显示橙色提示；其余状态隐藏。提示包含可访问名称“发现新版本”，不包含 URL、文件路径或命令。
5. **导航项使用受控 DOM 标记同步提示。** 当前 `settings.section` 的公开 `label` 投影为字符串，不能携带 React 子节点；因此 desktop layer 仅在设置对话框内按稳定的“升级管理”文案查找导航按钮，使用自有 data 属性驱动固定图标和条件提示点，并通过 `MutationObserver` 覆盖导航延迟挂载和重绘。该标记只拥有本插件自己的属性，不修改导航点击逻辑。
6. **导航项图标使用更新语义的 CSS 替换。** 上游设置外壳对未知 section id 固定渲染通用齿轮，且 `settings.section` 没有图标字段；desktop layer 在同一自有标记下隐藏该齿轮，以 currentColor 绘制 16px 更新/刷新图标，保持默认、悬停和选中颜色继承。

## Risks / Trade-offs

- [状态刷新最多延迟 30 秒] → 在入口挂载和窗口交互时立即读取；不增加新的 Remote 协议。
- [shadow 依赖上游 single slot priority 语义] → 固定 priority、增加 slot 注册测试，并在上游 slot 契约变化时让测试失败。
- [入口与设置页各自读取状态] → 两者均为只读快照；不复制候选、URL 或安装状态，升级操作仍以主进程为唯一事实源。
- [导航 DOM 结构变化] → 选择器限定在设置对话框的 `nav button`，并以文案精确匹配；当上游公开契约提供正式导航 badge 后，应迁移到正式字段并删除该适配。
- [上游新增正式图标字段] → 当前 CSS 替换仅是对已知 fallback 齿轮的兼容层；契约提供图标入口后，应迁移到正式字段并删除伪元素替换。
- [用户希望单击提示直接升级] → 本次保持安全的两步路径；若以后需要单击直升，应先为设置 shell 增加正式 action/openSection 契约，不能嵌套按钮或使用 DOM hack。
