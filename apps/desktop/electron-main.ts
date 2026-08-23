import * as fs from 'node:fs';
import * as path from 'node:path';
import { app, dialog } from 'electron';
import { assertNoStartupInstall, loadStaticCatalog } from '@dsh-forge/profile-toolchain/trust';
import { parseDistribution } from '@dsh-forge/profile-toolchain/schema';
import { errorMessage } from './runtime/types.ts';
import { resolveDesktopDshHome } from './runtime/dsh-home.ts';
import { packagedProfileName, profileFromArguments, selectDesktopProfile } from './runtime/profile-selection.ts';
import { createElectronRuntime } from './native-runtime.ts';
import { createDesktopLauncher, ensureDistributionProfile, listProfiles, probeLoopback, startDshHost } from './main.ts';

/** Electron 应用入口：只负责应用就绪、静态 catalog 检查、launcher 创建和信号退出。 */

/** 解析打包应用的 resourcesPath；开发模式不应进入该路径。 */
function packagedResourcePath(...segments: readonly string[]): string {
  const resourcesPath = (process as NodeJS.Process & { readonly resourcesPath?: string }).resourcesPath;
  if (!resourcesPath) throw new Error('Electron resourcesPath 不可用');
  return path.join(resourcesPath, ...segments);
}

/** 开发模式输出启动阶段，避免 Host 就绪前没有窗口时无法诊断停留位置。 */
function reportDevelopmentPhase(message: string): void {
  if (!app.isPackaged) process.stdout.write(`[dsh-forge:dev] ${message}\n`);
}

/** 返回构建期与运行期共用的原生窗口图标，缺失时在启动前明确失败。 */
function applicationIconPath(root: string): string {
  const filename = process.platform === 'darwin' ? 'app-icon-mac.png' : 'app-icon.png';
  const icon = app.isPackaged ? packagedResourcePath('dsh-forge', filename) : path.join(root, 'build', filename);
  if (!fs.existsSync(icon)) throw new Error(`应用图标不存在: ${icon}`);
  return icon;
}

/** 启动桌面应用；smoke 模式会在成功握手后主动退出，避免测试进程常驻。 */
export async function startElectron() {
  if (process.env.DSH_FORGE_SMOKE_USER_DATA)
    app.setPath('userData', path.resolve(process.env.DSH_FORGE_SMOKE_USER_DATA));
  const runtime = createElectronRuntime();
  if (!runtime.acquired) {
    reportDevelopmentPhase('已有桌面实例正在运行，转交窗口激活请求');
    app.quit();
    return null;
  }
  reportDevelopmentPhase('等待 Electron 应用就绪');
  await app.whenReady();
  const root = app.getAppPath();
  reportDevelopmentPhase(`Electron 已就绪，加载应用根目录: ${root}`);
  const catalog = loadStaticCatalog(path.join(root, 'catalog', 'catalog.yml'));
  assertNoStartupInstall(catalog);
  // 应用主进程只使用 app.asar 内的一棵 production closure；DSH runtime
  // 始终从随包 profile 解析，不再复制 dsh-forge/runtime。
  const runtimeRoot = root;
  const launcherFallbackRoot = app.isPackaged ? packagedResourcePath('dsh-forge', 'launcher-fallback') : undefined;
  const template = app.isPackaged ? packagedResourcePath('dsh-forge', 'profile') : null;
  const distribution = parseDistribution(path.join(root, 'distribution.yml'));
  const requestedProfile = profileFromArguments(process.argv);
  const sourceProfile = selectDesktopProfile({
    defaultProfile: distribution.defaultProfile,
    requestedProfile,
    packagedProfile: app.isPackaged ? packagedProfileName(packagedResourcePath('dsh-forge', 'resolved-manifest.json')) : null,
  });
  const dshHome = resolveDesktopDshHome();
  const managedProfile = ensureDistributionProfile({
    root,
    dshHome: dshHome.path,
    profileTemplate: template,
    distributionId: distribution.id,
    sourceProfile,
  });
  const profiles = listProfiles(dshHome.path, managedProfile.profileName);
  if (!profiles.some((profile) => profile.selectable)) throw new Error('没有可启动的 desktop profile');
  reportDevelopmentPhase(`使用 DSH Home: ${dshHome.source === 'default' ? '~/.dsh' : '$DSH_HOME'}`);
  reportDevelopmentPhase(`使用 profile: ${managedProfile.profileName}`);
  let quitting = false;
  const windowFactory = runtime.createWindowFactory({
    preload: path.join(__dirname, 'preload.js'),
    icon: applicationIconPath(root),
    deadlineMs: 15_000,
    onClose: (event) => {
      if (quitting) return;
      event.preventDefault();
      void launcher?.hide();
    },
  });
  const launcher = createDesktopLauncher({
    userData: runtime.userDataPath,
    profiles,
    startupProfile: requestedProfile || (app.isPackaged ? managedProfile.profileName : undefined),
    deadlineMs: 15_000,
    probe: (url) => probeLoopback(url, 15_000),
    windowFactory,
    host: {
      start: (options) =>
        startDshHost({
          root,
          home: dshHome.path,
          runtimeRoot,
          launcherFallbackRoot,
          ...options,
        }),
    },
    pnpm: process.execPath,
    pnpmArgs: [path.join(runtimeRoot, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs')],
    pnpmEnv: { ELECTRON_RUN_AS_NODE: '1' },
    catalog: catalog.entries,
  });
  runtime.setSecondInstanceHandler(() => launcher.show());
  const requestExit = async (reason: string): Promise<void> => {
    if (quitting) return;
    quitting = true;
    try {
      await launcher.signal(reason);
    } finally {
      runtime.exit(0);
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
  reportDevelopmentPhase('启动 deepseek-harness Host 并等待 renderer 健康握手');
  const generation = await launcher.start();
  process.stdout.write(`DSH Forge Desktop 已就绪（profile: ${generation.profile}）\n`);
  if (process.argv.includes('--dsh-forge-smoke')) {
    const report = process.env.DSH_FORGE_SMOKE_REPORT;
    if (report)
      fs.writeFileSync(
        report,
        `${JSON.stringify({
          schema: 'dsh-forge/electron-smoke@1',
          electron: process.versions.electron || null,
          electronAbi: process.versions.modules,
        })}\n`,
        { mode: 0o600 },
      );
    setTimeout(() => void requestExit('smoke-exit'), 1_000);
  }
  return { launcher, requestExit };
}

// Electron 通过默认启动器加载 package.json 的 main，不会使当前模块成为
// require.main。使用 Node CLI 守卫会导致 Electron 进程常驻却完全不执行桌面启动。
void startElectron().catch((error: unknown) => {
  const diagnostic = error instanceof Error && error.stack ? error.stack : errorMessage(error);
  process.stderr.write(`DSH Forge Desktop 启动失败:\n${diagnostic}\n`);
  if (process.argv.includes('--dsh-forge-smoke')) {
    app.exit(1);
  } else {
    dialog.showErrorBox('DSH Forge 启动失败', diagnostic);
    app.exit(1);
  }
});
