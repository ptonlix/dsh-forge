import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse as parseYaml } from 'yaml';

const EXACT_SEMVER_PATTERN = new RegExp(
  '^(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)' +
    '(?:-[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$',
);

export interface FullPackageReleaseUrls {
  readonly windows: string;
  readonly macos: string;
  readonly ubuntu: string;
}

export interface FullPackageVersionManifest {
  readonly windows: { readonly build: number; readonly version: string; readonly url: string };
  readonly macos: { readonly build: number; readonly version: string; readonly url: string };
  readonly ubuntu: { readonly build: number; readonly version: string; readonly url: string };
}

export const GITHUB_RELEASE_REPOSITORY = 'ptonlix/dsh-forge';

/** 为同一个 GitHub Release 生成稳定的、平台无关的 OTA 资产地址。 */
export function fullPackageReleaseUrls(
  version: string,
  repository = GITHUB_RELEASE_REPOSITORY,
): FullPackageReleaseUrls {
  const tag = encodeURIComponent(`v${version}`);
  const base = `https://github.com/${repository}/releases/download/${tag}`;
  return Object.freeze({
    windows: `${base}/dsh-forge-windows.exe`,
    macos: `${base}/dsh-forge-macos.dmg`,
    ubuntu: `${base}/dsh-forge-ubuntu.AppImage`,
  });
}

function assertVersion(version: unknown): asserts version is string {
  if (typeof version !== 'string' || !EXACT_SEMVER_PATTERN.test(version))
    throw new Error('version.json 的 version 必须是精确 SemVer');
}

function assertBuild(build: unknown): asserts build is number {
  if (typeof build !== 'number' || !Number.isSafeInteger(build) || build < 1)
    throw new Error('version.json 的 build 必须是正安全整数');
}

function assertReleaseAssetUrl(url: string, extension: string): void {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !parsed.pathname.endsWith(extension))
    throw new Error(`version.json Release 资产 URL 无效: ${extension}`);
}

/** 仅校验 GitHub Release 安装包 URL 的 HTTPS/扩展名配置事实，不在生成阶段请求网络。 */
export function createFullPackageVersionManifest(
  version: unknown,
  build: unknown,
  urls?: FullPackageReleaseUrls,
): FullPackageVersionManifest {
  assertVersion(version);
  assertBuild(build);
  const releaseUrls = urls || fullPackageReleaseUrls(version);
  assertReleaseAssetUrl(releaseUrls.windows, '.exe');
  assertReleaseAssetUrl(releaseUrls.macos, '.dmg');
  assertReleaseAssetUrl(releaseUrls.ubuntu, '.AppImage');
  return Object.freeze({
    windows: Object.freeze({ version, build, url: releaseUrls.windows }),
    macos: Object.freeze({ version, build, url: releaseUrls.macos }),
    ubuntu: Object.freeze({ version, build, url: releaseUrls.ubuntu }),
  });
}

function projectRoot(): string {
  return path.resolve(__dirname, '..');
}

function rootVersionAndBuild(root: string): { readonly version: unknown; readonly build: unknown } {
  const distribution = parseYaml(fs.readFileSync(path.join(root, 'distribution.yml'), 'utf8')) as { readonly version?: unknown };
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { readonly dshForgeBuild?: unknown };
  return { version: distribution?.version, build: packageJson?.dshForgeBuild };
}

function outputArgument(arguments_: readonly string[]): string {
  const index = arguments_.indexOf('--output');
  if (index < 0 || !arguments_[index + 1]) throw new Error('缺少 --output');
  return path.resolve(arguments_[index + 1]!);
}

function main(): void {
  const root = projectRoot();
  const { version, build } = rootVersionAndBuild(root);
  const manifest = createFullPackageVersionManifest(version, build);
  fs.writeFileSync(outputArgument(process.argv.slice(2)), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
}

if (/create-version-manifest\.(?:ts|js)$/.test(path.basename(process.argv[1] || ''))) {
  try {
    main();
  } catch (error: unknown) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
