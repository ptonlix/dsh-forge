import * as fs from 'node:fs';
import * as http from 'node:http';
import * as net from 'node:net';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { compileProfile } from '@dsh-forge/profile-toolchain/compiler';
import { fail } from '@dsh-forge/profile-toolchain/core/errors';
import type { CatalogEntry } from '@dsh-forge/profile-toolchain/schema';
import { createDesktopHostCapability } from '@dsh-forge/desktop-services-local/launcher';
import type { DesktopProfileSummary } from '@dsh-forge/desktop-services';
import type { DesktopHostCapability } from '@dsh-forge/desktop-services-local/launcher';
import { GenerationManager } from './runtime/generation.ts';
import { ensureManagedProfile } from './runtime/managed-profile.ts';
import { ProfileStateStore } from './runtime/state-store.ts';
import { errorMessage } from './runtime/types.ts';
import type { GenerationLike, ProfileState, ProfileSummary, StateStore } from './runtime/types.ts';

/**
 * Electron 主进程与 DSH Host 的适配层。
 * launcher 负责 generation 事务和窗口生命周期；本文件负责 loopback 端口、
 * 动态 runtime 加载、desktop capability 注入、renderer 健康握手以及安全窗口配置。
 */

type RuntimeRequire = NodeJS.Require;

interface Patch {
  readonly [key: string]: unknown;
}

interface ComposedEntry {
  readonly id?: string;
  readonly config?: unknown;
}

type PatchConfig = Readonly<Record<string, unknown>>;

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
  composeEntries(layers: readonly (readonly Patch[])[]): readonly ComposedEntry[];
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
  readonly host: HostInstance;
  url?: string;
}

interface LauncherOptions {
  readonly userData: string;
  readonly profiles: readonly DesktopProfile[];
  /** 显式启动或打包应用绑定的 profile，优先于持久化恢复状态。 */
  readonly startupProfile?: string;
  readonly onPhase?: (phase: string) => void;
  readonly host: { start(options: HostStartOptions): Promise<HostInstance> };
  readonly windowFactory: WindowFactory;
  probe(url: string): Promise<void>;
  readonly deadlineMs?: number;
  readonly pnpm?: string;
  readonly pnpmArgs?: readonly string[];
  readonly pnpmEnv?: NodeJS.ProcessEnv;
  readonly catalog: readonly CatalogEntry[];
}

export interface HostStartOptions {
  readonly profile: DesktopProfile;
  readonly generationId: string;
  readonly capability: DesktopHostCapability;
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

/**
 * 从受管 profile 的 package.json 锚点加载 DSH runtime。
 *
 * 外部 bundle 与 DSH 的 peer 闭包必须处于同一个 profile-local 解析域；不能让
 * runtime 闭包先接管 DSH，再让 Cordis Loader 从另一个闭包解析 bundle entry。
 */
function dshRequire(profileAnchor: string): RuntimeRequire {
  if (!fs.existsSync(profileAnchor)) fail(`缺少 profile 模块锚点: ${profileAnchor}`, 'PROFILE_DEPENDENCY_ANCHOR_MISSING');
  const profileRequire = createRequire(fs.realpathSync(profileAnchor)) as RuntimeRequire;
  let packageFile: string;
  try {
    packageFile = profileRequire.resolve('@deepseek-ai/dsh/package.json');
  } catch {
    fail(`profile 闭包缺少 DSH runtime: ${profileAnchor}`, 'DSH_RUNTIME_MISSING');
  }
  return createRequire(fs.realpathSync(packageFile)) as RuntimeRequire;
}

function packageDirectoryFromAnchor(anchor: string, packageName: string): string | null {
  const runtimeRequire = createRequire(anchor);
  for (const searchPath of runtimeRequire.resolve.paths(packageName) || []) {
    const directory = path.join(searchPath, ...packageName.split('/'));
    const manifest = path.join(directory, 'package.json');
    if (fs.existsSync(manifest)) return fs.realpathSync(directory);
  }
  return null;
}

function assertPackageIdentity(directory: string, packageName: string): void {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8')) as { name?: unknown };
  if (manifest.name !== packageName) fail(`运行时 package 身份不匹配: ${packageName}`, 'DESKTOP_RUNTIME_PACKAGE_IDENTITY');
}

function packageVersion(directory: string): string | null {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8')) as { version?: unknown };
  return typeof manifest.version === 'string' ? manifest.version : null;
}

function isWithinDirectory(root: string, target: string): boolean {
  const relative = path.relative(fs.realpathSync(root), target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function linkFallbackPackage(
  fallback: string,
  packageName: string,
  source: string,
  { allowMaterializedDependency = false }: { readonly allowMaterializedDependency?: boolean } = {},
): void {
  assertPackageIdentity(source, packageName);
  const link = path.join(fallback, ...packageName.split('/'));
  fs.mkdirSync(path.dirname(link), { recursive: true, mode: 0o700 });
  let stat: fs.Stats | null = null;
  try {
    stat = fs.lstatSync(link);
  } catch (error: unknown) {
    if (!(error && typeof error === 'object' && (error as NodeJS.ErrnoException).code === 'ENOENT')) throw error;
  }
  if (stat) {
    if (!stat.isSymbolicLink()) {
      if (allowMaterializedDependency) {
        assertPackageIdentity(link, packageName);
        return;
      }
      fail(`desktop fallback 被非受管路径占用: ${link}`, 'DESKTOP_RUNTIME_FALLBACK_CONFLICT');
    }
    const existing = fs.realpathSync(link);
    // pnpm 物化的依赖链接必须仍位于 profile 闭包内；它们由 profile-local
    // lockfile 锁定，可能与 launcher runtime 使用不同但兼容的传递版本。
    if (allowMaterializedDependency && isWithinDirectory(fallback, existing)) {
      assertPackageIdentity(existing, packageName);
      return;
    }
    if (existing === source) return;
    if (packageVersion(existing) !== packageVersion(source))
      fail(`desktop fallback 版本与当前 runtime 不一致: ${link}`, 'DESKTOP_RUNTIME_FALLBACK_CONFLICT');
    // profile `node_modules` 中的同版本链接只可能来自旧的 pnpm peer 实例；
    // 重定向到当前 runtime，避免 ESM 从两个闭包混合导入。
    fs.unlinkSync(link);
  }
  // `DSH_HOME` 可以经过系统符号链接（macOS 的 /tmp 即为常见情况）；
  // 必须以实际父目录计算相对目标，避免写入看似相对、实际悬挂的 fallback。
  const relative = path.relative(fs.realpathSync(path.dirname(link)), fs.realpathSync(source));
  if (!relative || path.isAbsolute(relative)) fail(`desktop fallback 不能建立安全相对链接: ${packageName}`, 'DESKTOP_RUNTIME_FALLBACK');
  fs.symlinkSync(relative, link, 'junction');
}

/**
 * desktop layer 由 launcher 临时注入，不进入 profile bundle 列表。为让 profile
 * 锚点的 Loader 只从受控路径解析它，在当前 profile 闭包中创建到当前
 * runtime 的相对链接；fallback 只包含 launcher 注入层及其服务提供方，
 * 不得把 DSH runtime 或任意工作区包混入 profile 的持久闭包。
 */
function ensureDesktopLayerFallback(
  profileDir: string,
  runtimeRoot: string | undefined,
  launcherFallbackRoot?: string,
): void {
  // 应用 staging 只携带主进程 production closure；DSH runtime 始终从 profile
  // 解析。已打包应用从 resources 的真实目录复制 fallback，避免 app.asar 不能作为
  // DSH Home 文件系统链接目标；开发态仍使用当前 runtime 的相对链接。
  const fallbackRoot = launcherFallbackRoot || runtimeRoot;
  const runtimeAnchor = fallbackRoot ? path.join(fallbackRoot, 'package.json') : path.join(process.cwd(), 'package.json');
  if (!fs.existsSync(runtimeAnchor)) fail(`缺少桌面 runtime 锚点: ${runtimeAnchor}`, 'DESKTOP_RUNTIME_MISSING');
  const fallback = path.join(profileDir, 'node_modules');
  for (const packageName of ['@dsh-forge/desktop-layer', '@dsh-forge/desktop-services-local']) {
    const source = packageDirectoryFromAnchor(runtimeAnchor, packageName);
    if (!source) fail(`desktop runtime 缺少 ${packageName}`, 'DESKTOP_RUNTIME_PACKAGE_MISSING');
    if (!launcherFallbackRoot) {
      linkFallbackPackage(fallback, packageName, source, { allowMaterializedDependency: true });
      continue;
    }
    const destination = path.join(fallback, ...packageName.split('/'));
    if (fs.existsSync(destination)) {
      assertPackageIdentity(destination, packageName);
      continue;
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    fs.cpSync(source, destination, { recursive: true, dereference: true });
    assertPackageIdentity(destination, packageName);
  }
}

/** 判断 Cordis 条目的配置是否可以作为浅层 patch 的基底。 */
function isPatchConfig(value: unknown): value is PatchConfig {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 解析当前 DSH 安装随包发布的官方预设根目录。
 *
 * 预设由 `@deepseek-ai/dsh` 应用包维护，不复制到 DSH Forge；`standard`
 * 组合文件缺失时必须在 Host 启动前失败，避免服务启动后才以空 roster
 * 拒绝恢复会话。
 */
export function resolveShippedAgentPresetsRoot(dshPackageFile: string): string {
  const root = path.join(path.dirname(dshPackageFile), 'config', 'agent-presets');
  const standardComposition = path.join(root, 'standard', 'agent.cordis.yml');
  if (!fs.existsSync(standardComposition) || !fs.statSync(standardComposition).isFile()) {
    fail(`DSH runtime 缺少官方 agent preset: ${standardComposition}`, 'DSH_PRESET_ASSETS_MISSING');
  }
  return root;
}

/**
 * 创建覆盖在 profile 与用户层之上的官方预设 patch。
 *
 * 上游 Web bundle 只注册 `agent-presets` 服务；官方预设目录属于应用
 * 安装资源，必须由启动器作为最后一层注入。保留已有配置以便设置的默认
 * 预设和用户根目录继续生效，系统根始终来自当前 runtime。
 */
export function createShippedAgentPresetsPatch(dshPackageFile: string, config: PatchConfig): Patch {
  return {
    id: 'agent-presets',
    config: {
      ...config,
      roots: [{ path: resolveShippedAgentPresetsRoot(dshPackageFile), trust: 'system' }],
    },
  };
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

function developmentProfileTemplate(root: string, profileName: string): string {
  return compileProfile({ root, profileName }).profileDir;
}

/** 将发行版 profile 安装到共享 DSH Home 的受管命名空间。 */
export function ensureDistributionProfile({
  root,
  dshHome,
  profileTemplate,
  distributionId,
  sourceProfile,
}: {
  readonly root: string;
  readonly dshHome: string;
  readonly profileTemplate: string | null;
  readonly distributionId: string;
  readonly sourceProfile: string;
}): { readonly directory: string; readonly profileName: string } {
  const source = profileTemplate || developmentProfileTemplate(root, sourceProfile);
  return ensureManagedProfile({ source, dshHome, distributionId, sourceProfile });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** 扫描用户 profile；不可验证或持久化 desktop layer 的目录只能展示，不能选择。 */
export function listProfiles(home: string, defaultProfile = 'dsh-forge-official'): DesktopProfile[] {
  const root = path.join(home, 'profiles');
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'node_modules' && !entry.name.startsWith('.'))
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

/** 判断 profile 是否可被当前 Desktop generation 选择。 */
function isSelectableProfile(profile: ProfileSummary | undefined): profile is ProfileSummary {
  return Boolean(profile && profile.exists !== false && profile.selectable && !profile.error);
}

/** 将 launcher 的可选 profile 字段收敛为跨包公开的完整只读 summary。 */
function toDesktopServiceProfile(profile: DesktopProfile): DesktopProfileSummary {
  return Object.freeze({
    name: profile.name,
    exists: profile.exists !== false,
    bundles: Object.freeze([...(profile.bundles || [])]),
    webCompatible: profile.webCompatible === true,
    default: profile.default === true,
    selectable: profile.selectable !== false,
    error: profile.error || null,
    reason: profile.reason || null,
  });
}

/**
 * 清理不再存在或不可选择的启动状态，并返回本次应启动的 profile。
 *
 * profile-state 是跨发行版本持久化的数据，不能直接信任其 profile 名称。旧版本
 * 留下的名称会在此处被原子清除，而非让 generation 进入 prepare 后才失败；状态
 * 文件本身保留，仍作为诊断和未来成功启动的持久化容器。
 */
export function resolveStartupProfile(
  stateStore: Pick<StateStore, 'load' | 'save'>,
  profiles: readonly ProfileSummary[],
  fallback: string,
  preferredProfile?: string,
): string {
  const selectable = new Set(profiles.filter(isSelectableProfile).map((profile) => profile.name));
  if (!selectable.has(fallback)) fail(`默认 profile 不可选择: ${fallback}`, 'PROFILE_UNSELECTABLE');

  const profileExists = (name: string | null): boolean => name !== null && selectable.has(name);
  const state = stateStore.load();
  const invalidPending = Boolean(state.pending && !profileExists(state.pending.profile));
  const invalidActive = !profileExists(state.active) && state.active !== null;
  const invalidLastKnownGood = !profileExists(state.lastKnownGood) && state.lastKnownGood !== null;
  const invalidFailure = Boolean(state.lastFailure?.target && !profileExists(state.lastFailure.target));
  const invalidManualRecovery = Boolean(state.manualRecovery && !profileExists(state.manualRecovery.target));
  const requiresRepair =
    invalidPending || invalidActive || invalidLastKnownGood || invalidFailure || invalidManualRecovery;
  let repaired: ProfileState = state;
  if (requiresRepair) {
    repaired = stateStore.save({
      ...state,
      pending: invalidPending ? null : state.pending,
      active: invalidActive ? null : state.active,
      lastKnownGood: invalidLastKnownGood ? null : state.lastKnownGood,
      // 旧 generation 仅对旧 profile 有意义，不能与清理后的选择混用。
      generationId: null,
      lastFailure: invalidFailure ? null : state.lastFailure,
      manualRecovery: invalidManualRecovery ? null : state.manualRecovery,
    });
  }
  if (preferredProfile) {
    if (!selectable.has(preferredProfile)) fail(`指定 profile 不可选择: ${preferredProfile}`, 'PROFILE_UNSELECTABLE');
    return preferredProfile;
  }
  return repaired.pending?.profile || repaired.active || repaired.lastKnownGood || fallback;
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
  launcherFallbackRoot,
  profile,
  generationId,
  capability,
}: {
  readonly root: string;
  readonly home: string;
  readonly runtimeRoot?: string;
  readonly launcherFallbackRoot?: string;
  readonly profile: DesktopProfile;
  readonly generationId: string;
  readonly capability: DesktopHostCapability;
}): Promise<HostInstance> {
  const profileAnchor = path.join(profile.dir, 'package.json');
  const profileRequire = dshRequire(profileAnchor);
  const appBoot = await loadAppBoot(profileRequire);
  const cmdline = (await import(
    pathToFileURL(profileRequire.resolve('@deepseek-ai/dsh-cmdline')).href,
  )) as unknown as CmdlineModule;
  const installAnchor = profileRequire.resolve('@deepseek-ai/dsh/package.json');
  ensureDesktopLayerFallback(profile.dir, runtimeRoot, launcherFallbackRoot);
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
  const agentPresets = appBoot.composeEntries([patches]).find((entry) => entry.id === 'agent-presets');
  if (agentPresets === undefined || !isPatchConfig(agentPresets.config)) {
    fail('desktop profile 缺少有效的 agent-presets 配置', 'DESKTOP_AGENT_PRESETS_MISSING');
  }
  patches.push(createShippedAgentPresetsPatch(installAnchor, agentPresets.config));
  const port = await allocatePort();
  let ctx: HostContext;
  try {
    ctx = await appBoot.boot(
      'dsh-forge-desktop',
      path.join(profile.dir, 'cordis.yml'),
      patches,
      (hostCtx) => {
        hostCtx.provide('dshForgeDesktopCapability', capability);
        cmdline.provideCmdline(hostCtx, {
          args: ['--host', '127.0.0.1', '--port', String(port), '--no-open'],
          exit: () => {},
        });
      },
      pathToFileURL(profileAnchor).href,
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

/** 把 profile、Host、窗口和 GenerationManager 组装成完整桌面启动事务。 */
export function createDesktopLauncher({
  userData,
  profiles,
  startupProfile,
  onPhase,
  host,
  windowFactory,
  probe,
  deadlineMs = 15_000,
  pnpm,
  pnpmArgs,
  pnpmEnv,
  catalog,
}: LauncherOptions) {
  if (!userData || !host || !windowFactory || !probe) fail('桌面启动器缺少运行时提供方', 'LAUNCHER_CONFIG');
  let windowRef: RendererWindow | null = null;
  const generationStates = new WeakMap<GenerationLike, LauncherGenerationState>();
  const store = new ProfileStateStore(path.join(userData, 'dsh-forge'));
  const fallback =
    profiles.find((profile) => profile.default && isSelectableProfile(profile))?.name ||
    profiles.find(isSelectableProfile)?.name;
  if (!fallback) fail('没有可启动的 desktop profile', 'PROFILE_UNSELECTABLE');
  const initialProfile = resolveStartupProfile(store, profiles, fallback, startupProfile);
  const manager = new GenerationManager({
    stateStore: store,
    profiles,
    healthDeadlineMs: deadlineMs,
    hooks: {
      async prepare(generation) {
        onPhase?.('generation-host-starting');
        const profile = profiles.find((candidate) => candidate.name === generation.profile);
        if (!profile) fail(`profile 不存在: ${generation.profile}`, 'PROFILE_UNSELECTABLE');
        const capability = createDesktopHostCapability({
          generation,
          manager,
          profileDir: profile.dir,
          profiles: profiles.map(toDesktopServiceProfile),
          catalog,
          pnpm,
          pnpmArgs,
          pnpmEnv,
          reconcile: async () => {},
          verifyNextGeneration: async () => Boolean(generationStates.get(generation)?.host),
        });
        const hostInstance = await host.start({ profile, generationId: generation.id, capability });
        generationStates.set(generation, { host: hostInstance });
      },
      async hostReady(generation) {
        await generationStates.get(generation)?.host.entriesSettled();
        onPhase?.('generation-host-ready');
      },
      async webReady(generation) {
        const state = generationStates.get(generation);
        if (!state) fail('generation host 状态缺失', 'GENERATION_CONFIG');
        const url = await state.host.url();
        await probe(url);
        state.url = url;
        onPhase?.('generation-web-ready');
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
        onPhase?.('generation-window-ready');
      },
      async rendererReady() {
        if (!windowRef) fail('BrowserWindow 尚未创建', 'GENERATION_CONFIG');
        await windowRef.waitForBootReport();
        onPhase?.('generation-renderer-ready');
      },
      async interactionReady(generation) {
        const state = generationStates.get(generation);
        if (!state || !windowRef) fail('generation window 状态缺失', 'GENERATION_CONFIG');
        await state.host.registerInteractiveCommands();
        windowRef.show();
        onPhase?.('generation-interaction-ready');
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
  return Object.freeze({
    manager,
    start: () => manager.select(initialProfile),
    show: () => windowRef?.show(),
    hide: () => manager.hideWindow(),
    retry: () => manager.retry(),
    exit: () => manager.dispose('explicit-exit'),
    signal: (signal: string) => manager.signal(signal),
  });
}
