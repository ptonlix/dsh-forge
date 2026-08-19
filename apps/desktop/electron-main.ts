import * as path from 'node:path';
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { assertNoStartupInstall, loadStaticCatalog } from '../../src/trust/catalog.ts';
import { parseDistribution } from '../../src/core/schema.ts';
import { errorMessage } from '../../src/types.ts';
import {
  createDesktopLauncher,
  createElectronWindowFactory,
  ensureOfficialProfile,
  listProfiles,
  probeLoopback,
  startDshHost,
} from './main.ts';

/** Electron 应用入口：只负责应用就绪、静态 catalog 检查、launcher 创建和信号退出。 */

/** 解析打包应用的 resourcesPath；开发模式不应进入该路径。 */
function packagedResourcePath(...segments: readonly string[]): string {
  const resourcesPath = (process as NodeJS.Process & { readonly resourcesPath?: string }).resourcesPath;
  if (!resourcesPath) throw new Error('Electron resourcesPath 不可用');
  return path.join(resourcesPath, ...segments);
}

/** 启动桌面应用；smoke 模式会在成功握手后主动退出，避免测试进程常驻。 */
export async function startElectron() {
  if (process.env.DSH_FORGE_SMOKE_USER_DATA)
    app.setPath('userData', path.resolve(process.env.DSH_FORGE_SMOKE_USER_DATA));
  await app.whenReady();
  const root = app.getAppPath();
  assertNoStartupInstall(loadStaticCatalog(path.join(root, 'catalog', 'catalog.yml')));
  const runtimeRoot = app.isPackaged ? packagedResourcePath('dsh-forge', 'runtime') : root;
  const home = path.join(app.getPath('userData'), 'dsh-home');
  const template = app.isPackaged ? packagedResourcePath('dsh-forge', 'profile') : null;
  const distribution = parseDistribution(path.join(root, 'distribution.yml'));
  ensureOfficialProfile({ root, home, profileTemplate: template, profileName: distribution.defaultProfile });
  const profiles = listProfiles(home, distribution.defaultProfile);
  if (!profiles.some((profile) => profile.selectable)) throw new Error('没有可启动的 desktop profile');
  process.env.DSH_HOME = home;
  let quitting = false;
  const windowFactory = createElectronWindowFactory({
    BrowserWindow,
    ipcMain,
    preload: path.join(__dirname, 'preload.js'),
    deadlineMs: 15_000,
    onClose: (event) => {
      if (quitting) return;
      event.preventDefault();
      void launcher?.hide();
    },
  });
  const launcher = createDesktopLauncher({
    userData: app.getPath('userData'),
    profiles,
    deadlineMs: 15_000,
    probe: (url) => probeLoopback(url, 15_000),
    windowFactory,
    host: { start: (options) => startDshHost({ root, home, runtimeRoot, ...options }) },
    pnpm: process.execPath,
    pnpmArgs: [path.join(runtimeRoot, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs')],
    pnpmEnv: { ELECTRON_RUN_AS_NODE: '1' },
  });
  const requestExit = async (reason: string): Promise<void> => {
    if (quitting) return;
    quitting = true;
    try {
      await launcher.signal(reason);
    } finally {
      app.exit(0);
    }
  };
  app.on('activate', () => launcher?.show());
  app.on('before-quit', (event) => {
    if (quitting) return;
    event.preventDefault();
    void requestExit('explicit-exit');
  });
  process.once('SIGTERM', () => void requestExit('SIGTERM'));
  process.once('SIGINT', () => void requestExit('SIGINT'));
  await launcher.start();
  if (process.argv.includes('--dsh-forge-smoke')) setTimeout(() => void requestExit('smoke-exit'), 1_000);
  return { launcher, requestExit };
}

if (require.main === module) {
  startElectron().catch((error: unknown) => {
    const diagnostic = error instanceof Error && error.stack ? error.stack : errorMessage(error);
    if (process.argv.includes('--dsh-forge-smoke')) {
      process.stderr.write(`${diagnostic}\n`);
      app.exit(1);
    } else {
      dialog.showErrorBox('DSH Forge 启动失败', diagnostic);
      app.exit(1);
    }
  });
}
