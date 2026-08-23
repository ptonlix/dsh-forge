import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
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
  readonly root: string;
  readonly outputDir: string;
  /** 为 electron-builder 准备的解引用 profile 闭包。 */
  readonly packagedProfileDir: string;
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

interface PackageOptions {
  readonly profileName?: string;
  readonly targetName?: DesktopTargetName;
  readonly formats: readonly PackageFormat[];
}

function rootDirectory(): string {
  return path.resolve(__dirname, '..');
}

/** 生成 electron-builder 配置，明确 runtime、profile、catalog 和审计证据的位置。 */
function builderConfig({
  root,
  outputDir,
  packagedProfileDir,
  resolved,
  distribution,
  targetName,
  formats,
}: BuilderConfigInput): Record<string, unknown> {
  const artifactDir = path.dirname(packagedProfileDir);
  const config: Record<string, unknown> = {
    appId: distribution.applicationId,
    productName: distribution.branding.productName,
    directories: { output: outputDir },
    asar: true,
    asarUnpack: ['node_modules/**', '**/*.node', '**/helpers/**'],
    files: [
      'dist/**',
      'packages/**',
      'tools/**',
      'catalog/**',
      'package.json',
      'distribution.yml',
      'node_modules/**',
      '!node_modules/.cache/**',
      '!node_modules/**/.pnpm-store/**',
    ],
    extraResources: [
      // workspace 依赖在 pnpm 安装目录中是相对 symlink；保留 packages 拓扑后，
      // 打包 runtime 内的 @dsh-forge/* 链接仍能解析到随包携带的真实目录。
      { from: path.join(root, 'packages'), to: 'dsh-forge/runtime/packages' },
      { from: path.join(root, 'tools'), to: 'dsh-forge/runtime/tools' },
      { from: path.join(root, 'node_modules'), to: 'dsh-forge/runtime/node_modules' },
      // profile-local node_modules 可能保留 pnpm 相对链接。electron-builder
      // 不能把链接目标当作隐式资源，因此只接受本脚本物化的解引用闭包。
      // extraResources 的默认筛选会按主应用依赖裁剪 node_modules；profile 是
      // 独立闭包，必须显式保留其所有文件，不能让 builder 再作生产依赖推断。
      { from: packagedProfileDir, to: 'dsh-forge/profile', filter: ['**/*'] },
      { from: path.join(artifactDir, 'resolved-manifest.json'), to: 'dsh-forge/resolved-manifest.json' },
      { from: path.join(artifactDir, 'sbom.input.json'), to: 'dsh-forge/sbom.input.json' },
      { from: path.join(artifactDir, 'THIRD-PARTY-NOTICES.txt'), to: 'dsh-forge/THIRD-PARTY-NOTICES.txt' },
    ],
    mac: { target: targetName === 'darwin-universal' ? formats : ['dir'] },
    win: { target: targetName === 'win32-x64' ? formats : ['dir'] },
    linux: { target: targetName === 'linux-x64' ? formats : ['dir'] },
    artifactName: `${distribution.id}-${resolved.profile.name}-${distribution.version}-\${os}-\${arch}.\${ext}`,
  };
  if (process.env.DSH_FORGE_ELECTRON_ZIP) {
    const electronZip = path.resolve(process.env.DSH_FORGE_ELECTRON_ZIP);
    if (!fs.existsSync(electronZip)) fail(`Electron 压缩包不存在: ${electronZip}`, 'ELECTRON_DIST_MISSING');
    config.electronDist = electronZip;
  }
  return config;
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
 * electron-builder 的 extraResources 不保证 pnpm 链接目标跟随到同一资源根。
 * 在进入 builder 前把 profile 的实际闭包解引用为独立目录，并逐项核对编译器
 * 已记录的依赖都能从 profile package.json 的模块锚点解析。
 */
function materializePackagedProfile(compiled: CompiledProfile): string {
  const source = compiled.profileDir;
  const sourceModules = path.join(source, 'node_modules');
  if (!fs.existsSync(sourceModules) || !fs.statSync(sourceModules).isDirectory())
    fail('物化 profile 缺少 node_modules 闭包', 'PACKAGE_PROFILE_CLOSURE_MISSING');
  const destination = path.join(compiled.outputDir, 'packaged-profile');
  if (fs.existsSync(destination)) fs.rmSync(destination, { recursive: true, force: true });
  fs.cpSync(source, destination, {
    recursive: true,
    dereference: true,
    // pnpm 的 .bin 仅供 package manager/CLI 调用，不能参与 Node 的模块解析；
    // 保留它会把指向 package bin 的 shim 链接带入 extraResources。
    filter: (candidate) => path.basename(candidate) !== '.bin',
  });
  const anchor = path.join(destination, 'package.json');
  if (!fs.existsSync(anchor)) fail('打包 profile 缺少 package.json 模块锚点', 'PACKAGE_PROFILE_ANCHOR_MISSING');
  assertNoSymbolicLinks(destination);
  for (const dependency of compiled.dependencyClosure) {
    if (!packageDirectoryFromAnchor(anchor, dependency.name))
      fail(`打包 profile 缺少依赖闭包: ${dependency.name}`, 'PACKAGE_PROFILE_CLOSURE_MISSING');
  }
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
  const staging = new Map<string, string>();
  for (const architecture of architectures) {
    const moduleDir = universal ? path.join(path.dirname(profileDir), `native-${architecture}`) : profileDir;
    if (universal) {
      if (fs.existsSync(moduleDir)) fs.rmSync(moduleDir, { recursive: true, force: true });
      fs.cpSync(profileDir, moduleDir, { recursive: true, dereference: true });
      staging.set(architecture, moduleDir);
    }
    const args = [
      binary,
      '--version', electronVersion,
      '--module-dir', moduleDir,
      '--only', 'node-pty',
      '--force', '--arch', architecture,
      '--types', 'prod,optional',
    ];
    const result = spawnSync(process.execPath, args, {
      cwd: moduleDir,
      encoding: 'utf8',
      timeout: 60_000,
      env: {
        ...process.env,
        ELECTRON_REBUILD_DIST_URL: process.env.ELECTRON_REBUILD_DIST_URL || 'https://npmmirror.com/mirrors/electron/',
      },
    });
    const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
    if (result.status !== 0 || result.signal || !output.includes('node-pty'))
      fail(`Electron native addon 重建失败 (${architecture}): ${output || result.signal || 'unknown error'}`, 'ELECTRON_REBUILD_FAILED', {
        args: args.slice(1), status: result.status, signal: result.signal,
      });
    reports.push(`[${architecture}] ${output}`);
    commands.push(`${process.execPath} ${args.join(' ')}`);
  }
  if (universal && process.platform === 'darwin') {
    const relativeFiles = (directory: string): string[] => {
      const result: string[] = [];
      const walk = (current: string, relative = ''): void => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
          const candidate = path.join(current, entry.name);
          const next = path.join(relative, entry.name);
          if (entry.isDirectory()) walk(candidate, next);
          else if (entry.isFile() && entry.name.endsWith('.node')) result.push(next);
        }
      };
      walk(directory);
      return result;
    };
    const files = new Set<string>();
    for (const directory of staging.values()) for (const file of relativeFiles(directory)) files.add(file);
    for (const relative of files) {
      const inputs = architectures
        .map((architecture) => path.join(staging.get(architecture)!, relative))
        .filter((file) => fs.existsSync(file));
      const output = path.join(profileDir, relative);
      if (inputs.length === 2) {
        fs.mkdirSync(path.dirname(output), { recursive: true });
        const result = spawnSync('lipo', ['-create', ...inputs, '-output', output], { encoding: 'utf8' });
        if (result.status !== 0) fail(`native addon universal 合并失败: ${relative}`, 'ELECTRON_REBUILD_FAILED');
      } else if (inputs.length === 1) {
        fs.mkdirSync(path.dirname(output), { recursive: true });
        fs.copyFileSync(inputs[0]!, output);
      }
    }
  }
  return { command: commands.join(' && '), output: reports.join('\n'), electronAbi: abi, architectures: architectures.slice() };
}

/** 调用 electron-builder；固定 60 秒超时并关闭自动代码签名发现。 */
function runBuilder(
  root: string,
  configFile: string,
  targetName: DesktopTargetName | undefined,
  formats: readonly PackageFormat[],
): BuilderResult {
  let binary: string;
  try {
    binary = resolvePackageBin(root, 'electron-builder', 'electron-builder');
  } catch (error) {
    fail(`未安装 electron-builder: ${errorMessage(error)}`, 'ELECTRON_BUILDER_MISSING');
  }
  const args = ['--config', configFile];
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
    timeout: 15 * 60_000,
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

/** 在构建输出中定位平台应用目录，找不到时阻止生成 runtime manifest。 */
function findApplication(outputDir: string, productName: string): string {
  const expected = process.platform === 'darwin' ? `${productName}.app` : process.platform === 'win32' ? `${productName}.exe` : null;
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

/** 将 builder 无法保留的 profile node_modules 闭包复制到最终应用资源目录。 */
function copyPackagedProfileClosure(packagedProfileDir: string, application: string): string {
  const source = path.join(packagedProfileDir, 'node_modules');
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
  // electron-builder 对 extraResources 的 node_modules 使用主应用依赖裁剪，
  // 无法表达独立 profile 闭包；该目录是本轮 builder 刚生成的确定目标。
  if (fs.existsSync(destination)) fs.rmSync(destination, { recursive: true, force: true });
  fs.cpSync(source, destination, { recursive: true, dereference: true });
  assertNoSymbolicLinks(destination);
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
  const outputDir = path.join(compiled.outputDir, 'desktop-dist');
  fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  const configFile = path.join(compiled.outputDir, 'electron-builder.generated.json');
  fs.writeFileSync(
    configFile,
    `${JSON.stringify(builderConfig({ root, outputDir, packagedProfileDir, resolved: compiled.resolved, distribution, targetName, formats: options.formats }), null, 2)}\n`,
    { mode: 0o600 },
  );
  const build = runBuilder(root, configFile, targetName, options.formats);
  assertRequestedFormats(outputDir, options.formats);
  const application = findApplication(outputDir, distribution.branding.productName);
  if (targetName === 'darwin-universal') assertUniversalApplication(application);
  const profileClosure = copyPackagedProfileClosure(packagedProfileDir, application);
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
  process.stdout.write(
    `${JSON.stringify({ application, profileClosure, runtimeManifest: path.join(compiled.outputDir, 'runtime-manifest.json'), evidence: path.join(compiled.outputDir, 'package-evidence.json'), build: build.command }, null, 2)}\n`,
  );
}

try {
  main();
} catch (error: unknown) {
  process.stderr.write(`${errorCode(error) || 'ERROR'}: ${errorMessage(error)}\n`);
  process.exitCode = 1;
}
