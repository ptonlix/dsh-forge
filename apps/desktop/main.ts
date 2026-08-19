import * as fs from 'node:fs';
import * as http from 'node:http';
import * as net from 'node:net';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { compileProfile } from '../../src/compiler/index.ts';
import { fail } from '../../src/core/errors.ts';
import { GenerationManager } from '../../src/runtime/generation.ts';
import { ProfileStateStore } from '../../src/runtime/state-store.ts';
import { createDesktopServices } from '../../src/services/desktop-services.ts';
import { errorMessage } from '../../src/types.ts';
import type { GenerationLike, ProfileSummary } from '../../src/types.ts';

/**
 * Electron 主进程与 DSH Host 的适配层。
 * launcher 负责 generation 事务和窗口生命周期；本文件负责 loopback 端口、
 * 动态 runtime 加载、desktop capability 注入、renderer 健康握手以及安全窗口配置。
 */

type RuntimeRequire = NodeJS.Require;

interface Patch {
  readonly [key: string]: unknown;
}

interface LoadedLayer {
  readonly packageName: string;
  readonly patches: readonly Patch[];
}

interface LoadedProfile {
  readonly layers: readonly LoadedLayer[];
  readonly patches: readonly Patch[];
}

interface HostContext {
  readonly fiber: { dispose(): Promise<void> };
  provide(name: string, value: unknown): void;
}

interface DshAppBoot {
  healProfilesModuleFallback(installAnchor: string, home: string): void;
  loadProfile(appName: string, profile: string, installAnchor: string, home: string): LoadedProfile;
  loadOverlayPatches(appName: string, file: string): readonly Patch[];
  loadOptionalPatches(appName: string, file: string): readonly Patch[] | null;
  boot(
    appName: string,
    cordisFile: string,
    patches: readonly Patch[],
    configure: (ctx: HostContext) => void,
    installAnchor: string,
  ): Promise<HostContext>;
  assertEntriesActivated(ctx: HostContext, appName: string): Promise<void>;
}

interface CmdlineModule {
  provideCmdline(ctx: HostContext, options: { readonly args: readonly string[]; readonly exit: () => void }): void;
}

export interface DesktopProfile extends ProfileSummary {
  readonly dir: string;
  readonly bundles: readonly string[];
}

interface HostInstance {
  readonly generationId: string;
  readonly profileDir: string;
  url(): Promise<string>;
  entriesSettled(): Promise<void>;
  registerInteractiveCommands(): Promise<void>;
  dispose(): Promise<void>;
}

interface LauncherGenerationState {
  readonly services: ReturnType<typeof createDesktopServices>;
  readonly host: HostInstance;
  url?: string;
}

interface LauncherOptions {
  readonly userData: string;
  readonly profiles: readonly DesktopProfile[];
  readonly host: { start(options: HostStartOptions): Promise<HostInstance> };
  readonly windowFactory: WindowFactory;
  probe(url: string): Promise<void>;
  readonly deadlineMs?: number;
  readonly pnpm?: string;
  readonly pnpmArgs?: readonly string[];
  readonly pnpmEnv?: NodeJS.ProcessEnv;
}

export interface HostStartOptions {
  readonly profile: DesktopProfile;
  readonly generationId: string;
  readonly capability: ReturnType<typeof createDesktopServices>;
}

interface ElectronWindow {
  readonly webContents: {
    once(event: 'did-fail-load', listener: (event: unknown, code: number, description: string) => void): void;
  };
  on(event: 'close', listener: (event: { preventDefault(): void }) => void): void;
  loadURL(url: string): Promise<void>;
  show(): void;
  hide(): void;
  destroy(): void;
  isDestroyed(): boolean;
}

interface IpcMainLike {
  on(event: string, listener: (event: { readonly sender: unknown }, report: unknown) => void): void;
  off(event: string, listener: (event: { readonly sender: unknown }, report: unknown) => void): void;
}

interface RendererWindow {
  readonly sandbox: boolean;
  readonly contextIsolation: boolean;
  readonly nodeIntegration: boolean;
  waitForBootReport(): Promise<void>;
  show(): void;
  hide(): void;
  destroy(): void;
}

interface WindowFactoryOptions {
  readonly url: string;
  readonly sandbox: boolean;
  readonly contextIsolation: boolean;
  readonly nodeIntegration: boolean;
}

type WindowFactory = (options: WindowFactoryOptions) => Promise<RendererWindow>;

/** 从真实 runtime 安装锚点创建 require，确保 pnpm peer 闭包按正确路径解析。 */
function dshRequire(runtimeRoot?: string): RuntimeRequire {
  const packageFile = runtimeRoot
    ? path.join(runtimeRoot, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
    : require.resolve('@deepseek-ai/dsh/package.json');
  if (!fs.existsSync(packageFile)) fail(`缺少 DSH runtime 安装锚点: ${packageFile}`, 'DSH_RUNTIME_MISSING');
  return createRequire(fs.realpathSync(packageFile)) as RuntimeRequire;
}

function describeBootError(error: unknown, depth = 0): string {
  if (!error || depth > 4) return '';
  const record = typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : {};
  const name = typeof record.name === 'string' ? record.name : 'Error';
  const message = typeof record.message === 'string' ? record.message : String(error);
  const lines = [`${name}: ${message}`];
  if (Array.isArray(record.errors)) {
    for (const child of record.errors) lines.push(`${'  '.repeat(depth + 1)}${describeBootError(child, depth + 1)}`);
  }
  if (record.cause) lines.push(`${'  '.repeat(depth + 1)}cause: ${describeBootError(record.cause, depth + 1)}`);
  return lines.join('\n');
}

/** 申请一个未占用的 loopback 端口；探测 server 关闭后才返回端口号。 */
export function allocatePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0 }, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : undefined;
      server.close((error) => (error ? reject(error) : port ? resolve(port) : reject(new Error('无法分配本地端口'))));
    });
  });
}

/** 在 deadline 内轮询 Host readiness，超时错误保留最后一次 HTTP/网络原因。 */
export async function probeLoopback(url: string, deadlineMs: number): Promise<void> {
  const end = Date.now() + deadlineMs;
  let lastError: unknown;
  while (Date.now() < end) {
    try {
      await new Promise<void>((resolve, reject) => {
        const request = http.get(url, (response) => {
          response.resume();
          if (response.statusCode && response.statusCode >= 200 && response.statusCode < 500) resolve();
          else reject(new Error(`HTTP readiness 返回 ${response.statusCode}`));
        });
        request.setTimeout(1_000, () => request.destroy(new Error('HTTP readiness 超时')));
        request.once('error', reject);
      });
      return;
    } catch (error) {
      lastError = error;
      await new Promise<void>((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error(`Host HTTP readiness 超时: ${errorMessage(lastError || 'unknown error')}`);
}

function copyProfileTemplate(source: string, destination: string): string {
  if (fs.existsSync(path.join(destination, 'package.json'))) return destination;
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  fs.cpSync(source, destination, {
    recursive: true,
    dereference: true,
    filter: (sourcePath) => path.basename(sourcePath) !== 'node_modules',
  });
  return destination;
}

function developmentProfileTemplate(root: string): string {
  return compileProfile({ root }).profileDir;
}

/** 将官方 profile 模板复制到用户目录，明确排除 node_modules，避免复制安装状态。 */
export function ensureOfficialProfile({
  root,
  home,
  profileTemplate,
  profileName = 'official',
}: {
  readonly root: string;
  readonly home: string;
  readonly profileTemplate: string | null;
  readonly profileName?: string;
}): string {
  const source = profileTemplate || developmentProfileTemplate(root);
  return copyProfileTemplate(source, path.join(home, 'profiles', profileName));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** 扫描用户 profile；不可验证或持久化 desktop layer 的目录只能展示，不能选择。 */
export function listProfiles(home: string, defaultProfile = 'official'): DesktopProfile[] {
  const root = path.join(home, 'profiles');
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'node_modules')
    .map((entry): DesktopProfile => {
      const directory = path.join(root, entry.name);
      try {
        const manifest: unknown = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
        const profile =
          isRecord(manifest) && isRecord(manifest.dsh) && isRecord(manifest.dsh.profile) ? manifest.dsh.profile : null;
        const bundles = profile?.bundles;
        if (!Array.isArray(bundles) || !bundles.every((bundle): bundle is string => typeof bundle === 'string'))
          throw new Error('缺少 dsh.profile.bundles');
        const webCompatible = bundles.includes('@deepseek-ai/dsh-web-app');
        const launcherOwned = bundles.includes('@dsh-forge/desktop-layer');
        return Object.freeze({
          name: entry.name,
          dir: directory,
          bundles: bundles.slice(),
          exists: true,
          webCompatible,
          default: entry.name === defaultProfile,
          selectable: webCompatible && !launcherOwned,
          reason: launcherOwned ? 'desktop layer 由 launcher 管理' : webCompatible ? null : 'profile 缺少 Web bundle',
        });
      } catch (error) {
        return Object.freeze({
          name: entry.name,
          dir: directory,
          bundles: [],
          exists: true,
          webCompatible: false,
          default: entry.name === defaultProfile,
          selectable: false,
          reason: `profile manifest 无效: ${errorMessage(error)}`,
        });
      }
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

async function loadAppBoot(runtimeRequire: RuntimeRequire): Promise<DshAppBoot> {
  const module = await import(pathToFileURL(runtimeRequire.resolve('@deepseek-ai/dsh-app-boot')).href);
  return module as unknown as DshAppBoot;
}

/** 启动一个 generation 的 DSH Host，注入桌面 capability 并返回可释放的 Host 实例。 */
export async function startDshHost({
  root,
  home,
  runtimeRoot,
  profile,
  generationId,
  capability,
}: {
  readonly root: string;
  readonly home: string;
  readonly runtimeRoot?: string;
  readonly profile: DesktopProfile;
  readonly generationId: string;
  readonly capability: ReturnType<typeof createDesktopServices>;
}): Promise<HostInstance> {
  const runtimeRequire = dshRequire(runtimeRoot);
  const appBoot = await loadAppBoot(runtimeRequire);
  const cmdline = (await import(
    pathToFileURL(runtimeRequire.resolve('@deepseek-ai/dsh-cmdline')).href
  )) as unknown as CmdlineModule;
  const installAnchor = runtimeRequire.resolve('@deepseek-ai/dsh/package.json');
  appBoot.healProfilesModuleFallback(installAnchor, home);
  const loaded = appBoot.loadProfile('dsh-forge-desktop', profile.name, installAnchor, home);
  const desktopPatch = appBoot.loadOverlayPatches(
    'dsh-forge-desktop',
    path.join(root, 'packages', 'bundles', 'desktop-layer', 'cordis.patch.yml'),
  );
  const patches: Patch[] = [];
  let injected = false;
  for (const layer of loaded.layers) {
    patches.push(...layer.patches);
    if (layer.packageName === '@deepseek-ai/dsh-web-app') {
      patches.push(...desktopPatch);
      injected = true;
    }
  }
  if (!injected) fail('desktop profile 缺少 @deepseek-ai/dsh-web-app', 'DESKTOP_LAYER_UNRESOLVED');
  patches.push(...loaded.patches);
  const homePatch = appBoot.loadOptionalPatches('dsh-forge-desktop', path.join(home, 'cordis.patch.yml'));
  if (homePatch) patches.push(...homePatch);
  const port = await allocatePort();
  let ctx: HostContext;
  try {
    ctx = await appBoot.boot(
      'dsh-forge-desktop',
      path.join(profile.dir, 'cordis.yml'),
      patches,
      (hostCtx) => {
        hostCtx.provide('dshForgeDesktopCapability', capability);
        cmdline.provideCmdline(hostCtx, { args: ['--host', '127.0.0.1', '--port', String(port)], exit: () => {} });
      },
      pathToFileURL(installAnchor).href,
    );
  } catch (error) {
    throw new Error(`DSH Host boot 失败:\n${describeBootError(error)}`, { cause: error });
  }
  const url = `http://127.0.0.1:${port}`;
  return Object.freeze({
    generationId,
    profileDir: profile.dir,
    url: async () => url,
    entriesSettled: async () => appBoot.assertEntriesActivated(ctx, 'dsh-forge-desktop'),
    registerInteractiveCommands: async () => {},
    dispose: async () => ctx.fiber.dispose(),
  });
}

function rendererReport(window: ElectronWindow, ipcMain: IpcMainLike, deadlineMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish =
      (callback: (value?: unknown) => void) =>
      (value?: unknown): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        callback(value);
      };
    const timer = setTimeout(() => finish(reject)(new Error('renderer boot report 超时')), deadlineMs);
    const listener = (event: { readonly sender: unknown }, report: unknown): void => {
      if (event.sender !== window.webContents) return;
      ipcMain.off('dsh-forge:renderer-boot', listener);
      const healthy = isRecord(report) && report.status === 'healthy';
      if (!healthy) {
        const message =
          isRecord(report) && typeof report.error === 'string' ? report.error : 'renderer boot report 失败';
        finish(reject)(new Error(message));
      } else finish(() => resolve())();
    };
    ipcMain.on('dsh-forge:renderer-boot', listener);
    window.webContents.once('did-fail-load', (_event, code, description) =>
      finish(reject)(new Error(`renderer 加载失败: ${code} ${description}`)),
    );
  });
}

/** 创建 renderer 健康握手窗口，并固定 sandbox/contextIsolation/nodeIntegration 安全策略。 */
export function createElectronWindowFactory({
  BrowserWindow,
  ipcMain,
  preload,
  deadlineMs,
  onClose,
}: {
  readonly BrowserWindow: new (options: Record<string, unknown>) => ElectronWindow;
  readonly ipcMain: IpcMainLike;
  readonly preload: string;
  readonly deadlineMs: number;
  readonly onClose: (event: { preventDefault(): void }, window: ElectronWindow) => void;
}): WindowFactory {
  return async ({ url, sandbox, contextIsolation, nodeIntegration }) => {
    const window = new BrowserWindow({
      width: 1280,
      height: 860,
      show: false,
      webPreferences: { sandbox, contextIsolation, nodeIntegration, preload },
    });
    window.on('close', (event) => onClose(event, window));
    await window.loadURL(url);
    return Object.freeze({
      sandbox,
      contextIsolation,
      nodeIntegration,
      waitForBootReport: () => rendererReport(window, ipcMain, deadlineMs),
      show: () => window.show(),
      hide: () => window.hide(),
      destroy: () => {
        if (!window.isDestroyed()) window.destroy();
      },
    });
  };
}

/** 把 profile、Host、窗口和 GenerationManager 组装成完整桌面启动事务。 */
export function createDesktopLauncher({
  userData,
  profiles,
  host,
  windowFactory,
  probe,
  deadlineMs = 15_000,
  pnpm,
  pnpmArgs,
  pnpmEnv,
}: LauncherOptions) {
  if (!userData || !host || !windowFactory || !probe) fail('桌面启动器缺少运行时提供方', 'LAUNCHER_CONFIG');
  let windowRef: RendererWindow | null = null;
  const generationStates = new WeakMap<GenerationLike, LauncherGenerationState>();
  const store = new ProfileStateStore(path.join(userData, 'dsh-forge'));
  const manager = new GenerationManager({
    stateStore: store,
    profiles,
    healthDeadlineMs: deadlineMs,
    hooks: {
      async prepare(generation) {
        const profile = profiles.find((candidate) => candidate.name === generation.profile);
        if (!profile) fail(`profile 不存在: ${generation.profile}`, 'PROFILE_UNSELECTABLE');
        const services = createDesktopServices({
          generation,
          manager,
          profiles,
          profileDir: profile.dir,
          pnpm,
          pnpmArgs,
          pnpmEnv,
        });
        const hostInstance = await host.start({ profile, generationId: generation.id, capability: services });
        generationStates.set(generation, { services, host: hostInstance });
      },
      async hostReady(generation) {
        await generationStates.get(generation)?.host.entriesSettled();
      },
      async webReady(generation) {
        const state = generationStates.get(generation);
        if (!state) fail('generation host 状态缺失', 'GENERATION_CONFIG');
        const url = await state.host.url();
        await probe(url);
        state.url = url;
      },
      async windowReady(generation) {
        const state = generationStates.get(generation);
        if (!state?.url) fail('generation URL 缺失', 'GENERATION_CONFIG');
        windowRef = await windowFactory({
          url: state.url,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
        });
        if (!windowRef.sandbox || !windowRef.contextIsolation || windowRef.nodeIntegration)
          fail('BrowserWindow 安全配置无效', 'RENDERER_SANDBOX');
      },
      async rendererReady() {
        if (!windowRef) fail('BrowserWindow 尚未创建', 'GENERATION_CONFIG');
        await windowRef.waitForBootReport();
      },
      async interactionReady(generation) {
        const state = generationStates.get(generation);
        if (!state || !windowRef) fail('generation window 状态缺失', 'GENERATION_CONFIG');
        await state.host.registerInteractiveCommands();
        windowRef.show();
      },
      async hideWindow() {
        windowRef?.hide();
      },
      async dispose(generation) {
        windowRef?.destroy();
        windowRef = null;
        const state = generationStates.get(generation);
        generationStates.delete(generation);
        await state?.host.dispose();
      },
    },
  });
  const fallback =
    profiles.find((profile) => profile.default && profile.selectable)?.name ||
    profiles.find((profile) => profile.selectable)?.name;
  if (!fallback) fail('没有可启动的 desktop profile', 'PROFILE_UNSELECTABLE');
  return Object.freeze({
    manager,
    start: () =>
      manager.select(store.load().pending?.profile || store.load().active || store.load().lastKnownGood || fallback),
    show: () => windowRef?.show(),
    hide: () => manager.hideWindow(),
    retry: () => manager.retry(),
    exit: () => manager.dispose('explicit-exit'),
    signal: (signal: string) => manager.signal(signal),
  });
}
