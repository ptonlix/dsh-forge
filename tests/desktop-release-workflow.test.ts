import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

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
});
