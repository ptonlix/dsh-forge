import type { DesktopPnpm, DesktopProfiles } from './contracts/index.ts';

/**
 * 运行时插件只接收 launcher 注入的私有 capability，再公开稳定桌面服务。
 * Electron 和 Node 运行时细节不会穿过这个边界。
 * capability 缺失时启动立即失败，不允许插件自行创建替代服务。
 */
interface PluginCapability {
  readonly desktopProfiles: DesktopProfiles;
  readonly desktopPnpm: DesktopPnpm;
}

interface PluginContext {
  readonly dshForgeDesktopCapability?: PluginCapability;
  provide(name: string, value: unknown): void;
}

interface DesktopServiceInstaller {
  (ctx: PluginContext): void;
  inject: readonly ['dshForgeDesktopCapability'];
}

const installDesktopServices: DesktopServiceInstaller = (ctx) => {
  const capability = ctx.dshForgeDesktopCapability;
  if (!capability || !capability.desktopProfiles || !capability.desktopPnpm) {
    throw new Error('dsh-forge desktop capability 不可用');
  }
  ctx.provide('desktopProfiles', capability.desktopProfiles);
  ctx.provide('desktopPnpm', capability.desktopPnpm);
  ctx.provide('desktopServices', Object.freeze({ protocol: 1, executionMode: 'trusted-in-process' }));
};

installDesktopServices.inject = ['dshForgeDesktopCapability'];

export default installDesktopServices;

/** launcher 使用的 provider 工厂；第三方插件仍只依赖 contracts 子路径。 */
export {
  createDesktopServices,
  DesktopPnpmProvider,
  DesktopProfilesProvider,
  recoverTransactions,
  restoreProfile,
  snapshotProfile,
} from './host/desktop-services.ts';
export type {
  DesktopServiceOptions,
  DesktopOperationOptions,
  PluginInstallationRequest,
  ProfileSnapshot,
  RecoveryFact,
} from './host/desktop-services.ts';
