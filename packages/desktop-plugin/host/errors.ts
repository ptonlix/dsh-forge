/** host provider 与工具链共享同一错误构造函数，保证跨包 instanceof 稳定。 */
export { ForgeError, fail } from '@dsh-forge/profile-toolchain/core/errors';
