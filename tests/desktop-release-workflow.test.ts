import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { resolveElectronBinary, resolvePackageBin, spawnFailureMessage } from '@dsh-forge/profile-toolchain/core/process';

interface WorkflowJob {
  readonly if?: string;
  readonly permissions?: Readonly<Record<string, string>>;
  readonly strategy?: {
    readonly matrix?: {
      readonly include?: readonly Readonly<Record<string, string>>[];
    };
  };
}

interface DesktopReleaseWorkflow {
  readonly on: Readonly<Record<string, unknown>>;
  readonly env: Readonly<Record<string, string>>;
  readonly permissions: Readonly<Record<string, string>>;
  readonly jobs: Readonly<Record<string, WorkflowJob>>;
}

const workflowFile = join(process.cwd(), '.github', 'workflows', 'release-desktop.yml');
const source = readFileSync(workflowFile, 'utf8');
const packagingSource = readFileSync(join(process.cwd(), 'scripts', 'package-desktop.ts'), 'utf8');
const smokeSource = readFileSync(join(process.cwd(), 'scripts', 'smoke-package.ts'), 'utf8');
const compilerSource = readFileSync(join(process.cwd(), 'tools', 'profile-toolchain', 'src', 'compiler', 'index.ts'), 'utf8');
const releaseSource = readFileSync(join(process.cwd(), 'tools', 'profile-toolchain', 'src', 'release', 'index.ts'), 'utf8');
const electronMainSource = readFileSync(join(process.cwd(), 'apps', 'desktop', 'electron-main.ts'), 'utf8');
const desktopMainSource = readFileSync(join(process.cwd(), 'apps', 'desktop', 'main.ts'), 'utf8');
const workflow = parse(source) as DesktopReleaseWorkflow;

describe('Desktop Release workflow', () => {
  it('PR 和手动运行只进入 validate，tag 才进入打包矩阵', () => {
    expect(Object.hasOwn(workflow.on, 'pull_request')).toBe(true);
    expect(Object.hasOwn(workflow.on, 'workflow_dispatch')).toBe(true);
    expect(workflow.on.push).toEqual({ tags: ['v*'] });
    expect(workflow.jobs.validate?.if).toBeUndefined();
    expect(workflow.jobs.package?.if).toContain("startsWith(github.ref, 'refs/tags/v')");
    expect(workflow.jobs.summary?.if).toContain("startsWith(github.ref, 'refs/tags/v')");
  });

  it('保留三个原生目标并默认关闭生产 Release', () => {
    const targets = workflow.jobs.package?.strategy?.matrix?.include?.map((item) => item.target);
    expect(targets).toEqual(['darwin-universal', 'win32-x64', 'linux-x64']);
    expect(workflow.jobs.release?.if).toContain("vars.DSH_FORGE_PRODUCTION_RELEASE == 'true'");
    expect(workflow.permissions).toEqual({ contents: 'read' });
    expect(workflow.jobs.release?.permissions).toEqual({ contents: 'write' });
  });

  it('跨平台命令不使用 PowerShell 的 PROFILE 自动变量', () => {
    expect(source).not.toContain('"$PROFILE"');
    expect(source).toContain('"${{ env.PROFILE }}"');
  });
  it('CI Node 版本满足 pnpm 11.7 的运行要求', () => {
    expect(workflow.env.NODE_VERSION).toBe('22.14.0');
    const packageManifest = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      readonly engines?: { readonly node?: string };
      readonly packageManager?: string;
      readonly homepage?: string;
      readonly scripts?: Readonly<Record<string, string>>;
    };
    expect(packageManifest.packageManager).toBe('pnpm@11.7.0');
    expect(packageManifest.engines?.node).toBe('>=22.13.0');
    expect(packageManifest.homepage).toBe('https://github.com/ptonlix/dsh-forge');
    expect(packageManifest.scripts?.typecheck).toBe(
      'pnpm run build:desktop-services && tsc -p tsconfig.json --noEmit',
    );
  });

  it('跨平台子进程不依赖 pnpm 的 .bin shim', () => {
    const root = process.cwd();
    expect(resolvePackageBin(root, '@deepseek-ai/dsh', 'dsh')).toMatch(/lib[\\/]bin\.js$/);
    expect(resolvePackageBin(root, 'electron-builder', 'electron-builder')).toMatch(/(?:cli\.js)$/);
    expect(resolveElectronBinary(root)).not.toMatch(/[\\/]\.bin[\\/]electron(?:\.cmd)?$/);
  });

  it('子进程诊断保留启动错误和有限输出', () => {
    const message = spawnFailureMessage(
      {
        status: null,
        signal: null,
        error: Object.assign(new Error('无法启动子进程'), { code: 'ENOENT' }),
        stdout: 'stdout',
        stderr: 'stderr',
      },
      'unknown error',
    );
    expect(message).toContain('无法启动子进程');
    expect(message).toContain('code=ENOENT');
    expect(message).toContain('stderr=stderr');
  });

  it('长诊断同时保留开头和末尾', () => {
    const message = spawnFailureMessage(
      { status: 1, signal: null, stdout: `${'head '.repeat(800)}TAIL_MARKER`, stderr: '' },
      'unknown error',
    );
    expect(message).toContain('head head');
    expect(message).toContain('TAIL_MARKER');
    expect(message).toContain('<truncated>');
  });

  it('声明 profile 可补下载和 Electron headers 校验源', () => {
    expect(workflow.env.DSH_FORGE_PROFILE_OFFLINE).toBe('false');
    expect(workflow.env.ELECTRON_REBUILD_DIST_URL).toBe('https://www.electronjs.org/headers');
    expect(workflow.jobs.package?.if).toContain("startsWith(github.ref, 'refs/tags/v')");
    expect(source).toContain('timeout-minutes: 90');
    expect(source).toContain('desktop-${{ runner.os }}-${{ runner.arch }}-');
    expect(source).not.toContain('electron-builder/Cache');
    expect(source).toContain("if: ${{ matrix.target == 'win32-x64' }}");
    expect(source).toContain("Join-Path $env:GITHUB_WORKSPACE '.ci-tools'");
    expect(source).toContain('releases/download/7zip@1.0.0/7zip-win-x64.tar.gz');
    expect(source).toContain('be071f15bd6da2f78fe81c6ddef2009b0c4d8a51f36b780cb806c7e6df95e1b3');
    expect(source).toContain("Join-Path $toolRoot 'bin\\7za.exe'");
    expect(source).toContain('Get-FileHash -LiteralPath $archive -Algorithm SHA256');
    expect(source).toContain('Get-Command tar.exe -ErrorAction SilentlyContinue');
    expect(source).toContain('--strip-components=1');
    expect(source).toContain("spawnSync(executable, ['i']");
    expect(source).toContain('ELECTRON_BUILDER_7ZIP_PATH=$sevenZip');
    expect(source).toContain('安装后再次验证 Windows Builder 7za');
    expect(source).toContain("stage: 'after-pnpm-install-node-probe'");
    expect(packagingSource).toContain('...process.env,\n    CSC_IDENTITY_AUTO_DISCOVERY: \'false\'');
    expect(packagingSource).toContain("DEBUG: process.env.DEBUG || 'electron-builder'");
    expect(packagingSource).toContain('preflightBuilder7za(prepackaged ? path.dirname(prepackaged) : root, builderEnv);');
    expect(packagingSource).toContain('[electron-builder-7za-preflight]');
    expect(packagingSource).toContain('NATIVE_REBUILD_TIMEOUT_MS = 15 * 60_000');
    expect(packagingSource).toContain('ELECTRON_BUILDER_TIMEOUT_MS = 45 * 60_000');
    expect(packagingSource).toContain('DEFAULT_ELECTRON_REBUILD_DIST_URL =');
    expect(packagingSource).toContain('npmRebuild: false');
    expect(packagingSource).toContain('executableName: distribution.branding.productName');
    expect(packagingSource).toContain('buildResources: path.join(rootDirectory(), \'build\')');
    expect(packagingSource).toContain('icon: \'app-icon-mac.png\'');
    expect(packagingSource).toContain('icon: \'app-icon.png\'');
    expect(packagingSource).toContain('to: \'dsh-forge/app-icon.png\'');
    expect(packagingSource).toContain('to: \'dsh-forge/app-icon-mac.png\'');
    expect(packagingSource).toContain('to: \'dsh-forge/APP-ICON-LICENSE.txt\'');
    expect(electronMainSource).toContain('packagedResourcePath(\'dsh-forge\', filename)');
    expect(electronMainSource).toContain('icon: applicationIconPath(root)');
    expect(packagingSource).toContain('desktopName: distribution.branding.productName');
    expect(packagingSource).toContain('artifactName: `${distribution.id}-${distribution.version}-\\${os}-\\${arch}.\\${ext}`');
    expect(packagingSource).toContain('syncDesktopName: true');
    expect(packagingSource).toContain('maintainer: distribution.branding.publisher');
    expect(packagingSource).toContain('vendor: distribution.branding.publisher');
    expect(packagingSource).toContain('homepage: rootPackage.homepage');
    expect(packagingSource).not.toContain('artifactName: `${distribution.id}-${resolved.profile.name}-');
    expect(packagingSource).toContain('MACOS_UNIVERSAL_X64_ARCH_FILES');
    expect(packagingSource).toContain('x64ArchFiles: MACOS_UNIVERSAL_X64_ARCH_FILES');
    expect(packagingSource).toContain('**/*-darwin-*/**');
    expect(packagingSource).toContain('**/prebuilds/darwin-*/**');
    expect(packagingSource).toContain("targetName === 'darwin-universal' || (!targetName && process.platform === 'darwin')");
    expect(packagingSource).toContain('copyWindowsNodePtyBuildOutputs');
    expect(packagingSource).toContain("fs.mkdtempSync(path.join(os.tmpdir(), 'dshf-native-'))");
    expect(packagingSource).toContain("'--publish', 'never'");
    expect(packagingSource).toContain("'--frozen-lockfile',\n    '--os=darwin'");
    expect(packagingSource).toContain("'--os=darwin'");
    expect(packagingSource).toContain("'--cpu=arm64'");
    expect(packagingSource).toContain("'--cpu=x64'");
    expect(packagingSource).toContain('createDesktopAppStaging');
    expect(packagingSource).toContain("directory !== 'packages' || path.basename(candidate) !== 'node_modules'");
    expect(packagingSource).toContain('PROFILE_ONLY_RUNTIME_PREFIXES');
    expect(packagingSource).toContain('installUniversalNodePtyPrebuilds');
    expect(packagingSource).toContain("asarUnpack: ['**/*.node', '**/helpers/**']");
    expect(packagingSource).toContain("'!node_modules/**/node-pty/bin/**'");
    expect(packagingSource).toContain("'!node_modules/**/node-pty/build/**'");
    expect(packagingSource).toContain("const fallbackSource = path.join(appStagingDir, 'launcher-fallback')");
    expect(packagingSource).toContain("const fallbackDestination = path.join(resourceRoot, 'dsh-forge', 'launcher-fallback')");
    expect(packagingSource).toContain("const fallbackRoot = path.join(staging, 'launcher-fallback')");
    expect(packagingSource).toContain("'@dsh-forge/desktop-services-local'");
    expect(packagingSource).toContain('const profileRuntimeExclusions = profileRuntimePackages.map');
    expect(packagingSource).toContain('...profileRuntimeExclusions');
    expect(packagingSource).toContain('.filter((name) => !(APP_RUNTIME_ROOTS as readonly string[]).includes(name))');
    expect(electronMainSource).toContain("packagedResourcePath('dsh-forge', 'launcher-fallback')");
    expect(desktopMainSource).toContain('launcherFallbackRoot?: string');
    expect(desktopMainSource).toContain('assertPackageIdentity(destination, packageName);');
    expect(desktopMainSource).toContain('fs.cpSync(source, destination, { recursive: true, dereference: true })');
    expect(packagingSource).not.toContain("from: path.join(root, 'node_modules')");
    expect(packagingSource).not.toContain("ELECTRON_REBUILD_DIST_URL: process.env.ELECTRON_REBUILD_DIST_URL || 'https://npmmirror.com/mirrors/electron/'");
    expect(source).not.toMatch(/package:\n(?:.|\n)*?\n\s+- run: pnpm run build\n/);
    expect(source).toContain('package:desktop 会在同一进程中完成一次 workspace build');
    expect(compilerSource).toContain("offline ? '--offline' : '--prefer-offline'");
    expect(compilerSource).toContain('DSH_FORGE_PROFILE_OFFLINE');
    expect(compilerSource).toContain('PROFILE_PNPM_TIMEOUT_MS = 15 * 60_000');
  });

  it('先在短路径注入 profile 闭包，再封装分发格式', () => {
    const mainSource = packagingSource.slice(packagingSource.indexOf('function main(): void'));
    const gitignore = readFileSync(join(process.cwd(), '.gitignore'), 'utf8');
    const unpacked = "runBuilder(root, unpackedConfigFile, targetName, ['dir'])";
    const closure = 'copyPackagedProfileClosure(compiled, appStagingDir, application)';
    const distributable = 'distributableBuild = runBuilder(';
    expect(gitignore).toContain('.desktop-work/');
    expect(packagingSource).toContain('prepareDesktopWorkDirectory');
    expect(packagingSource).toContain("args.push('--prepackaged', path.resolve(prepackaged))");
    expect(mainSource.indexOf(unpacked)).toBeGreaterThanOrEqual(0);
    expect(mainSource.indexOf(closure)).toBeGreaterThan(mainSource.indexOf(unpacked));
    expect(mainSource.indexOf(distributable)).toBeGreaterThan(mainSource.indexOf(closure));
  });

  it('macOS 应用按统一的 electron-builder executableName 定位', () => {
    expect(packagingSource).toContain('? `${executableName}.app`');
    expect(packagingSource).toContain('findApplication(unpackedOutputDir, distribution.branding.productName)');
    expect(releaseSource).toContain("const machArchitecture = architecture === 'x64' ? 'x86_64' : architecture");
  });

  it('Linux 动态导入与 smoke 按应用名称启动主程序', () => {
    expect(releaseSource).toContain('function runtimeExecutableName(manifest: RuntimeManifest)');
    expect(releaseSource).toContain("? path.join(paths.application, 'Contents', 'MacOS', executableName)");
    expect(releaseSource).toContain('? path.join(paths.application, executableName)');
    expect(releaseSource).not.toContain("name === 'chrome-sandbox'");
    expect(smokeSource).toContain('function applicationExecutable(application: string, executableName: string)');
    expect(smokeSource).toContain("applicationExecutable(runtime.packageRoot || '', distribution.branding.productName)");
    expect(source).toContain("if: ${{ matrix.target == 'linux-x64' }}");
    expect(source).toContain('command -v xvfb-run');
    expect(source).toContain('xvfb-run --auto-servernum --server-args="-screen 0 1280x860x24 -nolisten tcp"');
    expect(source).toContain("if: ${{ matrix.target != 'linux-x64' }}");
  });
});
