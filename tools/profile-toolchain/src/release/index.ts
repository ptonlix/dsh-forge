import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import * as asar from '@electron/asar';
import { fail } from '../core/errors.ts';
import { errorCode, errorMessage } from '../types.ts';
import type { NativeFile, PackageInspection, RuntimeManifest, RuntimeTarget, UpdateInstallResult } from '../types.ts';
import type { ResolvedManifest } from '../compiler/index.ts';

/**
 * 打包产物与更新信任工具。
 *
 * 这里不执行 Electron 构建，而是检查构建器输出是否包含 profile、运行时闭包、
 * native 文件和签名所需证据；更新协调器先下载到隔离暂存区、验证摘要与签名，
 * 只有验证通过才释放当前 generation 并交给安装器。
 */

const DSH_BOOT_RUNTIME_PACKAGES = Object.freeze([
  '@deepseek-ai/dsh',
  '@deepseek-ai/dsh-app-boot',
  '@deepseek-ai/dsh-cmdline',
  '@deepseek-ai/cordis',
  '@deepseek-ai/cordis-plugin-group',
  '@deepseek-ai/cordis-plugin-loader',
  '@deepseek-ai/cordis-plugin-include',
  '@deepseek-ai/dsh-home-paths',
  '@deepseek-ai/dsh-invariants',
  '@deepseek-ai/dsh-launch-environment',
]);

const SHIPPED_STANDARD_PRESET = path.join('config', 'agent-presets', 'standard', 'agent.cordis.yml');

interface RuntimePaths {
  readonly application: string;
  readonly resources: string;
  readonly asar: string | null;
  readonly unpacked: string;
  readonly profile: string;
  readonly runtime: string;
}

interface InspectionFailure extends Record<string, unknown> {
  readonly code: string;
}
interface EvidenceFile {
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
}
export interface PackageEvidence {
  readonly schema: 'dsh-forge/package-evidence@1';
  readonly manifest: RuntimeManifest;
  readonly files: readonly EvidenceFile[];
  readonly sbom: string;
  readonly licenseNotice: string;
}
export interface ChannelMetadata {
  readonly schema: 'dsh-forge/channel@1';
  readonly distributionId: string;
  readonly version: string;
  readonly platform: string;
  readonly architecture: string;
  readonly trustRoot: string;
  readonly artifact: { readonly sha256: string };
  readonly signature: { readonly algorithm: 'ed25519'; readonly value: string };
  readonly downloadedSha256?: string;
}

/** 计算文件 SHA-256，摘要会写入 runtime manifest 或更新元数据。 */
export function sha256(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** 比较发行版语义版本；返回 -1、0、1，不接受未解析的版本字符串。 */
export function compareVersions(left: string, right: string): number {
  const parse = (value: string): readonly [number, number, number, string] => {
    const match = String(value).match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
    if (!match) fail(`无效更新版本: ${value}`, 'UPDATE_VERSION');
    return [Number(match[1]!), Number(match[2]!), Number(match[3]!), match[4] || ''];
  };
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) if (a[index]! !== b[index]!) return a[index]! > b[index]! ? 1 : -1;
  if (a[3] === b[3]) return 0;
  if (!a[3]) return 1;
  if (!b[3]) return -1;
  return a[3].localeCompare(b[3]);
}

/** 根据 macOS app bundle 或目录产物推导可检查的 resources/profile/runtime 路径。 */
export function runtimePaths(packageRoot: string | null | undefined): RuntimePaths | null {
  if (!packageRoot || !fs.existsSync(packageRoot)) return null;
  if (process.platform === 'darwin' && packageRoot.endsWith('.app')) {
    const resources = path.join(packageRoot, 'Contents', 'Resources');
    return {
      application: packageRoot,
      resources,
      asar: path.join(resources, 'app.asar'),
      unpacked: path.join(resources, 'app.asar.unpacked'),
      profile: path.join(resources, 'dsh-forge', 'profile'),
      runtime: path.join(resources, 'dsh-forge', 'runtime', 'node_modules'),
    };
  }
  return {
    application: packageRoot,
    resources: packageRoot,
    asar: null,
    unpacked: path.join(packageRoot, 'app.asar.unpacked'),
    profile: path.join(packageRoot, 'profile'),
    runtime: path.join(packageRoot, 'runtime', 'node_modules'),
  };
}

function collectNativeFiles(directory: string, relative = '', result: NativeFile[] = []): NativeFile[] {
  if (!fs.existsSync(directory)) return result;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const next = path.join(directory, entry.name);
    const relativePath = path.join(relative, entry.name);
    if (entry.isDirectory()) collectNativeFiles(next, relativePath, result);
    else if (
      entry.name.endsWith('.node') ||
      (relativePath.includes(`${path.sep}helpers${path.sep}`) && (fs.statSync(next).mode & 0o111) !== 0)
    )
      result.push({ path: relativePath.split(path.sep).join('/'), executable: (fs.statSync(next).mode & 0o111) !== 0 });
  }
  return result.sort((left, right) => left.path.localeCompare(right.path));
}

/** 校验平台/架构目标唯一性以及 native 文件相对路径安全性。 */
export function validateRuntimeTargets(targets: readonly RuntimeTarget[], label = 'runtime targets'): true {
  if (!Array.isArray(targets) || targets.length === 0) fail(`${label} 不能为空`, 'RUNTIME_TARGETS');
  const seen = new Set<string>();
  for (const target of targets) {
    if (
      !target ||
      !['darwin', 'win32'].includes(target.os) ||
      !Array.isArray(target.architectures) ||
      target.architectures.length === 0
    )
      fail(`${label} 包含无效平台`, 'RUNTIME_TARGETS');
    for (const architecture of target.architectures) {
      if (!['arm64', 'x64', 'ia32'].includes(architecture))
        fail(`${label} 包含无效架构: ${architecture}`, 'RUNTIME_TARGETS');
      const key = `${target.os}-${architecture}`;
      if (seen.has(key)) fail(`${label} 包含重复目标: ${key}`, 'RUNTIME_TARGETS');
      seen.add(key);
    }
    for (const native of target.nativeFiles || []) {
      if (
        !native ||
        typeof native.path !== 'string' ||
        path.isAbsolute(native.path) ||
        native.path.split(/[\\/]+/).includes('..')
      )
        fail(`${label} 包含无效 native 文件`, 'RUNTIME_TARGETS');
    }
  }
  return true;
}

/** 从已验证 resolved manifest 和实际应用目录生成运行时清单。 */
export function createRuntimeManifest({
  resolved,
  packageRoot,
  signed = false,
  targets = [],
  declaredTargets = null,
  artifact = null,
}: {
  resolved: ResolvedManifest;
  packageRoot: string | null;
  signed?: boolean;
  targets: readonly RuntimeTarget[];
  declaredTargets?: readonly RuntimeTarget[] | null;
  artifact?: string | null;
}): RuntimeManifest {
  if (!resolved) fail('runtime manifest 缺少 resolved manifest', 'RUNTIME_MANIFEST');
  validateRuntimeTargets(targets, '构建目标');
  const declared = declaredTargets || resolved.distribution.platforms;
  validateRuntimeTargets(declared, '声明目标');
  const paths = runtimePaths(packageRoot ? path.resolve(packageRoot) : null);
  const nativeAddons = paths ? collectNativeFiles(paths.unpacked) : [];
  return {
    schema: 'dsh-forge/runtime-manifest@1',
    distribution: resolved.distribution,
    profile: resolved.profile,
    runtime: {
      electron: resolved.profile.runtime.electronVersion,
      dshPackageFamily: resolved.profile.runtime.dshPackageFamily,
      dsh: resolved.profile.runtime.dshVersion,
      cordis: resolved.profile.runtime.cordisVersion,
      pnpm: resolved.tools.pnpm,
      node: resolved.tools.node,
      nodeAbi: process.versions.modules,
    },
    bundles: resolved.bundles,
    lockfile: resolved.lockfile,
    nativeAddons,
    runtimePackages: DSH_BOOT_RUNTIME_PACKAGES.slice(),
    targets,
    declaredTargets: declared.map((target) => ({ os: target.os, architectures: target.architectures.slice() })),
    packageRoot: paths?.application || null,
    artifact: artifact ? path.resolve(artifact) : null,
    signing: { signed, kind: signed ? 'platform-identity' : 'unsigned-smoke' },
  };
}

function inspectAsar(paths: RuntimePaths, failures: InspectionFailure[]): void {
  if (!paths.asar) return;
  if (!fs.existsSync(paths.asar)) {
    failures.push({ code: 'ASAR_MISSING', path: paths.asar });
    return;
  }
  let files;
  try {
    files = new Set(asar.listPackage(paths.asar, { isPack: false }).map((file) => file.replace(/^\//, '')));
  } catch (error) {
    failures.push({ code: 'ASAR_INVALID', message: errorMessage(error) });
    return;
  }
  for (const required of [
    'dist/apps/desktop/electron-main.js',
    'dist/apps/desktop/preload.js',
    'packages/desktop-plugin/dist/index.js',
  ]) {
    if (!files.has(required)) failures.push({ code: 'ASAR_RUNTIME_ENTRY_MISSING', path: required });
  }
}

function resolveRuntimePackage(paths: RuntimePaths | null, packageName: string): string | null {
  if (!paths?.runtime) return null;
  const anchor = path.join(paths.runtime, '@deepseek-ai', 'dsh', 'package.json');
  if (!fs.existsSync(anchor)) return null;
  try {
    const runtimeRequire = createRequire(fs.realpathSync(anchor));
    return runtimeRequire.resolve(`${packageName}/package.json`);
  } catch {
    return null;
  }
}

function packageEntryExists(paths: RuntimePaths | null, packageName: string): boolean {
  if (!paths?.runtime) return false;
  const anchor = path.join(paths.runtime, '@deepseek-ai', 'dsh', 'package.json');
  if (!fs.existsSync(anchor)) return false;
  // `@deepseek-ai/dsh` 是运行时配置包，故意只提供 package.json 和 lib 目录，不声明根入口。
  if (packageName === '@deepseek-ai/dsh') return true;
  try {
    return Boolean(createRequire(fs.realpathSync(anchor)).resolve(packageName));
  } catch {
    return false;
  }
}

/** 检查打包 runtime 是否带有恢复会话所需的官方 standard 预设。 */
function shippedStandardPresetExists(paths: RuntimePaths | null): boolean {
  const dshPackage = resolveRuntimePackage(paths, '@deepseek-ai/dsh');
  return dshPackage !== null && fs.existsSync(path.join(path.dirname(dshPackage), SHIPPED_STANDARD_PRESET));
}

/** 使用平台工具检查 native 文件是否包含声明的目标架构。 */
export function nativeArchitecture(file: string, architecture: RuntimeTarget['architectures'][number]): boolean {
  if (!fs.existsSync(file)) return false;
  if (process.platform === 'darwin') {
    const result = spawnSync('lipo', ['-archs', file], { encoding: 'utf8' });
    return result.status === 0 && result.stdout.split(/\s+/).includes(architecture);
  }
  const result = spawnSync('file', [file], { encoding: 'utf8' });
  if (result.status !== 0) return false;
  const value = result.stdout.toLowerCase();
  return architecture === 'x64'
    ? /x86[- ]64|x64/.test(value)
    : architecture === 'arm64'
      ? /arm64|aarch64/.test(value)
      : /32-bit|i[3-6]86/.test(value);
}

/** 检查安装包结构、运行时闭包、native 文件、架构和签名要求。 */
export function inspectPackage(
  manifest: RuntimeManifest,
  { requireSignature = false }: { requireSignature?: boolean } = {},
): PackageInspection {
  const failures: InspectionFailure[] = [];
  const paths = runtimePaths(manifest.packageRoot);
  try {
    validateRuntimeTargets(manifest.targets || [], '构建目标');
    validateRuntimeTargets(manifest.declaredTargets || manifest.targets || [], '声明目标');
  } catch (error) {
    failures.push({ code: errorCode(error) || 'RUNTIME_TARGETS', message: errorMessage(error) });
  }
  if (!paths) failures.push({ code: 'PACKAGE_ROOT_MISSING', path: manifest.packageRoot });
  if (paths) {
    if (paths.asar) {
      inspectAsar(paths, failures);
      if (!fs.existsSync(path.join(paths.profile, 'package.json')))
        failures.push({ code: 'PACKAGED_PROFILE_MISSING', path: 'dsh-forge/profile/package.json' });
      if (!fs.existsSync(path.join(paths.resources, 'dsh-forge', 'resolved-manifest.json')))
        failures.push({ code: 'PACKAGED_RESOLVED_MANIFEST_MISSING' });
      for (const packageName of DSH_BOOT_RUNTIME_PACKAGES) {
        if (!resolveRuntimePackage(paths, packageName))
          failures.push({ code: 'RUNTIME_CLOSURE_PACKAGE_MISSING', package: packageName });
        else if (!packageEntryExists(paths, packageName))
          failures.push({ code: 'RUNTIME_PACKAGE_EXPORT_MISSING', package: packageName });
      }
      if (!shippedStandardPresetExists(paths))
        failures.push({ code: 'RUNTIME_PRESET_ASSET_MISSING', path: SHIPPED_STANDARD_PRESET });
      const macBin = path.join(paths.application, 'Contents', 'MacOS');
      if (
        process.platform === 'darwin' &&
        (!fs.existsSync(macBin) ||
          !fs.readdirSync(macBin).some((name) => (fs.statSync(path.join(macBin, name)).mode & 0o111) !== 0))
      )
        failures.push({ code: 'MAC_EXECUTABLE_MISSING' });
    } else {
      for (const relative of ['package.json', 'profile/package.json'])
        if (!fs.existsSync(path.join(paths.resources, relative)))
          failures.push({ code: 'PACKAGE_FILE_MISSING', path: relative });
    }
    const nativeRequirements = manifest.nativeAddons?.length
      ? manifest.nativeAddons
      : (manifest.targets || []).flatMap((target) => target.nativeFiles || []);
    for (const native of nativeRequirements) {
      const file = path.join(paths.unpacked, native.path);
      if (!fs.existsSync(file)) failures.push({ code: 'NATIVE_FILE_MISSING', path: native.path });
      if (native.executable && fs.existsSync(file) && (fs.statSync(file).mode & 0o111) === 0)
        failures.push({ code: 'EXECUTABLE_PERMISSION_MISSING', path: native.path });
      const normalizedPath = native.path.replaceAll('\\', '/');
      const platformMatch = normalizedPath.match(/(?:^|[/_-])(darwin|win32|linux)(?:-|[/])/);
      const architectureMatch = normalizedPath.match(/(?:^|[/_-])(arm64|x64|ia32)(?:-|[/]|\.|$)/);
      if (platformMatch && platformMatch[1] !== process.platform) continue;
      if (architectureMatch && architectureMatch[1] !== process.arch) continue;
      for (const target of manifest.targets || []) {
        if (target.os === process.platform && fs.existsSync(file))
          for (const architecture of target.architectures || []) {
            if (!nativeArchitecture(file, architecture))
              failures.push({ code: 'NATIVE_ARCHITECTURE_MISMATCH', path: native.path, architecture });
          }
      }
    }
  }
  if (requireSignature && !manifest.signing?.signed)
    failures.push({ code: 'UNSIGNED_PRODUCTION', message: '未签名产物只能用于 smoke' });
  return { valid: failures.length === 0, failures, signing: manifest.signing };
}

function walkFiles(directory: string, prefix = '', result: EvidenceFile[] = []): EvidenceFile[] {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    const name = path.join(prefix, entry.name);
    // pnpm workspace 可能留下指向目录的符号链接，必须按真实 stat 判断，不能把目录交给 readFileSync。
    const stat = fs.statSync(target);
    if (stat.isDirectory()) walkFiles(target, name, result);
    else if (stat.isFile())
      result.push({ path: name.split(path.sep).join('/'), size: stat.size, sha256: sha256(target) });
  }
  return result;
}

/** 为产物生成文件摘要、manifest、SBOM 和许可证通知引用。 */
export function generateEvidence(manifest: RuntimeManifest, outputDir: string): PackageEvidence {
  fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  const files = manifest.packageRoot && fs.existsSync(manifest.packageRoot) ? walkFiles(manifest.packageRoot) : [];
  const evidence: PackageEvidence = {
    schema: 'dsh-forge/package-evidence@1',
    manifest,
    files,
    sbom: 'sbom.input.json',
    licenseNotice: 'THIRD-PARTY-NOTICES.txt',
  };
  fs.writeFileSync(path.join(outputDir, 'package-evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`, {
    mode: 0o600,
  });
  return evidence;
}

/** 校验证据 schema、摘要路径唯一性以及外部 SBOM/许可证文件存在性。 */
export function verifyEvidence(
  evidence: PackageEvidence,
  { sbomFile, licenseFile }: { sbomFile?: string; licenseFile?: string } = {},
): { readonly valid: true; readonly fileCount: number } {
  if (
    !evidence ||
    evidence.schema !== 'dsh-forge/package-evidence@1' ||
    !evidence.manifest ||
    !Array.isArray(evidence.files)
  )
    fail('产物证据 schema 无效', 'EVIDENCE_INVALID');
  if (sbomFile && !fs.existsSync(sbomFile)) fail('SBOM 输入缺失', 'EVIDENCE_SBOM_MISSING');
  if (licenseFile && !fs.existsSync(licenseFile)) fail('许可证通知缺失', 'EVIDENCE_LICENSE_MISSING');
  const duplicate = evidence.files.find(
    (file, index, files) => files.findIndex((candidate) => candidate.path === file.path) !== index,
  );
  if (duplicate) fail(`产物摘要存在重复路径: ${duplicate.path}`, 'EVIDENCE_DUPLICATE');
  return { valid: true, fileCount: evidence.files.length };
}

/** 汇总 profile、配置、包、catalog、smoke 和证据检查，决定是否允许发布。 */
export function releaseGate({
  profileVerified,
  configDump,
  packageInspection,
  catalogVerified,
  manifest,
  updateConfigured,
  packageSmoke,
  evidence,
}: {
  profileVerified: boolean;
  configDump: { readonly healthy?: boolean } | null;
  packageInspection: { readonly valid?: boolean } | null;
  catalogVerified: { readonly valid?: boolean } | null;
  manifest: RuntimeManifest | null;
  updateConfigured: boolean;
  packageSmoke: { readonly healthy?: boolean } | null;
  evidence: { readonly valid?: boolean } | null;
}): { readonly publishable: true } {
  const failures: string[] = [];
  if (!profileVerified) failures.push('profile verify 未通过');
  if (!configDump?.healthy) failures.push('Loader config dump 未通过');
  if (!packageInspection?.valid) failures.push('安装包检查未通过');
  if (!packageSmoke?.healthy) failures.push('真实安装包 smoke 未通过');
  if (!evidence?.valid) failures.push('产物证据、SBOM 或许可证未通过');
  if (!catalogVerified?.valid) failures.push('catalog 验证未通过');
  if (!manifest?.signing?.signed) failures.push('生产发布需要平台签名');
  if (!updateConfigured) failures.push('生产发布需要更新信任根与 channel');
  if (failures.length) fail(`发布门禁拒绝: ${failures.join('；')}`, 'RELEASE_GATE', { failures });
  return { publishable: true };
}

function canonicalUpdatePayload(metadata: ChannelMetadata): Buffer {
  const { signature: _signature, downloadedSha256: _downloadedSha256, ...payload } = metadata;
  return Buffer.from(JSON.stringify(payload));
}

/** 创建带 artifact 摘要和 Ed25519 签名的更新频道元数据。 */
export function createChannelMetadata({
  distributionId,
  version,
  platform,
  architecture,
  artifactFile,
  trustRoot,
  privateKey,
}: {
  distributionId: string;
  version: string;
  platform: string;
  architecture: string;
  artifactFile: string;
  trustRoot: { readonly id: string };
  privateKey: crypto.KeyLike;
}): Readonly<ChannelMetadata> {
  if (!distributionId || !version || !platform || !architecture || !artifactFile || !trustRoot?.id || !privateKey)
    fail('channel metadata 缺少签名输入', 'UPDATE_METADATA');
  const metadata: Omit<ChannelMetadata, 'signature'> = {
    schema: 'dsh-forge/channel@1',
    distributionId,
    version,
    platform,
    architecture,
    trustRoot: trustRoot.id,
    artifact: { sha256: sha256(artifactFile) },
  };
  const payload: ChannelMetadata = { ...metadata, signature: { algorithm: 'ed25519', value: '' } };
  const value = crypto.sign(null, canonicalUpdatePayload(payload), privateKey).toString('base64');
  return Object.freeze({ ...metadata, signature: { algorithm: 'ed25519' as const, value } });
}

/** 验证更新目标身份、版本单调性、下载摘要、信任根和 Ed25519 签名。 */
export function verifyChannelMetadata(
  metadata: ChannelMetadata,
  installed: {
    readonly version: string;
    readonly distributionId: string;
    readonly platform: string;
    readonly architecture: string;
  },
  trustRoot: string | { readonly id: string; readonly publicKey?: crypto.KeyLike },
): true {
  if (!metadata || metadata.schema !== 'dsh-forge/channel@1') fail('channel metadata schema 无效', 'UPDATE_METADATA');
  const root = typeof trustRoot === 'string' ? { id: trustRoot } : trustRoot;
  if (
    !root ||
    metadata.trustRoot !== root.id ||
    !metadata.artifact ||
    metadata.artifact.sha256 !== metadata.downloadedSha256
  )
    fail('更新信任根或摘要校验失败', 'UPDATE_INTEGRITY');
  if (
    !root.publicKey ||
    !metadata.signature ||
    metadata.signature.algorithm !== 'ed25519' ||
    typeof metadata.signature.value !== 'string' ||
    !crypto.verify(
      null,
      canonicalUpdatePayload(metadata),
      root.publicKey,
      Buffer.from(metadata.signature.value, 'base64'),
    )
  )
    fail('更新签名校验失败', 'UPDATE_SIGNATURE');
  if (compareVersions(metadata.version, installed.version) <= 0)
    fail(`拒绝降级或重复版本: ${metadata.version}`, 'UPDATE_DOWNGRADE');
  if (
    metadata.distributionId !== installed.distributionId ||
    metadata.platform !== installed.platform ||
    metadata.architecture !== installed.architecture
  )
    fail('更新目标身份或平台不匹配', 'UPDATE_TARGET');
  return true;
}

/**
 * 更新事务协调器：下载和验证在暂存区完成，验证失败会隔离文件且不销毁当前 generation；
 * 只有验证成功后才调用 disposeGeneration 和 installer，安装器失败则返回保留旧版本的结果。
 */
export class UpdateCoordinator {
  readonly stageDir: string;
  readonly disposeGeneration?: () => void | Promise<void>;
  readonly installer: (staged: string, metadata: ChannelMetadata) => UpdateInstallResult | Promise<UpdateInstallResult>;
  readonly trustRoot: string | { readonly id: string; readonly publicKey?: crypto.KeyLike };

  constructor({
    stageDir,
    disposeGeneration,
    installer,
    trustRoot,
  }: {
    stageDir: string;
    disposeGeneration?: () => void | Promise<void>;
    installer: (staged: string, metadata: ChannelMetadata) => UpdateInstallResult | Promise<UpdateInstallResult>;
    trustRoot: string | { readonly id: string; readonly publicKey?: crypto.KeyLike };
  }) {
    this.stageDir = path.resolve(stageDir);
    this.disposeGeneration = disposeGeneration;
    this.installer = installer;
    this.trustRoot = trustRoot;
    fs.mkdirSync(this.stageDir, { recursive: true, mode: 0o700 });
  }
  async apply({
    metadata,
    installed,
    download,
    userConfirmed = false,
  }: {
    metadata: ChannelMetadata;
    installed: {
      readonly version: string;
      readonly distributionId: string;
      readonly platform: string;
      readonly architecture: string;
    };
    download: () => Buffer | Promise<Buffer>;
    userConfirmed?: boolean;
  }): Promise<UpdateInstallResult> {
    if (!userConfirmed) fail('更新必须由用户确认', 'UPDATE_CONFIRMATION_REQUIRED');
    const staged = path.join(this.stageDir, `${metadata.version}.download`);
    const content = await download();
    fs.writeFileSync(staged, content, { flag: 'wx', mode: 0o600 });
    const hash = sha256(staged);
    try {
      verifyChannelMetadata({ ...metadata, downloadedSha256: hash }, installed, this.trustRoot);
    } catch (error) {
      fs.renameSync(staged, `${staged}.rejected`);
      throw error;
    }
    await this.disposeGeneration?.();
    try {
      return await this.installer(staged, metadata);
    } catch (error) {
      return { installed: false, retainedVersion: installed.version, reason: errorMessage(error), staged };
    }
  }
}
