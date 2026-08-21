import type { Context } from '@deepseek-ai/cordis';
import {
  DESKTOP_SERVICES_PROTOCOL,
  assertDesktopServicesProtocol,
  createDesktopProfileSnapshot,
  desktopServiceNames,
  type DesktopPnpmCommand,
} from '@dsh-forge/desktop-services';

const command: DesktopPnpmCommand = { kind: 'inspect', query: 'list', depth: 0 };
const snapshot = createDesktopProfileSnapshot(null, []);

export function consumeDesktopServices(ctx: Context): readonly string[] {
  assertDesktopServicesProtocol(ctx.desktopServices, DESKTOP_SERVICES_PROTOCOL);
  void ctx.desktopPnpm.run(command).done;
  return [desktopServiceNames.profiles, snapshot.protocol.toString()];
}
