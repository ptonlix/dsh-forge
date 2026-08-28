## 1. 版本输入与契约

- [x] 1.1 更新 OpenSpec、RUNTIME_MATRIX、根包和 profile-toolchain 直接 DSH 依赖。
- [x] 1.2 更新 developer/official profile 与 DSH bundle 测试夹具。

## 2. 依赖闭包与验证

- [x] 2.1 重新生成 pnpm-lock.yaml 并检查 DSH 版本解析结果。
- [x] 2.2 运行 profile resolve/verify、相关测试、typecheck/lint 与 diff 检查。
- [x] 2.3 记录实际验证结果并确认没有修改历史 OpenSpec 事实。

## 验证记录

- `pnpm install --frozen-lockfile`：通过，四个直接 DSH 包安装为 `0.1.1-rc.2`。
- `pnpm run build`：通过。
- `pnpm run profile:resolve`、`pnpm run profile:verify`：通过。
- `pnpm run catalog:verify`、`pnpm run typecheck`、`pnpm run lint`：通过。
- `pnpm exec vitest run tests/compiler.test.ts tests/profile-selection.test.ts tests/desktop-loader.test.ts`：通过，22 个测试。
- official/developer 的显式 `profile:resolve`、`profile:verify`、`dump-config`：通过。
- `pnpm run docs:check`、`pnpm run boundaries:check`：通过。
- 锁文件中的少量 `0.1.0-rc.7` 仅来自上游 peer 元数据；根 importer 与 profile 直接
  DSH 依赖均为 `0.1.1-rc.2`，未添加未审计的 override。
- `git diff --check`：通过。
- `openspec validate ...`：未执行，当前环境没有 `openspec` 命令。
