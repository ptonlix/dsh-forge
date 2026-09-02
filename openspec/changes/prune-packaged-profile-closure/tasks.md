## 1. 裁剪 helper

- [x] 1.1 新增 `scripts/prune-packaged-profile-closure.ts`，按目标 os/arch 删除 map、pdb、demo、非许可证 Markdown，并裁剪 `node-pty` prebuilds。
- [x] 1.2 在 name+version 与 hoist 副本相同的情况下删除嵌套 `node-pty`；当前目标缺少 prebuild 时以稳定错误失败。

## 2. 打包接入

- [x] 2.1 在 `copyPackagedProfileClosure` 完成复制后、`createRuntimeManifest` 之前调用裁剪，传入本次打包目标。
- [x] 2.2 用 fixture 覆盖 darwin-arm64、darwin-universal、异版本嵌套副本、许可证保留和缺失 prebuild 失败路径。

## 3. 文档与验证

- [x] 3.1 更新工程文档，说明安装树是锁定包集合的运行时子集，不含 map、PDB、文档和异架构 prebuild。
- [x] 3.2 运行定向测试、`docs:check` 和 `git diff --check`；若本机已有打包应用则再跑 `package:inspect`，否则记录未覆盖的打包/smoke。
