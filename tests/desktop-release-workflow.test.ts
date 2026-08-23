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
const compilerSource = readFileSync(join(process.cwd(), 'tools', 'profile-toolchain', 'src', 'compiler', 'index.ts'), 'utf8');
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
      readonly scripts?: Readonly<Record<string, string>>;
    };
    expect(packageManifest.packageManager).toBe('pnpm@11.7.0');
    expect(packageManifest.engines?.node).toBe('>=22.13.0');
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
    expect(packagingSource).toContain('NATIVE_REBUILD_TIMEOUT_MS = 15 * 60_000');
    expect(packagingSource).toContain('ELECTRON_BUILDER_TIMEOUT_MS = 45 * 60_000');
    expect(packagingSource).toContain('DEFAULT_ELECTRON_REBUILD_DIST_URL =');
    expect(packagingSource).toContain('npmRebuild: false');
    expect(packagingSource).toContain('executableName: distribution.id');
    expect(packagingSource).toContain('desktopName: distribution.id');
    expect(packagingSource).toContain("'--publish', 'never'");
    expect(packagingSource).toContain("'--os=darwin'");
    expect(packagingSource).toContain("'--cpu=arm64'");
    expect(packagingSource).toContain("'--cpu=x64'");
    expect(packagingSource).toContain('createDesktopAppStaging');
    expect(packagingSource).toContain('PROFILE_ONLY_RUNTIME_PREFIXES');
    expect(packagingSource).toContain('installUniversalNodePtyPrebuilds');
    expect(packagingSource).toContain("asarUnpack: ['**/*.node', '**/helpers/**']");
    expect(packagingSource).not.toContain("from: path.join(root, 'node_modules')");
    expect(packagingSource).not.toContain("ELECTRON_REBUILD_DIST_URL: process.env.ELECTRON_REBUILD_DIST_URL || 'https://npmmirror.com/mirrors/electron/'");
    expect(source).not.toMatch(/package:\n(?:.|\n)*?\n\s+- run: pnpm run build\n/);
    expect(source).toContain('package:desktop 会在同一进程中完成一次 workspace build');
    expect(compilerSource).toContain("offline ? '--offline' : '--prefer-offline'");
    expect(compilerSource).toContain('DSH_FORGE_PROFILE_OFFLINE');
    expect(compilerSource).toContain('PROFILE_PNPM_TIMEOUT_MS = 15 * 60_000');
  });
});
