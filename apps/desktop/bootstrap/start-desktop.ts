import * as fs from 'node:fs';
import * as path from 'node:path';
import { app } from 'electron';
import { assertNoStartupInstall, loadStaticCatalog } from '@dsh-forge/profile-toolchain/trust';
import { parseDistribution } from '@dsh-forge/profile-toolchain/schema';
import { resolveDesktopDshHome } from '../runtime/dsh-home.ts';
import { packagedProfileName, profileFromArguments, selectDesktopProfile } from '../runtime/profile-selection.ts';
import { createElectronRuntime } from '../native-runtime.ts';
import { createDesktopLauncher, ensureDistributionProfile, listProfiles, probeLoopback, startDshHost } from '../main.ts';
import { scheduleSmokeExit, writeSmokeReport } from './smoke.ts';

/** Electron 公共启动编排：应用就绪、profile、Host、窗口和 generation 必须顺序完成。 */

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

/** 启动桌面应用；Smoke 收尾由独立适配器负责，公共流程不感知测试输出格式。 */
export async function startDesktop() {
  writeSmokeReport('starting', 'process-start');
  if (process.env.DSH_FORGE_SMOKE_USER_DATA)
    app.setPath('userData', path.resolve(process.env.DSH_FORGE_SMOKE_USER_DATA));
  const runtime = createElectronRuntime();
  if (!runtime.acquired) {
    writeSmokeReport('failed', 'single-instance', '未获得 Electron 单实例锁');
    reportDevelopmentPhase('已有桌面实例正在运行，转交窗口激活请求');
    app.quit();
    return null;
  }
  writeSmokeReport('starting', 'single-instance-acquired');
  reportDevelopmentPhase('等待 Electron 应用就绪');
  await app.whenReady();
  writeSmokeReport('starting', 'electron-ready');
  writeSmokeReport('starting', 'app-path-starting');
  const root = app.getAppPath();
  writeSmokeReport('starting', 'app-path-ready');
  reportDevelopmentPhase(`Electron 已就绪，加载应用根目录: ${root}`);
  writeSmokeReport('starting', 'catalog-loading');
  const catalog = loadStaticCatalog(path.join(root, 'catalog', 'catalog.yml'));
  writeSmokeReport('starting', 'catalog-validating');
  assertNoStartupInstall(catalog);
  writeSmokeReport('starting', 'catalog-ready');
  // 应用主进程只使用 app.asar 内的一棵 production closure；DSH runtime
  // 始终从随包 profile 解析，不再复制 dsh-forge/runtime。
  const runtimeRoot = root;
  const launcherFallbackRoot = app.isPackaged ? packagedResourcePath('dsh-forge', 'launcher-fallback') : undefined;
  const template = app.isPackaged ? packagedResourcePath('dsh-forge', 'profile') : null;
  writeSmokeReport('starting', 'distribution-loading');
  const distribution = parseDistribution(path.join(root, 'distribution.yml'));
  writeSmokeReport('starting', 'distribution-ready');
  const requestedProfile = profileFromArguments(process.argv);
  writeSmokeReport('starting', 'profile-selection-starting');
  const sourceProfile = selectDesktopProfile({
    defaultProfile: distribution.defaultProfile,
    requestedProfile,
    packagedProfile: app.isPackaged ? packagedProfileName(packagedResourcePath('dsh-forge', 'resolved-manifest.json')) : null,
  });
  writeSmokeReport('starting', 'profile-selection-ready');
  writeSmokeReport('starting', 'dsh-home-starting');
  const dshHome = resolveDesktopDshHome();
  writeSmokeReport('starting', 'dsh-home-ready');
  writeSmokeReport('starting', 'profile-materialization-starting');
  const managedProfile = ensureDistributionProfile({
    root,
    dshHome: dshHome.path,
    profileTemplate: template,
    distributionId: distribution.id,
    sourceProfile,
    onPhase: (phase) => writeSmokeReport('starting', phase),
  });
  writeSmokeReport('starting', 'profile-materialization-ready');
  writeSmokeReport('starting', 'profile-listing-starting');
  const profiles = listProfiles(dshHome.path, managedProfile.profileName);
  if (!profiles.some((profile) => profile.selectable)) throw new Error('没有可启动的 desktop profile');
  writeSmokeReport('starting', 'profile-ready');
  reportDevelopmentPhase(`使用 DSH Home: ${dshHome.source === 'default' ? '~/.dsh' : '$DSH_HOME'}`);
  reportDevelopmentPhase(`使用 profile: ${managedProfile.profileName}`);
  let quitting = false;
  const windowFactory = runtime.createWindowFactory({
    // start-desktop.js 位于 bootstrap 子目录，preload.js 与 electron-main.js
    // 同级；使用显式父目录避免拆分入口后指向 bootstrap/preload.js。
    preload: path.join(__dirname, '..', 'preload.js'),
    icon: applicationIconPath(root),
    deadlineMs: 15_000,
    onClose: (event) => {
      if (quitting) return;
      event.preventDefault();
      void launcher?.hide();
    },
  });
  writeSmokeReport('starting', 'window-factory-ready');
  const launcher = createDesktopLauncher({
    userData: runtime.userDataPath,
    profiles,
    startupProfile: requestedProfile || (app.isPackaged ? managedProfile.profileName : undefined),
    onPhase: (phase) => writeSmokeReport('starting', phase),
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
  writeSmokeReport('starting', 'launcher-ready');
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
  writeSmokeReport('starting', 'generation-starting');
  const generation = await launcher.start();
  process.stdout.write(`DSH Forge Desktop 已就绪（profile: ${generation.profile}）\n`);
  writeSmokeReport('passed', 'generation-ready');
  scheduleSmokeExit(requestExit);
  return { launcher, requestExit };
}
