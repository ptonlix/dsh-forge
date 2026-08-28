## Context

`@deepseek-ai/dsh@0.1.1-rc.2` 的发布依赖闭包已将 DSH 子包 peer/dependency
范围推进到 `0.1.1-rc.2`。DSH Forge 的 `RUNTIME_MATRIX` 会严格拒绝 profile
与矩阵漂移，因此必须先同步矩阵和 profile，再重新解析依赖。

## Decisions

1. 保持精确版本 `0.1.1-rc.2`，不使用 range、tag 或浮动 Git 引用。
2. 只更新当前生产输入和测试夹具；旧 OpenSpec 变更中的 `rc.8` 是历史事实，
   不改写为当前版本。
3. 使用 pnpm 的锁文件重解析获取新的完整性摘要和 peer 后缀，并通过 profile
   resolve/verify 与受影响测试确认闭包一致。

## Compatibility note

`dsh-better-sidebar@0.14.0` 及上游部分 DSH 发布包仍在 peer 元数据中声明
`0.1.0-rc.7`/`0.1.0-rc.8` 范围。pnpm 因此会在 `0.1.1-rc.2` 主闭包旁保留少量
旧版传递 peer；这是锁文件对已发布元数据的真实解析，不手工添加 override 强制改写。
官方 profile 已通过真实 Loader 测试，后续应在第三方 bundle 发布兼容 rc.2 的版本后
单独更新其 catalog 审计事实并重新收敛闭包。

## Risks and Verification

- 上游包可能改变导出或 Loader 行为；通过构建、profile 验证、Loader 测试和工具链
  验收覆盖。
- 旧版本残留会造成混合闭包；升级后搜索生产输入并检查锁文件 importer/package
  解析结果，确认根 importer 和 profile 直接依赖没有旧 DSH 版本；传递 peer 的旧版
  解析必须与上游 package metadata 一致。
