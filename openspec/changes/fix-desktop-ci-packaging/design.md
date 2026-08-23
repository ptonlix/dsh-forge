## Context

当前 `scripts/package-desktop.ts` 将 `https://npmmirror.com/mirrors/electron/` 同时用于
Electron runtime 和 node-gyp headers。该镜像的 `SHASUMS256.txt` 不包含 node-gyp 需要的
headers 文件名，导致 `remote undefined`。另外 profile compiler 的物化阶段固定使用
`--offline`，而 Actions 的 pnpm store 缓存不是完整依赖镜像。

## Decisions

1. Electron runtime 下载与 native headers 下载分离。builder 继续使用
   `ELECTRON_MIRROR`；rebuild 使用 `ELECTRON_REBUILD_DIST_URL`，默认值为
   `https://www.electronjs.org/headers`。替代镜像必须提供按版本目录组织的 headers 和
   `SHASUMS256.txt`。
2. native rebuild 每个架构使用 15 分钟预算。首次 Universal 构建允许下载、编译和 lipo
   合并，超时仍失败，不把部分 `.node` 视为成功。
3. lockfile 解析保持 offline，防止重新解析依赖；profile 物化由
   `DSH_FORGE_PROFILE_OFFLINE` 控制，默认 `true` 以保留本地可复现行为，CI 设置为 `false`
   并使用 `--prefer-offline --frozen-lockfile`，缺包时只下载锁定输入。
4. CI 的 package、validate 和 summary job 使用同一 profile 安装策略，并在 workflow 中
   明确 headers URL；package 矩阵总预算为 90 分钟，不向 PR 注入签名凭据。

## Risks

- 官方 headers 服务不可达时，构建会失败；可通过同样提供 SHASUMS 的镜像覆盖环境变量。
- CI 允许补下载会增加首次运行时间，但避免把不完整缓存误判为依赖或代码错误。
