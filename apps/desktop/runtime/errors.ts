/** Electron runtime 与工具链共享同一错误构造函数，避免跨包类型身份分裂。 */
export { ForgeError, fail } from '@dsh-forge/profile-toolchain/core/errors';
