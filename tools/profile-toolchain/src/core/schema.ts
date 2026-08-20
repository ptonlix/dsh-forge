import * as fs from 'node:fs';
import * as path from 'node:path';
import { readYaml } from './yaml.ts';
import { ForgeError, fail } from './errors.ts';
import { RUNTIME_MATRIX } from './versions.ts';

/**
 * 发行版、profile、bundle 和 catalog 的唯一输入校验边界。
 *
 * 本模块不从调用方继承“文件内容已经可信”的假设：所有 YAML/JSON 字段
 * 都先按 unknown 读取，再检查字段集合、固定版本、身份、依赖来源和运行时矩阵。
 * 解析成功后返回的对象才可以进入 compiler、composer 和 release 流程。
 */

export type Architecture = 'arm64' | 'x64' | 'ia32';
export type Platform = 'darwin' | 'win32' | 'linux';
export type ReleaseChannel = 'stable' | 'beta' | 'nightly';

export interface RuntimePlatform {
  readonly os: Platform;
  readonly architectures: readonly Architecture[];
}

export interface Distribution {
  readonly schema: string;
  readonly id: string;
  readonly name: string;
  readonly packageScope: string;
  readonly applicationId: string;
  readonly version: string;
  readonly defaultProfile: string;
  readonly channel: ReleaseChannel;
  readonly platforms: readonly RuntimePlatform[];
  readonly updates: Readonly<{
    enabled: boolean;
    channel: ReleaseChannel;
    metadataUrl: string | null;
    trustRoot: string | null;
  }>;
  readonly branding: Readonly<{ productName: string; publisher: string | null }>;
  readonly sourceFile: string;
  readonly identity: DistributionIdentity;
}

export interface DistributionIdentity {
  readonly id: string;
  readonly name: string;
  readonly packageScope: string;
  readonly applicationId: string;
  readonly version: string;
  readonly defaultProfile: string;
  readonly channel: ReleaseChannel;
  readonly platforms: readonly RuntimePlatform[];
  readonly branding: Distribution['branding'];
  readonly updates: Distribution['updates'];
}

export interface ProfileRuntime {
  readonly dshPackageFamily: string;
  readonly dshVersion: string;
  readonly cordisVersion: string;
  readonly desktopProtocol: number;
  readonly electronVersion: string;
  readonly nodeEngine: string;
}

export interface Profile {
  readonly schema: string;
  readonly name: string;
  readonly runtime: ProfileRuntime;
  readonly bundles: readonly string[];
  readonly sourceFile: string;
  readonly patchFile: string;
}

export interface PackageSource {
  readonly kind: 'workspace' | 'installed';
  readonly path: string;
  readonly integrity: string;
}

export interface BundleManifest {
  readonly name: string;
  readonly version: string;
  readonly license: string;
  readonly patchFile: string;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly peerDependencies: Readonly<Record<string, string>>;
  readonly scripts: Readonly<Record<string, string>>;
  readonly allowBuilds: readonly string[];
  readonly sourceDirectory: string;
  readonly packageFile: string;
}

export interface CatalogEntry {
  readonly schema: 'dsh-forge/catalog@1';
  readonly id: string;
  readonly tier: 'L0' | 'L1' | 'L2';
  readonly packageName: string;
  readonly version: string;
  readonly source: Readonly<Record<string, unknown>> & { readonly kind: 'npm' | 'git' | 'workspace' };
  readonly integrity?: string;
  readonly license?: string;
  readonly maintainer?: string;
  readonly dependencies?: readonly unknown[];
  readonly scripts?: readonly unknown[];
  readonly capabilities?: readonly unknown[];
  readonly verifiedOn?: readonly unknown[];
  readonly verifiedAt?: string;
  readonly executionMode: 'trusted-in-process';
  readonly hostSupport: readonly unknown[];
  readonly pluginRequest: readonly unknown[];
  readonly grant: string;
  readonly audit: string;
  readonly enforcement: 'unavailable';
}

interface DistributionInput extends Record<string, unknown> {
  schema?: unknown;
  id?: unknown;
  name?: unknown;
  packageScope?: unknown;
  applicationId?: unknown;
  version?: unknown;
  defaultProfile?: unknown;
  channel?: unknown;
  platforms?: unknown;
  updates?: unknown;
  branding?: unknown;
}

interface ProfileInput extends Record<string, unknown> {
  schema?: unknown;
  name?: unknown;
  runtime?: unknown;
  bundles?: unknown;
}

interface ProfileRuntimeInput extends Record<string, unknown> {
  dshPackageFamily?: unknown;
  dshVersion?: unknown;
  cordisVersion?: unknown;
  desktopProtocol?: unknown;
  electronVersion?: unknown;
  nodeEngine?: unknown;
}

interface BundlePackage extends Record<string, unknown> {
  name?: unknown;
  version?: unknown;
  license?: unknown;
  dsh?: unknown;
  dependencies?: unknown;
  optionalDependencies?: unknown;
  peerDependencies?: unknown;
  scripts?: unknown;
  pnpm?: unknown;
  allowBuilds?: unknown;
}

const IDENTIFIER = /^[a-z][a-z0-9-]{1,63}$/;
const PACKAGE = /^@[a-z0-9._-]+\/[a-z0-9._-]+$/;
const NPM_PACKAGE = /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/;
const VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const SUPPORTED_SCHEMA = /^dsh-forge\/(distribution|profile)@1$/;

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} 必须是对象`, 'SCHEMA_TYPE');
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) fail(`${label} 包含未知字段: ${key}`, 'SCHEMA_UNKNOWN_FIELD', { key });
}
function required(value: Record<string, unknown>, fields: readonly string[], label: string): void {
  for (const field of fields)
    if (value[field] === undefined || value[field] === null || value[field] === '')
      fail(`${label} 缺少必填字段: ${field}`, 'SCHEMA_REQUIRED', { field });
}
function version(value: unknown, label: string): void {
  if (typeof value !== 'string' || !VERSION.test(value)) fail(`${label} 不是固定语义版本: ${value}`, 'SCHEMA_VERSION');
}
function packageName(value: unknown, label: string): void {
  if (typeof value !== 'string' || !PACKAGE.test(value)) fail(`${label} 不是作用域包名: ${value}`, 'SCHEMA_IDENTIFIER');
}
function npmPackageName(value: unknown, label: string): void {
  if (typeof value !== 'string' || !NPM_PACKAGE.test(value))
    fail(`${label} 不是合法 npm 包名: ${value}`, 'SCHEMA_IDENTIFIER');
}
function identifier(value: unknown, label: string): void {
  if (typeof value !== 'string' || !IDENTIFIER.test(value))
    fail(`${label} 不是合法标识: ${value}`, 'SCHEMA_IDENTIFIER');
}

/** 解析并验证发行版身份、平台、更新信任配置及默认 profile 存在性。 */
export function parseDistribution(file: string, { profilesRoot }: { profilesRoot?: string } = {}): Distribution {
  const source = object(readYaml(file), 'distribution.yml') as DistributionInput;
  keys(
    source,
    [
      'schema',
      'id',
      'name',
      'packageScope',
      'applicationId',
      'version',
      'defaultProfile',
      'channel',
      'platforms',
      'updates',
      'branding',
    ],
    'distribution.yml',
  );
  required(
    source,
    ['schema', 'id', 'name', 'packageScope', 'applicationId', 'version', 'defaultProfile', 'platforms'],
    'distribution.yml',
  );
  if (
    typeof source.schema !== 'string' ||
    !SUPPORTED_SCHEMA.test(source.schema) ||
    !source.schema.startsWith('dsh-forge/distribution@')
  )
    fail(`不支持的 distribution schema: ${source.schema}`, 'SCHEMA_UNSUPPORTED');
  identifier(source.id, 'distribution.id');
  identifier(source.defaultProfile, 'distribution.defaultProfile');
  version(String(source.version), 'distribution.version');
  if (typeof source.name !== 'string' || source.name.length < 1) fail('distribution.name 无效', 'SCHEMA_VALUE');
  if (typeof source.packageScope !== 'string' || !/^@[a-z0-9._-]+$/.test(source.packageScope))
    fail(`packageScope 无效: ${source.packageScope}`, 'SCHEMA_IDENTIFIER');
  if (typeof source.applicationId !== 'string' || !/^ai\.[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(source.applicationId))
    fail(`applicationId 无效: ${source.applicationId}`, 'SCHEMA_IDENTIFIER');
  if (
    source.channel !== undefined &&
    (typeof source.channel !== 'string' || !['stable', 'beta', 'nightly'].includes(source.channel))
  )
    fail(`channel 无效: ${source.channel}`, 'SCHEMA_VALUE');
  if (!Array.isArray(source.platforms) || source.platforms.length === 0)
    fail('platforms 至少声明一个目标', 'SCHEMA_REQUIRED');
  const platforms = (source.platforms as unknown[])
    .map((item, index) => {
      const platform = object(item, `platforms[${index}]`);
      keys(platform, ['os', 'architectures'], `platforms[${index}]`);
      required(platform, ['os', 'architectures'], `platforms[${index}]`);
      if (typeof platform.os !== 'string' || !['darwin', 'win32', 'linux'].includes(platform.os))
        fail(`不支持的平台: ${platform.os}`, 'SCHEMA_VALUE');
      if (
        !Array.isArray(platform.architectures) ||
        platform.architectures.some(
          (architecture) => typeof architecture !== 'string' || !['arm64', 'x64', 'ia32'].includes(architecture),
        )
      )
        fail(`平台架构无效: ${platform.os}`, 'SCHEMA_VALUE');
      return {
        os: platform.os as Platform,
        architectures: [...new Set(platform.architectures as Architecture[])].sort(),
      } satisfies RuntimePlatform;
    })
    .sort((a, b) => a.os.localeCompare(b.os));
  const updates =
    source.updates === undefined
      ? ({ enabled: false } as Record<string, unknown>)
      : object(source.updates, 'distribution.updates');
  if (source.updates !== undefined) {
    keys(updates, ['enabled', 'channel', 'metadataUrl', 'trustRoot'], 'distribution.updates');
    required(updates, ['enabled'], 'distribution.updates');
    if (updates.enabled === true) {
      required(updates, ['channel', 'metadataUrl', 'trustRoot'], 'distribution.updates');
      if (typeof updates.metadataUrl !== 'string' || !/^https?:\/\//.test(updates.metadataUrl))
        fail('updates.metadataUrl 必须是 HTTP(S)', 'SCHEMA_VALUE');
    }
  }
  const branding =
    source.branding === undefined ? ({} as Record<string, unknown>) : object(source.branding, 'distribution.branding');
  keys(branding, ['productName', 'publisher'], 'distribution.branding');
  if (profilesRoot && !fs.existsSync(path.join(profilesRoot, source.defaultProfile as string, 'profile.yml')))
    fail(`默认 profile 无法解析: ${source.defaultProfile}`, 'DEFAULT_PROFILE_MISSING');
  const normalized: Omit<Distribution, 'identity'> = {
    schema: source.schema as string,
    id: source.id as string,
    name: source.name as string,
    packageScope: source.packageScope as string,
    applicationId: source.applicationId as string,
    version: String(source.version),
    defaultProfile: source.defaultProfile as string,
    channel: (source.channel || 'stable') as ReleaseChannel,
    platforms,
    updates: {
      enabled: Boolean(updates.enabled),
      channel: (updates.channel || source.channel || 'stable') as ReleaseChannel,
      metadataUrl: typeof updates.metadataUrl === 'string' ? updates.metadataUrl : null,
      trustRoot: typeof updates.trustRoot === 'string' ? updates.trustRoot : null,
    },
    branding: {
      productName: typeof branding.productName === 'string' ? branding.productName : (source.name as string),
      publisher: typeof branding.publisher === 'string' ? branding.publisher : null,
    },
    sourceFile: path.resolve(file),
  };
  return Object.freeze({ ...normalized, identity: projectDistributionIdentity(normalized) });
}

/** 提取可写入产物和更新元数据的稳定发行版身份快照。 */
export function projectDistributionIdentity(
  distribution: Omit<Distribution, 'identity'> | Distribution,
): DistributionIdentity {
  const identity = {
    id: distribution.id,
    name: distribution.name,
    packageScope: distribution.packageScope,
    applicationId: distribution.applicationId,
    version: String(distribution.version),
    defaultProfile: distribution.defaultProfile,
    channel: distribution.channel,
    platforms: Object.freeze(
      distribution.platforms.map((platform) =>
        Object.freeze({ os: platform.os, architectures: Object.freeze(platform.architectures.slice()) }),
      ),
    ),
    branding: Object.freeze({ ...distribution.branding }),
    updates: Object.freeze({ ...distribution.updates }),
  };
  return Object.freeze(identity);
}

/** 解析 profile runtime 矩阵和 bundle 列表，并拒绝 launcher 所有的 desktop layer。 */
export function parseProfile(file: string): Profile {
  const source = object(readYaml(file), 'profile.yml') as ProfileInput;
  if (Object.hasOwn(source, 'plugins'))
    fail('profile.yml 禁止顶层 plugins；请通过 bundle 表达插件', 'SCHEMA_FORBIDDEN_FIELD');
  keys(source, ['schema', 'name', 'runtime', 'bundles'], 'profile.yml');
  required(source, ['schema', 'name', 'runtime', 'bundles'], 'profile.yml');
  if (typeof source.schema !== 'string' || !/^dsh-forge\/profile@1$/.test(source.schema))
    fail(`不支持的 profile schema: ${source.schema}`, 'SCHEMA_UNSUPPORTED');
  identifier(source.name, 'profile.name');
  const runtime = object(source.runtime, 'profile.runtime') as ProfileRuntimeInput;
  keys(
    runtime,
    ['dshPackageFamily', 'dshVersion', 'cordisVersion', 'desktopProtocol', 'electronVersion', 'nodeEngine'],
    'profile.runtime',
  );
  required(
    runtime,
    ['dshPackageFamily', 'dshVersion', 'cordisVersion', 'desktopProtocol', 'electronVersion', 'nodeEngine'],
    'profile.runtime',
  );
  packageName(runtime.dshPackageFamily, 'profile.runtime.dshPackageFamily');
  version(runtime.dshVersion, 'profile.runtime.dshVersion');
  version(runtime.cordisVersion, 'profile.runtime.cordisVersion');
  version(runtime.electronVersion, 'profile.runtime.electronVersion');
  if (!Number.isInteger(runtime.desktopProtocol) || (runtime.desktopProtocol as number) < 1)
    fail('desktopProtocol 无效', 'SCHEMA_VALUE');
  if (typeof runtime.nodeEngine !== 'string' || !runtime.nodeEngine.startsWith('>='))
    fail('nodeEngine 必须声明最低版本', 'SCHEMA_VALUE');
  if (!Array.isArray(source.bundles) || source.bundles.length === 0)
    fail('profile.bundles 至少包含一个 bundle', 'SCHEMA_REQUIRED');
  for (const field of [
    'dshPackageFamily',
    'dshVersion',
    'cordisVersion',
    'electronVersion',
    'nodeEngine',
    'desktopProtocol',
  ] as const)
    if (runtime[field] !== RUNTIME_MATRIX[field])
      fail(`runtime.${field} 与首版矩阵不一致: ${runtime[field]}`, 'RUNTIME_MATRIX_DRIFT');
  const bundles = (source.bundles as unknown[]).map((name, index): string => {
    packageName(name, `profile.bundles[${index}]`);
    return name as string;
  });
  if (new Set(bundles).size !== bundles.length) fail('profile.bundles 不允许重复 bundle', 'SCHEMA_DUPLICATE');
  if (bundles.includes('@dsh-forge/desktop-layer'))
    fail('desktop layer 由 launcher 临时注入，不得写入 profile.bundles', 'DESKTOP_LAYER_OWNERSHIP');
  return {
    schema: source.schema as string,
    name: source.name as string,
    runtime: {
      dshPackageFamily: runtime.dshPackageFamily as string,
      dshVersion: String(runtime.dshVersion),
      cordisVersion: String(runtime.cordisVersion),
      desktopProtocol: runtime.desktopProtocol as number,
      electronVersion: String(runtime.electronVersion),
      nodeEngine: runtime.nodeEngine as string,
    },
    bundles,
    sourceFile: path.resolve(file),
    patchFile: path.join(path.dirname(file), 'cordis.patch.yml'),
  };
}

function stringRecord(value: unknown): Record<string, string> {
  if (value === undefined) return {};
  const record = object(value, 'package.json 字段');
  const normalized: Record<string, string> = {};
  for (const [key, item] of Object.entries(record)) {
    if (typeof item !== 'string') fail(`package.json 字段 ${key} 必须是字符串`, 'SCHEMA_TYPE');
    normalized[key] = item;
  }
  return normalized;
}

/** 解析 bundle package.json，验证 patch、依赖来源、生命周期脚本和构建授权。 */
export function parseBundleManifest(directory: string): BundleManifest {
  const packageFile = path.join(directory, 'package.json');
  if (!fs.existsSync(packageFile)) fail(`bundle 缺少 package.json: ${directory}`, 'BUNDLE_REQUIRED');
  const pkg = object(JSON.parse(fs.readFileSync(packageFile, 'utf8')), `${directory}/package.json`) as BundlePackage;
  required(pkg, ['name', 'version', 'license', 'dsh'], `${directory}/package.json`);
  packageName(pkg.name, 'bundle.name');
  version(pkg.version, 'bundle.version');
  const dsh = pkg.dsh !== undefined ? object(pkg.dsh, 'bundle.dsh') : null;
  const bundle = dsh?.bundle !== undefined ? object(dsh.bundle, 'bundle.dsh.bundle') : null;
  if (!bundle || typeof bundle.patch !== 'string')
    fail(`bundle ${pkg.name} 缺少 dsh.bundle.patch`, 'BUNDLE_PATCH_REQUIRED');
  const patchFile = path.resolve(directory, bundle.patch);
  if (!fs.existsSync(patchFile)) fail(`bundle patch 不存在: ${patchFile}`, 'BUNDLE_PATCH_REQUIRED');
  if (typeof pkg.license !== 'string' || !pkg.license.trim())
    fail(`bundle ${pkg.name} 缺少许可证`, 'BUNDLE_LICENSE_REQUIRED');
  const dependencies = { ...stringRecord(pkg.dependencies), ...stringRecord(pkg.optionalDependencies) };
  for (const [name, dep] of Object.entries(dependencies)) {
    npmPackageName(name, `bundle.dependencies.${name}`);
    if (typeof dep !== 'string' || !dep) fail(`依赖版本无效: ${name}`, 'BUNDLE_SOURCE_INVALID');
  }
  const gitDependencies = Object.entries(dependencies).filter(([, spec]) =>
    /^(?:github:|git\+|https?:\/\/.*\.git)/.test(spec),
  );
  for (const [name, spec] of gitDependencies) {
    const match = spec.match(/#([0-9a-f]{40})(?:&path:(.+))?$/i);
    if (!match) fail(`Git 依赖 ${name} 必须固定完整 commit: ${spec}`, 'BUNDLE_SOURCE_FLOATING', { name, spec });
  }
  return {
    name: pkg.name as string,
    version: pkg.version as string,
    license: pkg.license as string,
    patchFile,
    dependencies,
    peerDependencies: stringRecord(pkg.peerDependencies),
    scripts: stringRecord(pkg.scripts),
    allowBuilds: (() => {
      const pnpm = pkg.pnpm !== undefined ? object(pkg.pnpm, 'bundle.pnpm') : {};
      const candidate = pnpm.allowBuilds ?? pkg.allowBuilds ?? [];
      if (!Array.isArray(candidate) || candidate.some((entry) => typeof entry !== 'string'))
        fail('bundle allowBuilds 必须是字符串数组', 'SCHEMA_TYPE');
      return candidate as string[];
    })(),
    sourceDirectory: path.resolve(directory),
    packageFile,
  };
}

/** 验证静态 catalog 条目；返回值可直接用于审计、授权确认和重新审计比较。 */
export function parseCatalogEntry(input: unknown): CatalogEntry {
  const entry = object(input, 'catalog entry');
  keys(
    entry,
    [
      'schema',
      'id',
      'tier',
      'packageName',
      'version',
      'source',
      'integrity',
      'license',
      'maintainer',
      'dependencies',
      'scripts',
      'capabilities',
      'verifiedOn',
      'verifiedAt',
      'executionMode',
      'hostSupport',
      'pluginRequest',
      'grant',
      'audit',
      'enforcement',
    ],
    'catalog entry',
  );
  required(
    entry,
    [
      'schema',
      'id',
      'tier',
      'packageName',
      'version',
      'source',
      'executionMode',
      'hostSupport',
      'pluginRequest',
      'grant',
      'audit',
      'enforcement',
    ],
    'catalog entry',
  );
  if (entry.schema !== 'dsh-forge/catalog@1') fail(`不支持的 catalog schema: ${entry.schema}`, 'SCHEMA_UNSUPPORTED');
  identifier(entry.id, 'catalog.id');
  packageName(entry.packageName, 'catalog.packageName');
  if (typeof entry.tier !== 'string' || !['L0', 'L1', 'L2'].includes(entry.tier))
    fail(`catalog tier 无效: ${entry.tier}`, 'CATALOG_TIER');
  if (entry.executionMode !== 'trusted-in-process') fail('executionMode 必须是 trusted-in-process', 'TRUST_MODE');
  const source = object(entry.source, 'catalog.source');
  if (typeof source.kind !== 'string' || !['npm', 'git', 'workspace'].includes(source.kind))
    fail(`catalog.source.kind 无效: ${source.kind}`, 'CATALOG_SOURCE');
  if (
    source.kind === 'npm' &&
    (typeof source.registry !== 'string' ||
      !source.registry.startsWith('https://') ||
      source.package !== entry.packageName)
  )
    fail('npm catalog 来源必须含 HTTPS registry 与同名 package', 'CATALOG_SOURCE');
  if (source.kind === 'git' && (typeof source.commit !== 'string' || !/^[0-9a-f]{40}$/i.test(source.commit)))
    fail('git catalog 来源必须固定完整 commit', 'CATALOG_SOURCE');
  if (
    source.kind === 'workspace' &&
    (typeof source.path !== 'string' || !source.path || path.isAbsolute(source.path) || source.path.includes('..'))
  )
    fail('workspace catalog 来源必须是仓库内相对路径', 'CATALOG_SOURCE');
  if (entry.tier !== 'L2') {
    if (typeof entry.integrity !== 'string' || !/^(?:sha256|sha512)-[A-Za-z0-9+/=_-]{32,}$/.test(entry.integrity))
      fail('L0/L1 条目必须有精确 tarball 或 source integrity', 'CATALOG_INTEGRITY');
    if (typeof entry.license !== 'string' || !entry.license.trim() || entry.license === 'NOASSERTION')
      fail('L0/L1 条目必须声明许可证', 'CATALOG_LICENSE');
    if (
      typeof entry.maintainer !== 'string' ||
      !entry.maintainer.trim() ||
      !Array.isArray(entry.dependencies) ||
      !Array.isArray(entry.scripts) ||
      !Array.isArray(entry.capabilities) ||
      !Array.isArray(entry.verifiedOn) ||
      entry.verifiedOn.length === 0 ||
      typeof entry.verifiedAt !== 'string' ||
      Number.isNaN(Date.parse(entry.verifiedAt))
    )
      fail('L0/L1 条目必须包含维护者、依赖摘要、构建脚本、能力和验证事实', 'CATALOG_INCOMPLETE');
  }
  if (
    !Array.isArray(entry.hostSupport) ||
    !Array.isArray(entry.pluginRequest) ||
    typeof entry.grant !== 'string' ||
    typeof entry.audit !== 'string'
  )
    fail('catalog 授权与审计字段无效', 'CATALOG_INCOMPLETE');
  if (entry.enforcement !== 'unavailable')
    fail('trusted-in-process 必须声明 enforcement 为 unavailable', 'TRUST_ENFORCEMENT');
  return JSON.parse(JSON.stringify(entry)) as CatalogEntry;
}

export { IDENTIFIER, PACKAGE, NPM_PACKAGE, VERSION, ForgeError };
