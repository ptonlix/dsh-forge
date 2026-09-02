## 1. 版本输入与契约

- [x] 1.1 更新 OpenSpec、RUNTIME_MATRIX、profile、直接 DSH/Cordis 依赖和测试夹具。
- [x] 1.2 将官方外部 bundle 与 catalog 更新为 `dsh-better-sidebar@0.18.0-alpha.0`、
      `dsh-dream-skin@8.30.1`。

## 2. 依赖闭包与验证

- [x] 2.1 重新生成 pnpm-lock.yaml，确认根 importer 直接 DSH/Cordis/插件版本。
- [x] 2.2 运行 catalog/profile 校验、相关测试、typecheck/lint、docs/boundaries 与
      当前平台 package smoke。
- [x] 2.3 按实际验证结果填写 catalog `verifiedOn`/`verifiedAt`，并记录未覆盖平台。
