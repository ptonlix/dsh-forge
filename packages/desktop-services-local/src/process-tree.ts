import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { Readable } from 'node:stream';
import { errorCode } from '@dsh-forge/profile-toolchain/types';
import type { ProcessOperation as ProcessOperationContract, SpawnOptions } from './types.ts';

export const TERM_GRACE_MS = 2_000;
export const TREE_EXIT_TIMEOUT_MS = 10_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function processGroupAlive(pid: number | undefined): boolean {
  if (process.platform === 'win32' || !Number.isInteger(pid) || pid! < 1) return false;
  try {
    process.kill(-pid!, 0);
    return true;
  } catch (error) {
    return errorCode(error) !== 'ESRCH';
  }
}

/** 等待完整进程树退出；超时不能静默释放 package operation lease。 */
export async function waitForTreeExit(pid: number | undefined, timeoutMs = TREE_EXIT_TIMEOUT_MS): Promise<void> {
  if (process.platform === 'win32') return;
  const deadline = Date.now() + timeoutMs;
  while (processGroupAlive(pid) && Date.now() < deadline) await sleep(40);
  if (processGroupAlive(pid)) throw new Error(`受管子进程树未在 ${timeoutMs}ms 内退出: ${pid}`);
}

function terminateTree(pid: number | undefined, signal: NodeJS.Signals): void {
  if (!Number.isInteger(pid) || pid! < 1) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    return;
  }
  try {
    process.kill(-pid!, signal);
  } catch (error) {
    if (errorCode(error) !== 'ESRCH') throw error;
  }
}

/** 非 shell、独立进程组运行并提供幂等取消。 */
export class ManagedProcessOperation implements ProcessOperationContract {
  readonly stdout: Readable;
  readonly stderr: Readable;
  readonly done: Promise<Readonly<{ exitCode: number | null; signal: NodeJS.Signals | null; cancelled: boolean }>>;
  private readonly pid: number | undefined;
  private cancelPromise: Promise<void> | null = null;
  private cancelled = false;

  constructor(private readonly child: ChildProcess) {
    this.stdout = child.stdout instanceof Readable ? child.stdout : Readable.from([]);
    this.stderr = child.stderr instanceof Readable ? child.stderr : Readable.from([]);
    this.pid = child.pid;
    this.done = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (exitCode, signal) => resolve({ exitCode, signal: signal || null }));
    }).then(async (result) => {
      await waitForTreeExit(this.pid);
      return Object.freeze({ ...result, cancelled: this.cancelled });
    });
  }

  cancel(): Promise<void> {
    if (this.cancelPromise) return this.cancelPromise;
    this.cancelled = true;
    this.cancelPromise = (async () => {
      if (this.child.exitCode === null && this.child.signalCode === null) terminateTree(this.pid, 'SIGTERM');
      await Promise.race([this.done.catch(() => undefined), sleep(TERM_GRACE_MS)]);
      if (processGroupAlive(this.pid)) terminateTree(this.pid, 'SIGKILL');
      await this.done;
    })();
    return this.cancelPromise;
  }
}

/** 以受限环境启动 pnpm；调用方不能传入 shell 或任意 cwd。 */
export function spawnTree(command: string, args: readonly string[], options: SpawnOptions): ManagedProcessOperation {
  return new ManagedProcessOperation(
    spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    }),
  );
}
