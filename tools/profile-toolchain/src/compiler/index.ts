import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  parseBundleManifest,
  parseDistribution,
  parseProfile,
  type BundleManifest,
  type Distribution,
  type Profile,
  type PackageSource,
} from '../core/schema.ts';
import { readYaml, stringifyYaml } from '../core/yaml.ts';
import { digest, stable } from '../core/digest.ts';
import { fail } from '../core/errors.ts';

/**
 * Profile compiler：把发行版与 profile 源文件转换为可复现的安装输入。
 *
 * 编译过程同时解析 bundle 依赖闭包、检查固定 Git 来源、生成 pnpm lock、
 * 记录 allowBuilds 和输入摘要。输出目录是后续 composer、package 和 release
 * 阶段的事实来源；verifyProfile 会重新编译到临时目录并逐文件比较，拒绝漂移。
 */

export const TOOL_VERSIONS = Object.freeze({ compiler: '0.2.0', pnpm: '11.7.0', node: process.versions.node });
const LIFECYCLE_SCRIPTS = new Set(['preinstall', 'install', 'postinstall']);

export interface Bundle extends BundleManifest {
  readonly source: PackageSource;
}

export interface DependencyClosureEntry {
  readonly name: string;
  readonly version: string | null;
  readonly license: string;
  readonly source: PackageSource;
  readonly scripts: readonly { readonly name: string; readonly command: string }[];
}

export interface CollectedBundles {
  readonly bundles: readonly Bundle[];
  readonly dependencyClosure: readonly DependencyClosureEntry[];
  readonly allowBuilds: readonly string[];
  readonly buildPolicy: Readonly<Record<string, boolean>>;
}

export interface BundleCollectionProfile {
  readonly bundles: readonly string[];
  readonly runtime: Pick<Profile['runtime'], 'cordisVersion'>;
}

/**
 * bundle 解析的可选测试边界。
 *
 * 正式编译只从 workspace 和已安装的 DSH runtime 闭包解析 bundle；测试若需要
 * 构造不完整或带恶意输入的本地 package，必须显式传入夹具根目录，避免生产
 * 代码隐式依赖 tests/ 目录。
 */
export interface BundleResolutionOptions {
  readonly fixtureRoot?: string;
}

export interface ResolvedManifest {
  readonly schema: 'dsh-forge/resolved-manifest@1';
  readonly inputDigest: string;
  readonly generatedAt: 'deterministic';
  readonly tools: typeof TOOL_VERSIONS;
  readonly pnpmEvidence: { readonly generated: string; readonly frozen: string; readonly lockfileDigest: string };
  readonly distribution: Pick<
    Distribution,
    'id' | 'name' | 'applicationId' | 'version' | 'packageScope' | 'channel' | 'platforms' | 'updates'
  >;
  readonly profile: Pick<Profile, 'name' | 'runtime' | 'bundles'>;
  readonly bundles: readonly Record<string, unknown>[];
  readonly dependencyClosure: readonly DependencyClosureEntry[];
  readonly allowBuilds: readonly string[];
  readonly lockfile: { readonly digest: string; readonly version: unknown };
  readonly input: unknown;
}

export interface CompiledProfile {
  readonly root: string;
  readonly distribution: Distribution;
  readonly profile: Profile;
  readonly bundles: readonly Bundle[];
  readonly dependencyClosure: readonly DependencyClosureEntry[];
  readonly inputDigest: string;
  readonly outputDir: string;
  readonly profileDir: string;
  readonly resolved: ResolvedManifest;
}

interface DependencyPackage extends Record<string, unknown> {
  name?: unknown;
  version?: unknown;
  license?: unknown;
  dependencies?: Record<string, unknown>;
  optionalDependencies?: Record<string, unknown>;
  peerDependencies?: Record<string, unknown>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
  scripts?: Record<string, unknown>;
}

interface PnpmResult {
  readonly command: string;
  readonly stdout: string;
}

function repoRoot(): string {
  const sourceRoot = path.resolve(__dirname, '../..');
  if (fs.existsSync(path.join(sourceRoot, 'distribution.yml'))) return sourceRoot;
  const repositoryRoot = path.resolve(__dirname, '../../../..');
  if (fs.existsSync(path.join(repositoryRoot, 'distribution.yml'))) return repositoryRoot;
  return sourceRoot;
}

function dshRequire(): NodeRequire {
  return createRequire(fs.realpathSync(require.resolve('@deepseek-ai/dsh/package.json')));
}

function realDirectory(candidate: string): string | null {
  if (!fs.existsSync(path.join(candidate, 'package.json'))) return null;
  return fs.realpathSync(candidate);
}

/** 从 workspace、DSH runtime 闭包或 pnpm 搜索路径解析真实 package 目录。 */
export function resolvePackageDirectory(name: string, root = repoRoot()): string | null {
  const local = realDirectory(path.join(root, 'node_modules', ...name.split('/')));
  if (local) return local;
  try {
    return path.dirname(dshRequire().resolve(`${name}/package.json`));
  } catch {
    const fromRoot = createRequire(path.join(root, 'package.json'));
    for (const searchPath of fromRoot.resolve.paths(name) || []) {
      const candidate = realDirectory(path.join(searchPath, name));
      if (candidate) return candidate;
    }
  }
  return null;
}

/**
 * 定位 bundle；找不到时抛出带 bundle 名称的稳定业务错误。
 *
 * fixtureRoot 只用于测试构造的本地 package，正式调用不应设置该选项。
 */
export function bundleDirectory(name: string, root = repoRoot(), options: BundleResolutionOptions = {}): string {
  const local = resolvePackageDirectory(name, root);
  if (local) return local;
  if (options.fixtureRoot) {
    const fixture = path.join(path.resolve(options.fixtureRoot), 'bundles', name.slice(name.lastIndexOf('/') + 1));
    if (fs.existsSync(path.join(fixture, 'package.json'))) return fs.realpathSync(fixture);
  }
  fail(`无法定位 bundle: ${name}`, 'BUNDLE_MISSING', { name });
}

/** 将 Git/npm/file/workspace 来源归一化，并拒绝未固定完整 commit 的 Git 依赖。 */
export function normalizeGit(spec: string): Record<string, string | null> {
  const github = String(spec).match(/^github:([^#]+)#([0-9a-f]{40})(?:&path:([^\s]+))?$/i);
  if (github)
    return {
      kind: 'github',
      repository: github[1]!,
      commit: github[2]!.toLowerCase(),
      subdirectory: github[3] || null,
      spec,
    };
  const git = String(spec).match(
    /^(?:git\+)?(https?:\/\/[^#]+\.git|ssh:\/\/[^#]+|git@[^#]+)#([0-9a-f]{40})(?:&path:([^\s]+))?$/i,
  );
  if (git)
    return { kind: 'git', repository: git[1]!, commit: git[2]!.toLowerCase(), subdirectory: git[3] || null, spec };
  if (/^(?:github:|git\+|git@|ssh:\/\/|https?:\/\/.*\.git(?:#|$))/.test(String(spec))) {
    fail(`Git 来源必须固定完整 commit: ${spec}`, 'BUNDLE_SOURCE_FLOATING', { spec });
  }
  if (String(spec).startsWith('file:')) return { kind: 'file', path: spec.slice(5), spec };
  if (String(spec).startsWith('workspace:')) return { kind: 'workspace', spec };
  return { kind: 'npm', spec };
}

function sha256File(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function allowsVersion(range: string, version: string): boolean {
  if (range === version || range === `=${version}`) return true;
  const caret = String(range).match(/^\^(\d+)\.(\d+)\.(\d+)$/);
  const actual = String(version).match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!caret || !actual) return false;
  const minimum = [Number(caret[1]!), Number(caret[2]!), Number(caret[3]!)];
  const resolved = [Number(actual[1]!), Number(actual[2]!), Number(actual[3]!)];
  if (minimum[0] !== resolved[0]) return false;
  for (let index = 1; index < minimum.length; index += 1) {
    if (resolved[index]! !== minimum[index]!) return resolved[index]! > minimum[index]!;
  }
  return true;
}

function packageSource(directory: string, root: string, workspaceRoots: readonly string[]): PackageSource {
  const relative = path.relative(root, directory);
  const workspace =
    relative &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative) &&
    workspaceRoots.some((workspaceRoot) => {
      const child = path.relative(workspaceRoot, directory);
      return child && !child.startsWith(`..${path.sep}`) && !path.isAbsolute(child);
    });
  return workspace
    ? { kind: 'workspace', path: relative, integrity: `sha256-${sha256File(path.join(directory, 'package.json'))}` }
    : {
      kind: 'installed',
      path: relative || '.',
      integrity: `sha256-${sha256File(path.join(directory, 'package.json'))}`,
    };
}

function resolveDependencyDirectory(anchor: string, name: string): string | null {
  const requireFromAnchor = createRequire(path.join(anchor, 'package.json'));
  try {
    const entry = requireFromAnchor.resolve(name);
    let directory = path.dirname(entry);
    for (let depth = 0; depth < 6; depth += 1) {
      const packageFile = path.join(directory, 'package.json');
      if (fs.existsSync(packageFile)) {
        const manifest = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
        if (manifest.name === name) return directory;
      }
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  } catch {
    // 某些依赖通过 exports 禁止 package.json 子路径；下面的搜索仍保留物理目录校验。
  }
  for (const searchPath of requireFromAnchor.resolve.paths(name) || []) {
    const candidate = path.join(searchPath, ...name.split('/'));
    if (fs.existsSync(path.join(candidate, 'package.json'))) return fs.realpathSync(candidate);
  }
  return null;
}

function dependencyNames(pkg: DependencyPackage): string[] {
  return [
    ...new Set([
      ...Object.keys(pkg.dependencies || {}),
      ...Object.keys(pkg.optionalDependencies || {}),
      ...Object.keys(pkg.peerDependencies || {}),
    ]),
  ];
}

function collectDependencyClosure(
  bundleDirectories: readonly string[],
  root: string,
  workspaceRoots: readonly string[],
): DependencyClosureEntry[] {
  const queue = bundleDirectories.slice();
  const seen = new Map();
  while (queue.length) {
    const directory = queue.shift();
    if (!directory) continue;
    const packageFile = path.join(directory, 'package.json');
    if (!fs.existsSync(packageFile)) continue;
    const pkg = JSON.parse(fs.readFileSync(packageFile, 'utf8')) as DependencyPackage;
    if (typeof pkg.name !== 'string' || seen.has(pkg.name)) continue;
    const scripts = pkg.scripts || {};
    seen.set(pkg.name, {
      name: pkg.name,
      version: typeof pkg.version === 'string' ? pkg.version : null,
      license: typeof pkg.license === 'string' ? pkg.license : 'NOASSERTION',
      source: packageSource(directory, root, workspaceRoots),
      scripts: Object.keys(scripts)
        .filter((name) => LIFECYCLE_SCRIPTS.has(name))
        .filter((name) => typeof scripts[name] === 'string')
        .map((name) => ({ name, command: scripts[name] as string })),
    });
    for (const dependency of dependencyNames(pkg)) {
      const child = resolveDependencyDirectory(directory, dependency);
      if (child) queue.push(child);
      else if (
        !(pkg.optionalDependencies && Object.hasOwn(pkg.optionalDependencies, dependency)) &&
        !pkg.peerDependenciesMeta?.[dependency]?.optional
      ) {
        fail(`依赖闭包缺少 ${dependency}（由 ${pkg.name} 声明）`, 'DEPENDENCY_CLOSURE_MISSING', {
          package: pkg.name,
          dependency,
        });
      }
    }
  }
  return [...seen.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function readBuildPolicy(root: string): Map<string, boolean> {
  const workspace = readYaml(path.join(root, 'pnpm-workspace.yaml'));
  const record = workspace !== null && typeof workspace === 'object' ? (workspace as Record<string, unknown>) : {};
  const entries = record.allowBuilds || record.onlyBuiltDependencies || {};
  if (Array.isArray(entries))
    return new Map(entries.filter((name): name is string => typeof name === 'string').map((name) => [name, true]));
  if (entries !== null && typeof entries === 'object') {
    return new Map(Object.entries(entries).map(([name, allowed]) => [name, allowed === true]));
  }
  return new Map();
}

/** 收集 profile bundle、依赖闭包和构建授权，返回可审计的编译输入集合。 */
export function collectBundles(
  profile: BundleCollectionProfile,
  root: string,
  options: BundleResolutionOptions = {},
): CollectedBundles {
  const workspaceRoots = [path.join(root, 'packages')];
  if (options.fixtureRoot) workspaceRoots.push(path.resolve(options.fixtureRoot));
  const peerVersions = new Map();
  const bundles = profile.bundles.map((name) => {
    const directory = bundleDirectory(name, root, options);
    const manifest = parseBundleManifest(directory);
    if (manifest.name !== name)
      fail(`bundle 名称不匹配: profile 声明 ${name}，实际为 ${manifest.name}`, 'BUNDLE_IDENTITY');
    for (const [peer, range] of Object.entries(manifest.peerDependencies)) {
      if (peer === '@deepseek-ai/cordis' && !allowsVersion(range, profile.runtime.cordisVersion)) {
        fail(`Cordis peer 不一致: ${name} 要求 ${range}，profile 为 ${profile.runtime.cordisVersion}`, 'PEER_MISMATCH');
      }
      const previous = peerVersions.get(peer);
      if (
        previous &&
        previous !== range &&
        !(
          peer === '@deepseek-ai/cordis' &&
          allowsVersion(previous, profile.runtime.cordisVersion) &&
          allowsVersion(range, profile.runtime.cordisVersion)
        )
      ) {
        fail(`重复 peer 版本冲突: ${peer}`, 'PEER_DUPLICATE', { peer, previous, range });
      }
      peerVersions.set(peer, range);
    }
    for (const spec of Object.values(manifest.dependencies)) normalizeGit(spec);
    return { ...manifest, source: packageSource(directory, root, workspaceRoots) };
  });
  const dependencyClosure = collectDependencyClosure(
    bundles.map((bundle) => bundle.sourceDirectory),
    root,
    workspaceRoots,
  );
  const policy = readBuildPolicy(root);
  const requestedBuilds = new Set(bundles.flatMap((bundle) => bundle.allowBuilds || []));
  for (const dependency of dependencyClosure) {
    if (dependency.scripts.length && !policy.has(dependency.name) && !requestedBuilds.has(dependency.name)) {
      fail(`依赖 ${dependency.name} 具有生命周期脚本但未获 allowBuilds 授权`, 'ALLOW_BUILDS_REQUIRED', {
        dependency: dependency.name,
      });
    }
  }
  return {
    bundles,
    dependencyClosure,
    allowBuilds: [
      ...new Set(
        [...policy.entries()]
          .filter(([, allowed]) => allowed)
          .map(([name]) => name)
          .concat([...requestedBuilds]),
      ),
    ].sort(),
    buildPolicy: Object.fromEntries(policy),
  };
}

function readPatch(file: string): unknown[] {
  if (!fs.existsSync(file)) return [];
  const patch = readYaml(file);
  if (!Array.isArray(patch)) fail(`patch 必须是数组: ${file}`, 'PATCH_INVALID');
  return patch;
}

function inputSummary(
  distribution: Distribution,
  profile: Profile,
  bundles: readonly Bundle[],
  profilePatch: readonly unknown[],
  dependencyClosure: readonly DependencyClosureEntry[],
  allowBuilds: readonly string[],
): unknown {
  return stable({
    tools: TOOL_VERSIONS,
    distribution: {
      id: distribution.id,
      version: distribution.version,
      applicationId: distribution.applicationId,
      platforms: distribution.platforms,
      updates: distribution.updates,
    },
    profile: { name: profile.name, runtime: profile.runtime, bundles: profile.bundles, patch: profilePatch },
    bundles: bundles.map((bundle) => ({
      name: bundle.name,
      version: bundle.version,
      source: bundle.source,
      license: bundle.license,
      dependencies: bundle.dependencies,
      peerDependencies: bundle.peerDependencies,
      scripts: bundle.scripts,
    })),
    dependencyClosure,
    allowBuilds,
  });
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

function writeText(file: string, value: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, value, { encoding: 'utf8', mode: 0o600 });
}

function profileDependencySpec(bundle: Bundle, profileDir: string): string {
  if (bundle.source.kind !== 'workspace') return bundle.version;
  const relative = path.relative(profileDir, bundle.sourceDirectory).split(path.sep).join('/');
  return `file:${relative || '.'}`;
}

function profileLocalDependency(bundle: Bundle, fixtureRoot: string | undefined): boolean {
  // DSH 先从发行包安装锚点解析内置 bundle；只有显式测试夹具才进入 profile 的 file 依赖。
  if (!fixtureRoot || bundle.source.kind === 'installed') return false;
  const relative = path.relative(path.resolve(fixtureRoot), bundle.sourceDirectory);
  return Boolean(relative && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function pnpmCommand(root: string): string {
  const entry = path.join(root, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs');
  if (!fs.existsSync(entry)) fail('未找到固定 pnpm runtime', 'PNPM_RUNTIME_MISSING');
  return entry;
}

function runPnpm(root: string, cwd: string, args: readonly string[]): PnpmResult {
  const result = spawnSync(process.execPath, [pnpmCommand(root), ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, CI: 'true', npm_config_ignore_scripts: 'true' },
  });
  if (result.status !== 0) {
    fail(`pnpm 解析失败: ${(result.stderr || result.stdout || 'unknown error').trim()}`, 'PNPM_RESOLUTION_FAILED', {
      command: args,
      status: result.status,
      signal: result.signal,
    });
  }
  return { command: `node ${path.relative(root, pnpmCommand(root))} ${args.join(' ')}`, stdout: result.stdout.trim() };
}

function resolvePnpmLock(
  root: string,
  profileDir: string,
): {
  readonly generated: PnpmResult;
  readonly frozen: PnpmResult;
  readonly lockfileDigest: string;
  readonly lock: Record<string, unknown>;
} {
  const common = ['install', '--lockfile-only', '--ignore-scripts', '--offline', '--ignore-workspace'];
  // 临时 profile 与产物保持相同父目录层级，file/workspace 依赖的相对来源不会被改写。
  const scratchRoot = fs.mkdtempSync(path.join(path.dirname(profileDir), '.dsh-forge-resolve-'));
  const scratchProfile = path.join(scratchRoot, 'profile');
  fs.cpSync(profileDir, scratchProfile, { recursive: true, dereference: true });
  try {
    const generated = runPnpm(root, scratchProfile, [...common, '--no-frozen-lockfile']);
    const frozen = runPnpm(root, scratchProfile, [...common, '--frozen-lockfile']);
    const lockFile = path.join(scratchProfile, 'pnpm-lock.yaml');
    if (!fs.existsSync(lockFile)) fail('pnpm 未生成锁文件', 'PNPM_LOCK_MISSING');
    fs.copyFileSync(lockFile, path.join(profileDir, 'pnpm-lock.yaml'));
    const rawLock = readYaml(lockFile);
    return {
      generated,
      frozen,
      lockfileDigest: `sha256-${sha256File(lockFile)}`,
      lock: rawLock !== null && typeof rawLock === 'object' ? (rawLock as Record<string, unknown>) : {},
    };
  } finally {
    fs.rmSync(scratchRoot, { recursive: true, force: true });
  }
}

/** 执行完整 profile 编译并写出 resolved manifest、lock、SBOM 输入和 profile 文件。 */
export function compileProfile({
  root = repoRoot(),
  distributionFile = path.join(root, 'distribution.yml'),
  profileFile = null,
  profileName,
  artifactsDir = path.join(root, 'artifacts'),
  fixtureRoot,
}: {
  root?: string;
  distributionFile?: string;
  profileFile?: string | null;
  profileName?: string;
  artifactsDir?: string;
  /** 仅测试使用的本地 bundle 夹具根目录。 */
  fixtureRoot?: string;
} = {}): CompiledProfile {
  const distribution = parseDistribution(distributionFile, { profilesRoot: path.join(root, 'profiles') });
  const selectedProfile = profileName || distribution.defaultProfile;
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(selectedProfile))
    fail(`profile 名称无效: ${selectedProfile}`, 'PROFILE_UNSELECTABLE');
  const selectedFile = profileFile || path.join(root, 'profiles', selectedProfile, 'profile.yml');
  const profile = parseProfile(selectedFile);
  if (profile.name !== selectedProfile)
    fail(`profile 目录与 manifest 名称不一致: ${selectedProfile} / ${profile.name}`, 'PROFILE_UNSELECTABLE');
  const profilePatch = readPatch(profile.patchFile);
  const collected = collectBundles(profile, root, { fixtureRoot });
  const input = inputSummary(
    distribution,
    profile,
    collected.bundles,
    profilePatch,
    collected.dependencyClosure,
    collected.allowBuilds,
  );
  const inputDigest = digest(input);
  const outputDir = path.join(artifactsDir, distribution.id, profile.name, inputDigest);
  const profileDir = path.join(outputDir, 'profile');
  fs.mkdirSync(profileDir, { recursive: true, mode: 0o700 });

  const dependencies = Object.fromEntries(
    collected.bundles
      .filter((bundle) => profileLocalDependency(bundle, fixtureRoot))
      .map((bundle) => [bundle.name, profileDependencySpec(bundle, profileDir)]),
  );
  writeJson(path.join(profileDir, 'package.json'), {
    name: `${distribution.packageScope}/${profile.name}-profile`,
    private: true,
    version: distribution.version,
    engines: { node: profile.runtime.nodeEngine },
    dependencies,
    dsh: { profile: { bundles: profile.bundles.slice() } },
  });
  writeText(
    path.join(profileDir, 'cordis.patch.yml'),
    profilePatch.length ? `${stringifyYaml(profilePatch)}\n` : '[]\n',
  );
  writeText(path.join(profileDir, 'cordis.yml'), '[]\n');
  writeText(
    path.join(profileDir, 'pnpm-workspace.yaml'),
    `${stringifyYaml({ packages: ['.'], nodeLinker: 'hoisted', autoInstallPeers: false, onlyBuiltDependencies: collected.allowBuilds })}\n`,
  );
  const pnpmEvidence = resolvePnpmLock(root, profileDir);

  const resolved: ResolvedManifest = {
    schema: 'dsh-forge/resolved-manifest@1',
    inputDigest,
    generatedAt: 'deterministic',
    tools: TOOL_VERSIONS,
    pnpmEvidence: {
      generated: pnpmEvidence.generated.command,
      frozen: pnpmEvidence.frozen.command,
      lockfileDigest: pnpmEvidence.lockfileDigest,
    },
    distribution: {
      id: distribution.id,
      name: distribution.name,
      applicationId: distribution.applicationId,
      version: distribution.version,
      packageScope: distribution.packageScope,
      channel: distribution.channel,
      platforms: distribution.platforms,
      updates: distribution.updates,
    },
    profile: { name: profile.name, runtime: profile.runtime, bundles: profile.bundles },
    bundles: collected.bundles.map((bundle) => ({
      name: bundle.name,
      version: bundle.version,
      source: bundle.source,
      integrity: bundle.source.integrity,
      license: bundle.license,
      dependencies: Object.entries(bundle.dependencies).map(([name, spec]) => ({
        name,
        spec,
        source: normalizeGit(spec),
      })),
      peerDependencies: bundle.peerDependencies,
      scripts: bundle.scripts,
      allowBuilds: bundle.allowBuilds || [],
    })),
    dependencyClosure: collected.dependencyClosure,
    allowBuilds: collected.allowBuilds,
    lockfile: { digest: pnpmEvidence.lockfileDigest, version: pnpmEvidence.lock.lockfileVersion ?? null },
    input,
  };
  writeJson(path.join(outputDir, 'resolved-manifest.json'), resolved);
  const sbomPackages = collected.dependencyClosure.map((dependency) => ({
    name: dependency.name,
    versionInfo: dependency.version || 'NOASSERTION',
    licenseConcluded: dependency.license,
    downloadLocation: dependency.source.path || 'NOASSERTION',
    checksums: dependency.source.integrity
      ? [{ algorithm: 'SHA256', checksumValue: dependency.source.integrity.replace(/^sha256-/, '') }]
      : [],
  }));
  writeJson(path.join(outputDir, 'sbom.input.json'), {
    SPDXID: 'SPDXRef-DOCUMENT',
    spdxVersion: 'SPDX-2.3',
    name: `${distribution.id}-${profile.name}`,
    packages: sbomPackages,
  });
  writeText(
    path.join(outputDir, 'THIRD-PARTY-NOTICES.txt'),
    collected.dependencyClosure
      .map((dependency) => `${dependency.name}@${dependency.version || 'unknown'}\nLicense: ${dependency.license}\n`)
      .join('\n'),
  );
  return {
    root,
    distribution,
    profile,
    bundles: collected.bundles,
    dependencyClosure: collected.dependencyClosure,
    inputDigest,
    outputDir,
    profileDir,
    resolved,
  };
}

/** 编译 profile 的公开快捷入口；与 compileProfile 使用相同的确定性语义。 */
export function resolveProfile(options: Parameters<typeof compileProfile>[0] = {}): CompiledProfile {
  return compileProfile(options);
}

/** 查找指定发行版/profile 下按修改时间最新的编译产物目录。 */
export function findLatestArtifact(root: string, distributionId: string, profileName: string): string | null {
  const dir = path.join(root, 'artifacts', distributionId, profileName);
  if (!fs.existsSync(dir)) return null;
  const entries = fs
    .readdirSync(dir)
    .filter((entry) => fs.existsSync(path.join(dir, entry, 'resolved-manifest.json')))
    .sort((left, right) => fs.statSync(path.join(dir, right)).mtimeMs - fs.statSync(path.join(dir, left)).mtimeMs);
  return entries.length ? path.join(dir, entries[0]!) : null;
}

function compareGeneratedFile(existingDir: string, rebuiltDir: string, file: string): void {
  const existing = path.join(existingDir, file);
  const rebuilt = path.join(rebuiltDir, file);
  if (!fs.existsSync(existing)) fail(`profile 产物缺少 ${file}`, 'VERIFY_ARTIFACT_MISSING');
  if (fs.readFileSync(existing, 'utf8') !== fs.readFileSync(rebuilt, 'utf8')) {
    fail(
      `生成文件漂移: ${file}；请重新执行 profile:resolve`,
      file === 'pnpm-lock.yaml' ? 'VERIFY_LOCK_DRIFT' : 'VERIFY_OUTPUT_DRIFT',
    );
  }
}

/** 将现有 artifact 与临时重编译结果逐文件比较，确认 profile 未发生漂移。 */
export function verifyProfile({
  root = repoRoot(),
  distributionFile = path.join(root, 'distribution.yml'),
  profileFile = null,
  profileName,
  artifactsDir = path.join(root, 'artifacts'),
}: {
  root?: string;
  distributionFile?: string;
  profileFile?: string | null;
  profileName?: string;
  artifactsDir?: string;
} = {}): CompiledProfile & { readonly verified: true } {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-verify-'));
  try {
    const rebuilt = compileProfile({ root, distributionFile, profileFile, profileName, artifactsDir: scratch });
    const existingDir = path.join(artifactsDir, rebuilt.distribution.id, rebuilt.profile.name, rebuilt.inputDigest);
    if (!fs.existsSync(existingDir)) fail(`profile 尚未解析: ${rebuilt.profile.name}`, 'VERIFY_ARTIFACT_MISSING');
    const existingManifest = JSON.parse(fs.readFileSync(path.join(existingDir, 'resolved-manifest.json'), 'utf8'));
    if (existingManifest.inputDigest !== rebuilt.inputDigest)
      fail('源文件、依赖或工具版本已变化；请重新执行 profile:resolve', 'VERIFY_DIGEST_DRIFT');
    if (JSON.stringify(stable(existingManifest.input)) !== JSON.stringify(stable(rebuilt.resolved.input)))
      fail('resolved manifest 输入内容漂移', 'VERIFY_INPUT_DRIFT');
    if (JSON.stringify(stable(existingManifest.tools)) !== JSON.stringify(stable(TOOL_VERSIONS)))
      fail('工具版本漂移；请重新解析 profile', 'VERIFY_TOOL_DRIFT');
    for (const file of ['package.json', 'cordis.patch.yml', 'cordis.yml', 'pnpm-workspace.yaml', 'pnpm-lock.yaml'])
      compareGeneratedFile(path.join(existingDir, 'profile'), rebuilt.profileDir, file);
    for (const file of ['resolved-manifest.json', 'sbom.input.json', 'THIRD-PARTY-NOTICES.txt'])
      compareGeneratedFile(existingDir, rebuilt.outputDir, file);
    return {
      ...rebuilt,
      outputDir: existingDir,
      profileDir: path.join(existingDir, 'profile'),
      resolved: existingManifest,
      verified: true,
    };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

/** 使用 frozen lockfile 检查 workspace 可复现安装，并返回锁文件摘要证据。 */
export function verifyFrozenWorkspaceLock(root = repoRoot()): {
  readonly command: string;
  readonly lockfileDigest: string;
} {
  const result = runPnpm(root, root, ['install', '--lockfile-only', '--frozen-lockfile', '--ignore-scripts']);
  return { command: result.command, lockfileDigest: `sha256-${sha256File(path.join(root, 'pnpm-lock.yaml'))}` };
}
