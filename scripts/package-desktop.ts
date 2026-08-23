import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolveProfile } from '@dsh-forge/profile-toolchain/compiler';
import { writeConfigDump } from '@dsh-forge/profile-toolchain/composer';
import { parseDistribution } from '@dsh-forge/profile-toolchain/schema';
import { createRuntimeManifest, generateEvidence } from '@dsh-forge/profile-toolchain/release';
import { fail } from '@dsh-forge/profile-toolchain/core/errors';
import {
  resolveElectronBinary,
  resolvePackageBin,
  spawnFailureDetails,
  spawnFailureMessage,
} from '@dsh-forge/profile-toolchain/core/process';
import { errorCode, errorMessage } from '@dsh-forge/profile-toolchain/types';
import type { CompiledProfile } from '@dsh-forge/profile-toolchain/compiler';
import type { Distribution, RuntimePlatform } from '@dsh-forge/profile-toolchain/schema';

/** Electron 目录产物构建脚本；构建前必须已有已验证 profile 和 config dump。 */

interface BuilderConfigInput {
  readonly outputDir: string;
  /** 为 electron-builder 准备的 profile 配置目录，不包含 node_modules。 */
  readonly packagedProfileDir: string;
  /** 独立的 Electron 应用 staging，包含唯一一棵生产依赖闭包。 */
  readonly appStagingDir: string;
  readonly resolved: CompiledProfile['resolved'];
  readonly distribution: Distribution;
  readonly targetName?: DesktopTargetName;
  readonly formats: readonly PackageFormat[];
}

interface BuilderResult {
  readonly command: string;
  readonly output: string;
}

interface NativeRebuildResult {
  readonly command: string;
  readonly output: string;
  readonly electronAbi: string;
  readonly architectures: readonly string[];
}

type DesktopTargetName = 'darwin-universal' | 'win32-x64' | 'linux-x64';
type PackageFormat = 'dir' | 'dmg' | 'zip' | 'nsis' | 'AppImage' | 'deb';

const DEFAULT_ELECTRON_REBUILD_DIST_URL = 'https://www.electronjs.org/headers';
const NATIVE_REBUILD_TIMEOUT_MS = 15 * 60_000;
const ELECTRON_BUILDER_TIMEOUT_MS = 45 * 60_000;
// @electron/universal 仍会处理 app.asar.unpacked；目录已经编码 Darwin 架构的包、
// prebuilds/darwin-* 与已 universal 的文件必须保留，不能对同路径副本再次执行 lipo。
const MACOS_UNIVERSAL_X64_ARCH_FILES = '**/node_modules/{**/*-darwin-*/**,**/prebuilds/darwin-*/**,**/*darwin-universal*}';

interface PackageOptions {
  readonly profileName?: string;
  readonly targetName?: DesktopTargetName;
  readonly formats: readonly PackageFormat[];
}

/**
 * 最终 profile 闭包包含深层第三方依赖。已解包应用必须位于短路径，避免 Windows
 * 将 ConPTY helper 复制到 artifact digest 下后突破文件系统路径限制。
 */
function prepareDesktopWorkDirectory(root: string, targetName: DesktopTargetName | undefined): string {
  const target = targetName || `${process.platform}-${process.arch}`;
  const directory = path.join(root, '.desktop-work', target);
  if (fs.existsSync(directory)) fs.rmSync(directory, { recursive: true, force: true });
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  return directory;
}

function rootDirectory(): string {
  return path.resolve(__dirname, '..');
}

/** 生成 electron-builder 配置，明确 runtime、profile、catalog 和审计证据的位置。 */
function builderConfig({
  outputDir,
  packagedProfileDir,
  appStagingDir,
  resolved,
  distribution,
  targetName,
  formats,
}: BuilderConfigInput): Record<string, unknown> {
  const artifactDir = path.dirname(packagedProfileDir);
  const config: Record<string, unknown> = {
    appId: distribution.applicationId,
    productName: distribution.branding.productName,
    // 根 package 名称带 scope，不能让 builder 推导出非法的 Linux/Windows 文件名。
    executableName: distribution.id,
    directories: { app: appStagingDir, output: outputDir },
    asar: true,
    // native addon 已由本脚本按 Electron ABI 重建，禁止 builder 再次修改 profile 闭包。
    npmRebuild: false,
    // 只有 native addon 与必须的 helper 需要离开 asar；JS 依赖保持在单一 app.asar 中。
    asarUnpack: ['**/*.node', '**/helpers/**'],
    files: [
      'dist/**',
      'packages/**',
      'catalog/**',
      'package.json',
      'distribution.yml',
      'node_modules/**',
      '!node_modules/.cache/**',
      '!node_modules/**/.pnpm-store/**',
    ],
    extraResources: [
      // profile 配置在 builder 阶段进入资源；node_modules 在最终 app 生成后只复制一次。
      { from: packagedProfileDir, to: 'dsh-forge/profile', filter: ['**/*'] },
      // app.asar 不能作为 DSH Home 中模块链接的稳定文件系统目标。将 launcher 临时注入的
      // 两个包保留在 resources 的真实目录，启动时再物化到受管 profile。
      { from: path.join(appStagingDir, 'launcher-fallback'), to: 'dsh-forge/launcher-fallback', filter: ['**/*'] },
      { from: path.join(artifactDir, 'resolved-manifest.json'), to: 'dsh-forge/resolved-manifest.json' },
      { from: path.join(artifactDir, 'sbom.input.json'), to: 'dsh-forge/sbom.input.json' },
      { from: path.join(artifactDir, 'THIRD-PARTY-NOTICES.txt'), to: 'dsh-forge/THIRD-PARTY-NOTICES.txt' },
    ],
    artifactName: `${distribution.id}-${resolved.profile.name}-${distribution.version}-\${os}-\${arch}.\${ext}`,
  };
  // electron-builder 会校验整个配置对象。只写入当前 runner 的平台段，避免无关平台的
  // 字段或版本差异阻断本次构建；Universal 的 profile 闭包在 builder 后复制，不参与 ASAR 合并。
  if (targetName === 'darwin-universal' || (!targetName && process.platform === 'darwin')) {
    config.mac = {
      target: formats,
      ...(targetName === 'darwin-universal'
        ? {
          mergeASARs: false,
          x64ArchFiles: MACOS_UNIVERSAL_X64_ARCH_FILES,
        }
        : {}),
    };
  } else if (targetName === 'win32-x64' || (!targetName && process.platform === 'win32')) {
    config.win = { target: formats };
  } else if (targetName === 'linux-x64' || (!targetName && process.platform === 'linux')) {
    config.linux = {
      target: formats,
      category: 'Utility',
      // FPM 生成 deb 控制文件需要维护者；发行身份由 distribution 统一提供。
      maintainer: distribution.branding.publisher,
      vendor: distribution.branding.publisher,
      // desktopName 是 app package.json metadata，Linux 配置仅负责同步该名称。
      syncDesktopName: true,
    };
  }
  if (process.env.DSH_FORGE_ELECTRON_ZIP) {
    const electronZip = path.resolve(process.env.DSH_FORGE_ELECTRON_ZIP);
    if (!fs.existsSync(electronZip)) fail(`Electron 压缩包不存在: ${electronZip}`, 'ELECTRON_DIST_MISSING');
    config.electronDist = electronZip;
  }
  return config;
}

function writeBuilderConfig(configFile: string, input: BuilderConfigInput): void {
  fs.writeFileSync(configFile, `${JSON.stringify(builderConfig(input), null, 2)}\n`, { mode: 0o600 });
}

const APP_RUNTIME_ROOTS = Object.freeze([
  '@dsh-forge/profile-toolchain',
  '@dsh-forge/desktop-services-local',
  '@dsh-forge/desktop-services',
  '@dsh-forge/desktop-layer',
  '@deepseek-ai/cordis',
  'semver',
  'yaml',
  '@electron/asar',
  'pnpm',
] as const);

/** 编译器在开发/构建阶段需要 DSH，但打包应用从 profile 闭包加载 DSH。
 * 将这些包排除在 Electron 主进程闭包外，避免生成第二份 DSH runtime。 */
const PROFILE_ONLY_RUNTIME_PREFIXES = Object.freeze(['@deepseek-ai/dsh'] as const);

function isProfileOnlyRuntimePackage(name: string): boolean {
  return PROFILE_ONLY_RUNTIME_PREFIXES.some((prefix) => name === prefix || name.startsWith(`${prefix}-`));
}

function resolveInstalledPackageDirectory(root: string, packageName: string): string | null {
  const anchor = path.join(root, 'package.json');
  const requireFromRoot = createRequire(anchor);
  try {
    const entry = requireFromRoot.resolve(packageName);
    let directory = path.dirname(entry);
    for (let depth = 0; depth < 8; depth += 1) {
      if (fs.existsSync(path.join(directory, 'package.json'))) {
        const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8')) as { name?: unknown };
        if (manifest.name === packageName) return fs.realpathSync(directory);
      }
      const parent = path.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  } catch {
    // 某些 workspace exports 不开放 package.json；下面的目录扫描保留兼容性。
  }
  for (const searchPath of requireFromRoot.resolve.paths(packageName) || []) {
    const candidate = path.join(searchPath, ...packageName.split('/'));
    if (fs.existsSync(path.join(candidate, 'package.json'))) return fs.realpathSync(candidate);
  }
  return null;
}

function packageDependencyNames(manifest: Record<string, unknown>): readonly string[] {
  const sections = ['dependencies', 'optionalDependencies', 'peerDependencies'] as const;
  return [...new Set(sections.flatMap((section) => {
    const value = manifest[section];
    return value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : [];
  }))];
}

/**
 * 生成只包含 Electron 主进程真实入口的物理 production closure。
 * 每个包只复制一次，去掉 pnpm workspace 链接和 profile 专属 DSH 依赖。
 */
function createDesktopAppStaging(root: string, compiled: CompiledProfile, distribution: Distribution): string {
  const staging = path.join(compiled.outputDir, 'desktop-deploy');
  if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(path.join(staging, 'node_modules'), { recursive: true, mode: 0o700 });
  for (const directory of ['dist', 'packages', 'catalog']) {
    const source = path.join(root, directory);
    if (!fs.existsSync(source)) fail(`应用 staging 缺少 ${directory}`, 'PACKAGE_APP_STAGING_MISSING');
    fs.cpSync(source, path.join(staging, directory), { recursive: true, dereference: true });
  }
  for (const file of ['distribution.yml']) fs.copyFileSync(path.join(root, file), path.join(staging, file));

  const packageNames = new Set<string>();
  const queue: string[] = [...APP_RUNTIME_ROOTS];
  while (queue.length) {
    const name = queue.shift()!;
    if (packageNames.has(name) || isProfileOnlyRuntimePackage(name)) continue;
    const directory = resolveInstalledPackageDirectory(root, name);
    if (!directory) {
      // optional peer 在当前平台缺失时由实际 package resolver 处理；必需入口必须存在。
      if ((APP_RUNTIME_ROOTS as readonly string[]).includes(name))
        fail(`应用 production closure 缺少 ${name}`, 'PACKAGE_APP_CLOSURE_MISSING');
      continue;
    }
    packageNames.add(name);
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8')) as Record<string, unknown>;
    for (const dependency of packageDependencyNames(manifest)) queue.push(dependency);
  }

  for (const name of [...packageNames].sort()) {
    const source = resolveInstalledPackageDirectory(root, name);
    if (!source) fail(`应用 production closure 无法读取 ${name}`, 'PACKAGE_APP_CLOSURE_MISSING');
    const destination = path.join(staging, 'node_modules', ...name.split('/'));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.cpSync(source, destination, {
      recursive: true,
      dereference: true,
      filter: (candidate) => path.basename(candidate) !== 'node_modules' && path.basename(candidate) !== '.bin',
    });
  }

  const rootPackage = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as Record<string, unknown>;
  const stagedPackage: Record<string, unknown> = {
    name: rootPackage.name,
    version: rootPackage.version,
    private: true,
    type: rootPackage.type,
    main: rootPackage.main,
    description: rootPackage.description,
    homepage: rootPackage.homepage,
    // electron-builder 26 从应用 package.json 读取 desktopName；不能放入 linux 配置。
    desktopName: distribution.id,
    dependencies: Object.fromEntries(
      [...packageNames]
        .filter((name) => (APP_RUNTIME_ROOTS as readonly string[]).includes(name))
        .map((name) => {
          const manifest = JSON.parse(fs.readFileSync(path.join(staging, 'node_modules', ...name.split('/'), 'package.json'), 'utf8')) as { version?: string };
          return [name, manifest.version || '*'];
        }),
    ),
  };
  fs.writeFileSync(path.join(staging, 'package.json'), `${JSON.stringify(stagedPackage, null, 2)}\n`, { mode: 0o600 });
  const fallbackRoot = path.join(staging, 'launcher-fallback');
  fs.mkdirSync(path.join(fallbackRoot, 'node_modules'), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(fallbackRoot, 'package.json'), '{"name":"dsh-forge-launcher-fallback","private":true,"type":"module"}\n', {
    mode: 0o600,
  });
  for (const packageName of ['@dsh-forge/desktop-layer', '@dsh-forge/desktop-services-local']) {
    const source = path.join(staging, 'node_modules', ...packageName.split('/'));
    const destination = path.join(fallbackRoot, 'node_modules', ...packageName.split('/'));
    if (!fs.existsSync(source)) fail(`应用 staging 缺少 launcher fallback 包: ${packageName}`, 'PACKAGE_APP_CLOSURE_MISSING');
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    fs.cpSync(source, destination, { recursive: true, dereference: true });
  }
  if (fs.existsSync(path.join(staging, 'node_modules', '@deepseek-ai', 'dsh')))
    fail('应用 staging 不得包含 profile 专属 DSH runtime', 'PACKAGE_APP_CLOSURE_DUPLICATE_RUNTIME');
  assertNoSymbolicLinks(staging);
  return staging;
}

function packageDirectoryFromAnchor(anchor: string, packageName: string): string | null {
  const requireFromAnchor = createRequire(anchor);
  for (const searchPath of requireFromAnchor.resolve.paths(packageName) || []) {
    const directory = path.join(searchPath, ...packageName.split('/'));
    if (fs.existsSync(path.join(directory, 'package.json'))) return fs.realpathSync(directory);
  }
  return null;
}

/** 确认解引用后的包资源中没有会在安装包中悬挂的链接。 */
function assertNoSymbolicLinks(directory: string): void {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) fail(`打包 profile 仍包含符号链接: ${target}`, 'PACKAGE_PROFILE_SYMLINK');
    if (stat.isDirectory()) assertNoSymbolicLinks(target);
  }
}

/**
 * 只把 profile 的配置文件交给 electron-builder。
 * node_modules 在最终应用生成后由 copyPackagedProfileClosure 复制一次，避免
 * builder 先复制完整闭包、Universal 阶段再复制一遍。
 */
function materializePackagedProfile(compiled: CompiledProfile): string {
  const source = compiled.profileDir;
  const destination = path.join(compiled.outputDir, 'packaged-profile');
  if (fs.existsSync(destination)) fs.rmSync(destination, { recursive: true, force: true });
  fs.cpSync(source, destination, {
    recursive: true,
    dereference: false,
    verbatimSymlinks: true,
    filter: (candidate) => path.basename(candidate) !== 'node_modules',
  });
  const anchor = path.join(destination, 'package.json');
  if (!fs.existsSync(anchor)) fail('打包 profile 缺少 package.json 模块锚点', 'PACKAGE_PROFILE_ANCHOR_MISSING');
  return destination;
}

/** 选择当前 OS/架构的声明目标，不允许构建未登记的平台。 */
function parseOptions(argv: readonly string[], distribution: Distribution): PackageOptions {
  const positional: string[] = [];
  let targetName: DesktopTargetName | undefined;
  let formats: readonly PackageFormat[] | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === '--target') {
      const value = argv[++index];
      if (!['darwin-universal', 'win32-x64', 'linux-x64'].includes(value || ''))
        fail(`打包 target 无效: ${value || ''}`, 'PACKAGE_TARGET_INVALID');
      targetName = value as DesktopTargetName;
    } else if (argument === '--formats') {
      const value = argv[++index];
      if (!value) fail('打包 formats 不能为空', 'PACKAGE_FORMAT_INVALID');
      const parsed = value.split(',').map((item) => item.trim()).filter(Boolean) as PackageFormat[];
      if (!parsed.length || parsed.some((item) => !['dir', 'dmg', 'zip', 'nsis', 'AppImage', 'deb'].includes(item)))
        fail(`打包 formats 无效: ${value}`, 'PACKAGE_FORMAT_INVALID');
      formats = [...new Set(parsed)];
    } else if (argument !== '--') positional.push(argument);
  }
  const selected = targetName;
  const defaultFormats: readonly PackageFormat[] = selected
    ? selected === 'darwin-universal'
      ? ['dmg', 'zip']
      : selected === 'win32-x64'
        ? ['nsis', 'zip']
        : ['AppImage', 'deb']
    : ['dir'];
  if (formats && formats.includes('dir') && formats.length > 1)
    fail('formats 不能同时包含 dir 与安装包格式', 'PACKAGE_FORMAT_INVALID');
  const effectiveFormats = formats || defaultFormats;
  const profileName = positional.find((item) => item && item !== '--target' && item !== '--formats');
  if (selected) {
    const expectedPlatform = selected.split('-')[0] as RuntimePlatform['os'];
    if (process.platform !== expectedPlatform)
      fail(`打包 target ${selected} 与当前 runner ${process.platform}-${process.arch} 不匹配`, 'PACKAGE_RUNNER_MISMATCH');
  }
  const target = selected
    ? selected === 'darwin-universal'
      ? { os: 'darwin' as const, architectures: ['arm64', 'x64'] as const }
      : selected === 'win32-x64'
        ? { os: 'win32' as const, architectures: ['x64'] as const }
        : { os: 'linux' as const, architectures: ['x64'] as const }
    : { os: process.platform as RuntimePlatform['os'], architectures: [process.arch as RuntimePlatform['architectures'][number]] };
  const declared = distribution.platforms.find((candidate) => candidate.os === target.os);
  if (!declared || target.architectures.some((architecture) => !declared.architectures.includes(architecture)))
    fail(`target ${selected || `${target.os}-${target.architectures[0]}`} 未在 distribution.yml 中完整声明`, 'PACKAGE_TARGET_UNSUPPORTED');
  if (!selected && !['darwin', 'win32', 'linux'].includes(process.platform))
    fail(`当前平台不支持桌面产物构建: ${process.platform}`, 'PACKAGE_TARGET_UNSUPPORTED');
  return { profileName, targetName, formats: effectiveFormats };
}

/** 读取实际 Electron runtime 的 ABI，禁止以构建 Node 的 ABI 冒充目标 ABI。 */
function electronAbi(root: string, expectedVersion: string): string {
  let binary: string;
  try {
    binary = resolveElectronBinary(root);
  } catch (error) {
    fail(`未安装 Electron runtime: ${errorMessage(error)}`, 'ELECTRON_RUNTIME_MISSING');
  }
  const childEnv: NodeJS.ProcessEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
  delete childEnv.NODE_OPTIONS;
  const result = spawnSync(binary, ['-p', 'JSON.stringify({ electron: process.versions.electron, abi: process.versions.modules })'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000,
    env: childEnv,
  });
  if (result.status !== 0)
    fail(`无法读取 Electron ABI: ${spawnFailureMessage(result, 'unknown error')}`, 'ELECTRON_ABI', spawnFailureDetails(result));
  let value: { electron?: unknown; abi?: unknown };
  try {
    value = JSON.parse(result.stdout.trim()) as { electron?: unknown; abi?: unknown };
  } catch {
    fail(`Electron ABI 输出无效: ${spawnFailureMessage(result, 'stdout 为空或不是 JSON')}`, 'ELECTRON_ABI', spawnFailureDetails(result));
  }
  if (value.electron !== expectedVersion || typeof value.abi !== 'string' || !/^\d+$/.test(value.abi))
    fail(`Electron runtime 与 profile 不一致: ${String(value.electron)} / ${expectedVersion}`, 'ELECTRON_ABI');
  return value.abi;
}

function profilePnpmBinary(root: string): string {
  const binary = path.join(root, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs');
  if (!fs.existsSync(binary)) fail('未找到固定 pnpm runtime', 'PNPM_RUNTIME_MISSING');
  return binary;
}

/** Universal staging 必须同时包含两个 Darwin optional native 包，不能沿用 arm64 物化结果。 */
function installUniversalProfileDependencies(root: string, profileDir: string): void {
  const packageFile = path.join(profileDir, 'package.json');
  const original = fs.readFileSync(packageFile, 'utf8');
  const nodeModules = path.join(profileDir, 'node_modules');
  if (fs.existsSync(nodeModules)) fs.rmSync(nodeModules, { recursive: true, force: true });
  const binary = profilePnpmBinary(root);
  // pnpm 11 已将 supportedArchitectures 从 package.json 迁移为 CLI 选项；重复
  // --cpu 会让同一份 profile 同时保留 arm64 与 x64 的 optionalDependencies。
  const installArgs = [
    binary,
    'install',
    '--prefer-offline',
    '--frozen-lockfile',
    '--force',
    '--os=darwin',
    '--cpu=arm64',
    '--cpu=x64',
  ];
  let result: SpawnSyncReturns<string>;
  try {
    result = spawnSync(process.execPath, installArgs, {
      cwd: profileDir,
      encoding: 'utf8',
      timeout: NATIVE_REBUILD_TIMEOUT_MS,
      env: {
        ...process.env,
        CI: 'true',
        ELECTRON_RUN_AS_NODE: '1',
      },
    });
  } finally {
    fs.writeFileSync(packageFile, original, { mode: 0o600 });
  }
  if (result.status !== 0)
    fail(
      `Universal profile 依赖安装失败: ${spawnFailureMessage(result, 'unknown error')}`,
      'PNPM_RESOLUTION_FAILED',
      { ...spawnFailureDetails(result), command: installArgs.slice(1) },
    );
}

function nodePtyDirectories(profileDir: string): string[] {
  const result: string[] = [];
  const visited = new Set<string>();
  const walk = (directory: string): void => {
    let real: string;
    try {
      real = fs.realpathSync(directory);
    } catch {
      return;
    }
    if (visited.has(real)) return;
    visited.add(real);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(real, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const candidate = path.join(real, entry.name);
      if (entry.name === 'node-pty' && fs.existsSync(path.join(candidate, 'package.json'))) result.push(candidate);
      if (entry.isDirectory() || entry.isSymbolicLink()) walk(candidate);
    }
  };
  walk(path.join(profileDir, 'node_modules'));
  return [...new Set(result.map((directory) => fs.realpathSync(directory)))].sort();
}

function copyNativeFile(source: string, destination: string): boolean {
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) return false;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  fs.chmodSync(destination, fs.statSync(source).mode & 0o777);
  return true;
}

/**
 * electron-rebuild 会把 node-pty 写入 build/Release。Universal 构建只暂存这些
 * 少量 native 文件，再按 process.arch 放回 prebuilds，避免复制完整 profile 两次，
 * 并删除 host-specific build/Release，防止它覆盖另一架构。
 */
function rebuildUniversalNodePty(
  profileDir: string,
  architecture: string,
  temporaryRoot: string,
): number {
  const capturedRoot = path.join(temporaryRoot, architecture);
  let captured = 0;
  for (const [index, directory] of nodePtyDirectories(profileDir).entries()) {
    const release = path.join(directory, 'build', 'Release');
    for (const name of ['pty.node', 'spawn-helper']) {
      if (copyNativeFile(path.join(release, name), path.join(capturedRoot, String(index), name))) captured += 1;
    }
    if (fs.existsSync(release)) fs.rmSync(release, { recursive: true, force: true });
  }
  return captured;
}

function installUniversalNodePtyPrebuilds(
  profileDir: string,
  temporaryRoot: string,
  architectures: readonly string[],
): void {
  const directories = nodePtyDirectories(profileDir);
  for (const [index, directory] of directories.entries()) {
    for (const architecture of architectures) {
      const sourceRoot = path.join(temporaryRoot, architecture, String(index));
      const targetRoot = path.join(directory, 'prebuilds', `darwin-${architecture}`);
      const copied = ['pty.node', 'spawn-helper'].filter((name) => copyNativeFile(path.join(sourceRoot, name), path.join(targetRoot, name)));
      if (copied.length !== 2)
        fail(`node-pty ${architecture} native 输出不完整: ${directory}`, 'ELECTRON_REBUILD_FAILED');
    }
    const release = path.join(directory, 'build', 'Release');
    if (fs.existsSync(release)) fs.rmSync(release, { recursive: true, force: true });
  }
}

function profileRelativeDirectory(profileDir: string, directory: string): string {
  const relative = path.relative(profileDir, directory);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
    fail(`native staging 路径越过 profile 根目录: ${directory}`, 'ELECTRON_REBUILD_FAILED');
  return relative;
}

/**
 * Windows 的 MSBuild 会在 node-pty 源目录写入大量中间文件。artifact digest 加上嵌套依赖
 * 容易突破其路径上限，因此只在短临时路径重建，并将受控 build 输出回写至正式 profile。
 */
function copyWindowsNodePtyBuildOutputs(stagedProfileDir: string, profileDir: string): number {
  let copied = 0;
  for (const stagedDirectory of nodePtyDirectories(stagedProfileDir)) {
    const stagedBuild = path.join(stagedDirectory, 'build');
    if (!fs.existsSync(stagedBuild) || !fs.statSync(stagedBuild).isDirectory())
      fail(`Windows node-pty 未生成 build 输出: ${stagedDirectory}`, 'ELECTRON_REBUILD_FAILED');
    const relativeDirectory = profileRelativeDirectory(stagedProfileDir, stagedDirectory);
    const profileDirectory = path.join(profileDir, relativeDirectory);
    if (!fs.existsSync(path.join(profileDirectory, 'package.json')))
      fail(`Windows profile 缺少 node-pty 目录: ${profileDirectory}`, 'ELECTRON_REBUILD_FAILED');
    const profileBuild = path.join(profileDirectory, 'build');
    if (fs.existsSync(profileBuild)) fs.rmSync(profileBuild, { recursive: true, force: true });
    fs.cpSync(stagedBuild, profileBuild, { recursive: true, dereference: true });
    copied += 1;
  }
  if (!copied) fail('Windows profile 未发现 node-pty 原生模块', 'ELECTRON_REBUILD_FAILED');
  return copied;
}

/** 仅重建 profile 闭包内已审计的 node-pty，超时或未发现模块均阻断打包。 */
function rebuildProfileNativeAddons(
  root: string,
  profileDir: string,
  electronVersion: string,
  architectures: readonly string[],
): NativeRebuildResult {
  const binary = path.join(root, 'node_modules', '@electron', 'rebuild', 'lib', 'cli.js');
  if (!fs.existsSync(binary)) fail('未安装 @electron/rebuild', 'ELECTRON_REBUILD_MISSING');
  const abi = electronAbi(root, electronVersion);
  const universal = architectures.length > 1;
  const reports: string[] = [];
  const commands: string[] = [];
  const universalNativeRoot = universal && process.platform === 'darwin'
    ? fs.mkdtempSync(path.join(path.dirname(profileDir), 'native-node-pty-'))
    : null;
  const windowsStagingRoot = process.platform === 'win32'
    ? fs.mkdtempSync(path.join(os.tmpdir(), 'dshf-native-'))
    : null;
  const moduleDir = windowsStagingRoot ? path.join(windowsStagingRoot, 'p') : profileDir;
  try {
    if (windowsStagingRoot) fs.cpSync(profileDir, moduleDir, { recursive: true, dereference: true });
    if (universal) installUniversalProfileDependencies(root, profileDir);
    for (const architecture of architectures) {
      const args = [
        binary,
        '--version', electronVersion,
        '--module-dir', moduleDir,
        '--only', 'node-pty',
        '--force', '--arch', architecture,
        '--types', 'prod,optional',
      ];
      const rebuildDistUrl = process.env.ELECTRON_REBUILD_DIST_URL || DEFAULT_ELECTRON_REBUILD_DIST_URL;
      const result = spawnSync(process.execPath, args, {
        cwd: moduleDir,
        encoding: 'utf8',
        timeout: NATIVE_REBUILD_TIMEOUT_MS,
        env: {
          ...process.env,
          ELECTRON_REBUILD_DIST_URL: rebuildDistUrl,
        },
      });
      const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
      if (result.status !== 0 || result.signal || !output.includes('node-pty'))
        fail(
          `Electron native addon 重建失败 (${architecture}): ${spawnFailureMessage(result, output || 'unknown error')}`,
          'ELECTRON_REBUILD_FAILED',
          { ...spawnFailureDetails(result), args: args.slice(1), headersUrl: rebuildDistUrl },
        );
      reports.push(`[${architecture}] ${output}`);
      commands.push(`${process.execPath} ${args.join(' ')}`);
      if (universal) {
        const captured = rebuildUniversalNodePty(profileDir, architecture, universalNativeRoot!);
        if (captured === 0) fail(`node-pty ${architecture} 未生成 native 输出`, 'ELECTRON_REBUILD_FAILED');
      }
    }
    if (universalNativeRoot) installUniversalNodePtyPrebuilds(profileDir, universalNativeRoot, architectures);
    if (windowsStagingRoot) copyWindowsNodePtyBuildOutputs(moduleDir, profileDir);
    return { command: commands.join(' && '), output: reports.join('\n'), electronAbi: abi, architectures: architectures.slice() };
  } finally {
    if (universalNativeRoot) fs.rmSync(universalNativeRoot, { recursive: true, force: true });
    if (windowsStagingRoot) fs.rmSync(windowsStagingRoot, { recursive: true, force: true });
  }
}

/** 调用 electron-builder；Universal 产物允许 45 分钟复制、合并和压缩预算。 */
function runBuilder(
  root: string,
  configFile: string,
  targetName: DesktopTargetName | undefined,
  formats: readonly PackageFormat[],
  prepackaged?: string,
): BuilderResult {
  let binary: string;
  try {
    binary = resolvePackageBin(root, 'electron-builder', 'electron-builder');
  } catch (error) {
    fail(`未安装 electron-builder: ${errorMessage(error)}`, 'ELECTRON_BUILDER_MISSING');
  }
  // Tag 只触发构建；发布由 workflow 的 release job 统一处理，避免 builder
  // 根据 git tag 隐式访问 GitHub Release 并在 package job 中失败。
  const args = ['--config', configFile, '--publish', 'never'];
  if (prepackaged) {
    if (!fs.existsSync(prepackaged))
      fail(`已解包 Electron 应用不存在: ${prepackaged}`, 'PACKAGE_ARTIFACT_MISSING');
    args.push('--prepackaged', path.resolve(prepackaged));
  }
  const builderFormats = formats.length ? formats : ['dir'];
  if (process.platform === 'darwin') args.push('--mac', ...builderFormats, ...(targetName === 'darwin-universal' ? ['--universal'] : [process.arch === 'arm64' ? '--arm64' : '--x64']));
  else if (process.platform === 'win32') args.push('--win', ...builderFormats, '--x64');
  else if (process.platform === 'linux') args.push('--linux', ...builderFormats, '--x64');
  else fail(`当前平台不支持桌面产物构建: ${process.platform}`, 'PACKAGE_TARGET_UNSUPPORTED');
  const builderCli = binary;
  const builderEnv: NodeJS.ProcessEnv = {
    ...process.env,
    CSC_IDENTITY_AUTO_DISCOVERY: 'false',
    ELECTRON_MIRROR: process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/',
  };
  delete builderEnv.NODE_OPTIONS;
  const result = spawnSync(process.execPath, [builderCli, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: ELECTRON_BUILDER_TIMEOUT_MS,
    env: builderEnv,
  });
  if (result.status !== 0)
    fail(
      `Electron Builder 失败: ${spawnFailureMessage(result, 'unknown error')}`,
      'ELECTRON_BUILDER_FAILED',
      { ...spawnFailureDetails(result), args },
    );
  return { command: `${process.execPath} ${builderCli} ${args.join(' ')}`, output: (result.stdout || result.stderr || '').trim() };
}

/**
 * 在构建输出中定位平台应用。electron-builder 的 macOS productFilename 会优先使用
 * executableName，因此不能按展示用 productName 查找 `.app` bundle。
 */
function findApplication(outputDir: string, executableName: string): string {
  const expected = process.platform === 'darwin'
    ? `${executableName}.app`
    : process.platform === 'win32'
      ? `${executableName}.exe`
      : null;
  const queue: string[] = [outputDir];
  while (queue.length) {
    const directory = queue.shift()!;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      if ((expected && entry.name === expected) || (process.platform === 'linux' && entry.isDirectory() && entry.name.includes('linux-unpacked'))) return candidate;
      if (entry.isDirectory()) queue.push(candidate);
    }
  }
  fail(`Electron Builder 未生成 ${expected || 'Linux 应用目录'}`, 'PACKAGE_ARTIFACT_MISSING');
}

function assertRequestedFormats(outputDir: string, formats: readonly PackageFormat[]): void {
  const extensions = new Set<string>();
  const walk = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'win-unpacked' || entry.name === 'linux-unpacked') continue;
        walk(candidate);
      }
      else if (entry.isFile()) extensions.add(path.extname(entry.name).toLowerCase());
    }
  };
  walk(outputDir);
  const expected = formats.filter((format) => format !== 'dir').map((format) => {
    if (format === 'nsis') return '.exe';
    if (format === 'AppImage') return '.appimage';
    return `.${format.toLowerCase()}`;
  });
  const missing = expected.filter((extension) => !extensions.has(extension));
  if (missing.length) fail(`Electron Builder 缺少请求格式: ${missing.join(', ')}`, 'PACKAGE_FORMAT_MISSING');
}

function assertUniversalApplication(application: string): void {
  if (process.platform !== 'darwin') return;
  const directory = path.join(application, 'Contents', 'MacOS');
  const executable = fs
    .readdirSync(directory)
    .map((name) => path.join(directory, name))
    .find((file) => (fs.statSync(file).mode & 0o111) !== 0);
  if (!executable) fail('macOS universal 应用缺少可执行入口', 'PACKAGE_UNIVERSAL_ARCHITECTURE');
  const result = spawnSync('lipo', ['-archs', executable], { encoding: 'utf8' });
  const architectures = (result.stdout || '').trim().split(/\s+/).filter(Boolean);
  if (result.status !== 0 || !architectures.includes('arm64') || !architectures.includes('x86_64'))
    fail(`macOS universal 应用缺少 arm64/x64 切片: ${architectures.join(',')}`, 'PACKAGE_UNIVERSAL_ARCHITECTURE');
}

/** 在最终应用生成后只复制一次完整 profile node_modules 闭包。 */
function copyPackagedProfileClosure(
  compiled: CompiledProfile,
  appStagingDir: string,
  application: string,
): string {
  const source = path.join(compiled.profileDir, 'node_modules');
  if (!fs.existsSync(source) || !fs.statSync(source).isDirectory())
    fail('打包 profile staging 缺少 node_modules 闭包', 'PACKAGE_PROFILE_CLOSURE_MISSING');
  const profile = process.platform === 'darwin'
    ? path.join(application, 'Contents', 'Resources', 'dsh-forge', 'profile')
    : process.platform === 'win32'
      ? path.join(path.dirname(application), 'resources', 'dsh-forge', 'profile')
      : path.join(application, 'resources', 'dsh-forge', 'profile');
  if (!fs.existsSync(path.join(profile, 'package.json')))
    fail(`最终应用缺少 profile 资源目录: ${profile}`, 'PACKAGED_PROFILE_MISSING');
  const destination = path.join(profile, 'node_modules');
  // 该目录只由本轮 builder 生成，profile 闭包不参与 builder 的依赖裁剪。
  if (fs.existsSync(destination)) fs.rmSync(destination, { recursive: true, force: true });
  fs.cpSync(source, destination, {
    recursive: true,
    dereference: true,
    filter: (candidate) => path.basename(candidate) !== '.bin',
  });
  // fallback 包需要在 resources 外部拥有真实目录，不能从 app.asar 建立操作系统
  // symlink；这里只复制 launcher 与其小型 service/toolchain 依赖，不复制 DSH runtime。
  for (const packageName of [
    '@dsh-forge/desktop-layer',
    '@dsh-forge/desktop-services-local',
    '@dsh-forge/desktop-services',
    '@dsh-forge/profile-toolchain',
    'semver',
    'yaml',
  ]) {
    const stagedPackage = path.join(appStagingDir, 'node_modules', ...packageName.split('/'));
    const profilePackage = path.join(destination, ...packageName.split('/'));
    if (!fs.existsSync(stagedPackage)) fail(`应用 staging 缺少 fallback 包: ${packageName}`, 'PACKAGE_APP_CLOSURE_MISSING');
    if (fs.existsSync(profilePackage)) fs.rmSync(profilePackage, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(profilePackage), { recursive: true });
    fs.cpSync(stagedPackage, profilePackage, { recursive: true, dereference: true });
  }
  assertNoSymbolicLinks(destination);
  const anchor = path.join(profile, 'package.json');
  for (const dependency of compiled.dependencyClosure) {
    if (!packageDirectoryFromAnchor(anchor, dependency.name))
      fail(`最终应用缺少 profile 依赖闭包: ${dependency.name}`, 'PACKAGE_PROFILE_CLOSURE_MISSING');
  }
  return destination;
}

function main(): void {
  const root = rootDirectory();
  const preliminaryDistribution = parseDistribution(path.join(root, 'distribution.yml'), { profilesRoot: path.join(root, 'profiles') });
  const options = parseOptions(process.argv.slice(2), preliminaryDistribution);
  const profileName = options.profileName;
  const compiled = resolveProfile({ root, profileName });
  const dump = writeConfigDump(compiled, { overlay: { port: 38080, generationId: 'package-build' } });
  if (!dump.healthy) fail('真实 DSH 配置转储不健康', 'PACKAGE_CONFIG_DUMP');
  const distribution = parseDistribution(path.join(root, 'distribution.yml'), {
    profilesRoot: path.join(root, 'profiles'),
  });
  const targetName = options.targetName;
  const target = targetName === 'darwin-universal'
    ? { os: 'darwin' as const, architectures: ['arm64', 'x64'] as const }
    : targetName === 'win32-x64'
      ? { os: 'win32' as const, architectures: ['x64'] as const }
      : targetName === 'linux-x64'
        ? { os: 'linux' as const, architectures: ['x64'] as const }
        : {
          os: process.platform as RuntimePlatform['os'],
          architectures: [process.arch as RuntimePlatform['architectures'][number]] as const,
        };
  const nativeRebuild = rebuildProfileNativeAddons(
    root,
    compiled.profileDir,
    compiled.profile.runtime.electronVersion,
    target.architectures,
  );
  const packagedProfileDir = materializePackagedProfile(compiled);
  const appStagingDir = createDesktopAppStaging(root, compiled, distribution);
  const outputDir = path.join(compiled.outputDir, 'desktop-dist');
  if (fs.existsSync(outputDir)) fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  const workDir = prepareDesktopWorkDirectory(root, targetName);
  const unpackedOutputDir = path.join(workDir, 'unpacked');
  const unpackedConfigFile = path.join(compiled.outputDir, 'electron-builder.unpacked.generated.json');
  writeBuilderConfig(unpackedConfigFile, {
    outputDir: unpackedOutputDir,
    packagedProfileDir,
    appStagingDir,
    resolved: compiled.resolved,
    distribution,
    targetName,
    formats: ['dir'],
  });
  // 先得到短路径的已解包应用，再注入完整 profile 闭包；此阶段不生成可分发安装包。
  const unpackedBuild = runBuilder(root, unpackedConfigFile, targetName, ['dir']);
  const application = findApplication(unpackedOutputDir, distribution.id);
  if (targetName === 'darwin-universal') assertUniversalApplication(application);
  const profileClosure = copyPackagedProfileClosure(compiled, appStagingDir, application);
  const runtime = createRuntimeManifest({
    resolved: compiled.resolved,
    packageRoot: application,
    signed: false,
    targets: [
      { os: target.os, architectures: target.architectures, nativeFiles: [] },
    ],
    declaredTargets: distribution.platforms,
    artifact: application,
    electronAbi: nativeRebuild.electronAbi,
    nativeRebuild,
  });
  fs.writeFileSync(path.join(compiled.outputDir, 'runtime-manifest.json'), `${JSON.stringify(runtime, null, 2)}\n`, {
    mode: 0o600,
  });
  generateEvidence(runtime, compiled.outputDir);
  // --prepackaged 只封装已经验证的应用，防止 NSIS/DMG 等格式早于 profile 闭包生成。
  let distributableBuild: BuilderResult | null = null;
  if (!options.formats.includes('dir')) {
    const distributableConfigFile = path.join(compiled.outputDir, 'electron-builder.generated.json');
    writeBuilderConfig(distributableConfigFile, {
      outputDir,
      packagedProfileDir,
      appStagingDir,
      resolved: compiled.resolved,
      distribution,
      targetName,
      formats: options.formats,
    });
    distributableBuild = runBuilder(
      root,
      distributableConfigFile,
      targetName,
      options.formats,
      application,
    );
    assertRequestedFormats(outputDir, options.formats);
  }
  process.stdout.write(
    `${JSON.stringify({ application, profileClosure, runtimeManifest: path.join(compiled.outputDir, 'runtime-manifest.json'), evidence: path.join(compiled.outputDir, 'package-evidence.json'), build: { unpacked: unpackedBuild.command, distributable: distributableBuild?.command || null } }, null, 2)}\n`,
  );
}

try {
  main();
} catch (error: unknown) {
  process.stderr.write(`${errorCode(error) || 'ERROR'}: ${errorMessage(error)}\n`);
  process.exitCode = 1;
}
