import * as fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { compare as compareSemVer, parse as parseSemVer } from 'semver';
import { fail, ForgeError } from './errors.ts';
import type { GenerationLike } from './types.ts';

export const FULL_PACKAGE_UPDATE_MANIFEST_URL =
  'https://github.com/ptonlix/dsh-forge/releases/latest/download/version.json';

const EXACT_SEMVER_PATTERN = new RegExp(
  '^(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)' +
    '(?:-[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$',
);

export type FullPackageUpdatePlatform = 'windows' | 'macos' | 'ubuntu';

export interface FullPackageUpdate {
  readonly platform: FullPackageUpdatePlatform;
  readonly version: string;
  readonly build: number;
  readonly url: string;
}

export type FullPackageUpdateCheck =
  | Readonly<{ readonly kind: 'available'; readonly update: FullPackageUpdate }>
  | Readonly<{ readonly kind: 'current' }>
  | Readonly<{ readonly kind: 'unsupported' }>
  | Readonly<{ readonly kind: 'error'; readonly code: string }>;

export interface FullPackageUpdater {
  isSupported(): boolean;
  check(signal?: AbortSignal): Promise<FullPackageUpdateCheck>;
  download(update: FullPackageUpdate, signal?: AbortSignal): Promise<string>;
  cancel(): void;
  discard(stagedPackage: string): Promise<void>;
}

export interface FullPackageUpdaterOptions {
  readonly generation: GenerationLike;
  readonly userData: string;
  readonly appVersion: string;
  readonly packageJsonPath: string;
  readonly platform?: NodeJS.Platform;
  readonly environment?: NodeJS.ProcessEnv;
  readonly fetch?: typeof globalThis.fetch;
  readonly readOsRelease?: () => string;
}

interface VersionManifestEntry {
  readonly version: string;
  readonly build: number;
  readonly url: string;
}

interface VersionManifest {
  readonly windows: VersionManifestEntry;
  readonly macos: VersionManifestEntry;
  readonly ubuntu: VersionManifestEntry;
}

interface UpdateTarget {
  readonly platform: FullPackageUpdatePlatform;
  readonly appImagePath?: string;
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function assertExactSemVer(value: unknown, code: string): asserts value is string {
  if (typeof value !== 'string' || !EXACT_SEMVER_PATTERN.test(value) || !parseSemVer(value, { loose: false }))
    fail('版本必须是精确 SemVer', code);
}

function assertPositiveBuild(value: unknown, code: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) fail('build 必须是正安全整数', code);
}

function extensionFor(platform: FullPackageUpdatePlatform): string {
  if (platform === 'windows') return '.exe';
  if (platform === 'macos') return '.dmg';
  return '.AppImage';
}

function assertHttpsUrl(value: unknown, platform: FullPackageUpdatePlatform): asserts value is string {
  if (typeof value !== 'string') fail('更新 URL 必须是 HTTPS 地址', 'OTA_MANIFEST_INVALID');
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    fail('更新 URL 必须是 HTTPS 地址', 'OTA_MANIFEST_INVALID');
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    !parsed.hostname ||
    !parsed.pathname.endsWith(extensionFor(platform))
  )
    fail('更新 URL 与平台安装包格式不匹配', 'OTA_MANIFEST_INVALID');
}

function parseManifestEntry(value: unknown, platform: FullPackageUpdatePlatform): VersionManifestEntry {
  const entry = object(value);
  if (!entry || !hasOnlyKeys(entry, ['version', 'build', 'url'])) fail('version.json 平台条目无效', 'OTA_MANIFEST_INVALID');
  assertExactSemVer(entry.version, 'OTA_MANIFEST_INVALID');
  assertPositiveBuild(entry.build, 'OTA_MANIFEST_INVALID');
  assertHttpsUrl(entry.url, platform);
  return Object.freeze({ version: entry.version, build: entry.build, url: entry.url });
}

export function parseFullPackageVersionManifest(value: unknown): VersionManifest {
  const manifest = object(value);
  if (!manifest || !hasOnlyKeys(manifest, ['windows', 'macos', 'ubuntu']))
    fail('version.json 必须包含且仅包含 windows、macos、ubuntu', 'OTA_MANIFEST_INVALID');
  return Object.freeze({
    windows: parseManifestEntry(manifest.windows, 'windows'),
    macos: parseManifestEntry(manifest.macos, 'macos'),
    ubuntu: parseManifestEntry(manifest.ubuntu, 'ubuntu'),
  });
}

export function readDshForgeBuild(packageJsonPath: string): number {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as unknown;
  } catch {
    fail('应用 package.json 无法读取', 'OTA_LOCAL_BUILD_INVALID');
  }
  const manifest = object(parsed);
  if (!manifest) fail('应用 package.json 无效', 'OTA_LOCAL_BUILD_INVALID');
  assertPositiveBuild(manifest.dshForgeBuild, 'OTA_LOCAL_BUILD_INVALID');
  return manifest.dshForgeBuild;
}

function osReleaseValue(source: string, key: string): string | null {
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || match[1] !== key) continue;
    const raw = match[2] || '';
    if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) return raw.slice(1, -1);
    return raw;
  }
  return null;
}

function isUbuntu2204OrLater(source: string): boolean {
  if (osReleaseValue(source, 'ID') !== 'ubuntu') return false;
  const version = osReleaseValue(source, 'VERSION_ID');
  const match = version?.match(/^(\d+)\.(\d+)$/);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 22 || (major === 22 && minor >= 4);
}

function writableAppImage(value: string | undefined): string | null {
  if (!value || !path.isAbsolute(value)) return null;
  try {
    const stat = fs.lstatSync(value);
    if (!stat.isFile()) return null;
    fs.accessSync(value, fs.constants.W_OK);
    return path.resolve(value);
  } catch {
    return null;
  }
}

function resolveUpdateTarget(options: FullPackageUpdaterOptions): UpdateTarget | null {
  const platform = options.platform || process.platform;
  if (platform === 'win32') return Object.freeze({ platform: 'windows' });
  if (platform === 'darwin') return Object.freeze({ platform: 'macos' });
  if (platform !== 'linux') return null;
  let osRelease: string;
  try {
    osRelease = options.readOsRelease ? options.readOsRelease() : fs.readFileSync('/etc/os-release', 'utf8');
  } catch {
    return null;
  }
  if (!isUbuntu2204OrLater(osRelease)) return null;
  const appImagePath = writableAppImage(options.environment?.APPIMAGE ?? process.env.APPIMAGE);
  return appImagePath ? Object.freeze({ platform: 'ubuntu', appImagePath }) : null;
}

function assertGenerationOpen(generation: GenerationLike): void {
  if (generation.closed) fail('generation 已关闭，不能执行安装包升级', 'GENERATION_CLOSED');
}

function updateIsNewer(remote: VersionManifestEntry, currentVersion: string, currentBuild: number): boolean {
  const versionComparison = compareSemVer(remote.version, currentVersion);
  return versionComparison > 0 || (versionComparison === 0 && remote.build > currentBuild);
}

function diagnosticCode(error: unknown): string {
  return error instanceof ForgeError ? error.code : 'OTA_CHECK_FAILED';
}

function assertDownloadTarget(update: FullPackageUpdate): void {
  if (!['windows', 'macos', 'ubuntu'].includes(update.platform)) fail('更新平台无效', 'OTA_DOWNLOAD_INVALID');
  assertExactSemVer(update.version, 'OTA_DOWNLOAD_INVALID');
  assertPositiveBuild(update.build, 'OTA_DOWNLOAD_INVALID');
  assertHttpsUrl(update.url, update.platform);
}

function controlledPackageName(platform: FullPackageUpdatePlatform): string {
  return `package-${randomUUID()}${extensionFor(platform)}`;
}

function removeIfPresent(file: string): Promise<void> {
  return fsPromises.rm(file, { force: true }).catch(() => undefined);
}

/**
 * 私有 OTA 下载器只产生已关闭的受控暂存文件。Electron 确认、退出和安装器执行均由
 * apps/desktop 持有，避免把原生能力暴露给 Cordis bundle 或 renderer。
 */
export function createFullPackageUpdater(options: FullPackageUpdaterOptions): FullPackageUpdater {
  if (!path.isAbsolute(options.userData)) fail('OTA 用户数据目录必须是绝对路径', 'OTA_CONFIG');
  if (!path.isAbsolute(options.packageJsonPath)) fail('OTA package.json 路径必须是绝对路径', 'OTA_CONFIG');
  const fetchImplementation = options.fetch || globalThis.fetch;
  const activeAborts = new Set<AbortController>();

  const check = async (signal?: AbortSignal): Promise<FullPackageUpdateCheck> => {
    assertGenerationOpen(options.generation);
    const target = resolveUpdateTarget(options);
    if (!target) return Object.freeze({ kind: 'unsupported' });
    const controller = new AbortController();
    activeAborts.add(controller);
    const abortFromCaller = (): void => controller.abort();
    signal?.addEventListener('abort', abortFromCaller, { once: true });
    // manifest 请求可能在 response.text() 阶段持续；generation 关闭时也必须
    // 立即中止，不能等到下一次启动或垃圾回收才结束网络资源。
    const generationWatch = setInterval(() => {
      if (options.generation.closed) controller.abort();
    }, 100);
    try {
      if (signal?.aborted) controller.abort();
      assertExactSemVer(options.appVersion, 'OTA_LOCAL_VERSION_INVALID');
      const build = readDshForgeBuild(options.packageJsonPath);
      const response = await fetchImplementation(FULL_PACKAGE_UPDATE_MANIFEST_URL, {
        // GitHub Release 的 latest/download 与版本化资产地址会先返回 302，再落到实际文件；
        // 使用 fetch 的受控跟随策略，避免把正常的 Release 重定向误报为 OTA_CHECK_FAILED。
        redirect: 'follow',
        signal: controller.signal,
      });
      if (controller.signal.aborted) return Object.freeze({ kind: 'error', code: 'OTA_CHECK_CANCELLED' });
      if (!response.ok) fail('version.json 请求失败', 'OTA_MANIFEST_FETCH_FAILED');
      let source: unknown;
      try {
        source = JSON.parse(await response.text()) as unknown;
      } catch {
        fail('version.json 不是有效 JSON', 'OTA_MANIFEST_INVALID');
      }
      if (controller.signal.aborted) return Object.freeze({ kind: 'error', code: 'OTA_CHECK_CANCELLED' });
      assertGenerationOpen(options.generation);
      const entry = parseFullPackageVersionManifest(source)[target.platform];
      if (!updateIsNewer(entry, options.appVersion, build)) return Object.freeze({ kind: 'current' });
      return Object.freeze({
        kind: 'available',
        update: Object.freeze({
          platform: target.platform,
          version: entry.version,
          build: entry.build,
          url: entry.url,
        }),
      });
    } catch (error: unknown) {
      if (options.generation.closed) fail('generation 已关闭，版本清单检查已停止', 'GENERATION_CLOSED');
      if (controller.signal.aborted) return Object.freeze({ kind: 'error', code: 'OTA_CHECK_CANCELLED' });
      return Object.freeze({ kind: 'error', code: diagnosticCode(error) });
    } finally {
      clearInterval(generationWatch);
      signal?.removeEventListener('abort', abortFromCaller);
      activeAborts.delete(controller);
    }
  };

  const download = async (update: FullPackageUpdate, signal?: AbortSignal): Promise<string> => {
    assertGenerationOpen(options.generation);
    assertDownloadTarget(update);
    const target = resolveUpdateTarget(options);
    if (!target || target.platform !== update.platform) fail('更新平台与当前运行环境不匹配', 'OTA_DOWNLOAD_INVALID');
    const controller = new AbortController();
    activeAborts.add(controller);
    const abortFromCaller = (): void => controller.abort();
    signal?.addEventListener('abort', abortFromCaller, { once: true });
    const stagingDirectory = path.join(path.resolve(options.userData), 'dsh-forge', 'ota');
    const stagedPackage = path.join(stagingDirectory, controlledPackageName(update.platform));
    const partialPackage = `${stagedPackage}.partial`;
    const generationWatch = setInterval(() => {
      if (options.generation.closed) controller.abort();
    }, 100);
    try {
      if (signal?.aborted) controller.abort();
      await fsPromises.mkdir(stagingDirectory, { recursive: true, mode: 0o700 });
      if (controller.signal.aborted) fail('完整安装包下载已取消', 'OTA_DOWNLOAD_CANCELLED');
      // GitHub Release 资产同样通过重定向交付到对象存储，必须允许 fetch 跟随该跳转。
      const response = await fetchImplementation(update.url, { redirect: 'follow', signal: controller.signal });
      if (!response.ok || !response.body) fail('完整安装包下载失败', 'OTA_DOWNLOAD_FAILED');
      const expectedLength = response.headers.get('content-length');
      if (expectedLength && (!/^\d+$/.test(expectedLength) || Number(expectedLength) < 1))
        fail('完整安装包响应长度无效', 'OTA_DOWNLOAD_FAILED');
      let received = 0;
      const source = Readable.fromWeb(response.body as never).on('data', (chunk: Buffer) => {
        received += chunk.length;
      });
      await pipeline(source, fs.createWriteStream(partialPackage, { flags: 'wx', mode: 0o600 }));
      if (expectedLength && received !== Number(expectedLength)) fail('完整安装包下载不完整', 'OTA_DOWNLOAD_FAILED');
      if (received < 1) fail('完整安装包为空', 'OTA_DOWNLOAD_FAILED');
      assertGenerationOpen(options.generation);
      await fsPromises.rename(partialPackage, stagedPackage);
      await fsPromises.chmod(stagedPackage, 0o600);
      return stagedPackage;
    } catch (error: unknown) {
      await Promise.all([removeIfPresent(partialPackage), removeIfPresent(stagedPackage)]);
      if (options.generation.closed) fail('generation 已关闭，完整安装包下载已停止', 'GENERATION_CLOSED');
      if (controller.signal.aborted) fail('完整安装包下载已取消', 'OTA_DOWNLOAD_CANCELLED');
      if (error instanceof ForgeError) throw error;
      fail('完整安装包下载失败', 'OTA_DOWNLOAD_FAILED');
    } finally {
      clearInterval(generationWatch);
      signal?.removeEventListener('abort', abortFromCaller);
      activeAborts.delete(controller);
    }
  };

  return Object.freeze({
    isSupported: () => resolveUpdateTarget(options) !== null,
    check,
    download,
    cancel: () => {
      for (const controller of activeAborts) controller.abort();
    },
    discard: async (stagedPackage: string): Promise<void> => {
      const root = path.resolve(options.userData, 'dsh-forge', 'ota');
      const candidate = path.resolve(stagedPackage);
      const relative = path.relative(root, candidate);
      if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
        fail('OTA 暂存文件路径无效', 'OTA_STAGING_PATH');
      await removeIfPresent(candidate);
    },
  });
}
