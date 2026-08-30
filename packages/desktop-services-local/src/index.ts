import type { Context } from '@deepseek-ai/cordis';
import { DESKTOP_SERVICES_PROTOCOL, desktopServiceNames, type DesktopServicesDescriptor } from '@dsh-forge/desktop-services';
import { fail } from './errors.ts';
import { DesktopPnpmProvider } from './packages.ts';
import { DesktopProfilesProvider } from './profiles.ts';
import { UpgradeManagerGateway } from './upgrade-manager-remote.ts';
import type { DesktopHostCapability } from './types.ts';

declare module '@deepseek-ai/cordis' {
  interface Context {
    dshForgeDesktopCapability: DesktopHostCapability;
  }
}

/** desktop layer 加载的私有 Cordis provider；服务生命周期归当前 fiber 所有。 */
function installDesktopServices(ctx: Context): void {
  const capability = ctx.dshForgeDesktopCapability;
  if (!capability) fail('desktop launcher capability 不可用', 'SERVICE_CONFIG');
  const profiles = new DesktopProfilesProvider(capability.generation, capability.manager, capability.profiles);
  const pnpm = new DesktopPnpmProvider(capability);
  new UpgradeManagerGateway(ctx);
  const descriptor: DesktopServicesDescriptor = Object.freeze({
    protocol: DESKTOP_SERVICES_PROTOCOL,
    executionMode: 'trusted-in-process',
    services: [desktopServiceNames.profiles, desktopServiceNames.pnpm, desktopServiceNames.descriptor] as const,
  });
  ctx.provide(desktopServiceNames.profiles, profiles);
  ctx.provide(desktopServiceNames.pnpm, pnpm);
  ctx.provide(desktopServiceNames.descriptor, descriptor);
  ctx.effect(async () => async () => {
    await pnpm.dispose();
  }, 'desktop-services-local.dispose');
}

installDesktopServices.inject = ['dshForgeDesktopCapability'];

export default installDesktopServices;
