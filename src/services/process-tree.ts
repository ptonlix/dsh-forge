import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { Readable } from 'node:stream';
import { errorCode } from '../types.ts';
import type { ProcessOperation as ProcessOperationContract, ProcessResult, SpawnOptions } from '../types.ts';

export const TERM_GRACE_MS = 2_000;
export const TREE_EXIT_TIMEOUT_MS = 10_000;

/**
 * 子进程树管理：Unix 使用独立进程组递归终止，Windows 使用 taskkill /T。
 * cancel 先发 SIGTERM，等待有限宽限期后升级 SIGKILL，并且最终等待 done，
 * 让上层可以把“释放完成”作为可靠生命周期屏障。
 */

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

/** 等待进程组退出；超时抛错，避免静默遗留后台进程。 */
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

/** 一个受管命令的 stdout/stderr、完成结果和可重复取消操作。 */
export class ProcessOperation implements ProcessOperationContract {
  readonly child: ChildProcess;
  readonly command: string;
  readonly args: readonly string[];
  readonly stdout: Readable;
  readonly stderr: Readable;
  readonly done: Promise<Readonly<ProcessResult>>;
  private cancelPromise: Promise<void> | null = null;
  private cancelled = false;
  private readonly pid: number | undefined;

  constructor(child: ChildProcess, command: string, args: readonly string[]) {
    this.child = child;
    this.command = command;
    this.args = args;
    this.stdout = child.stdout instanceof Readable ? child.stdout : Readable.from([]);
    this.stderr = child.stderr instanceof Readable ? child.stderr : Readable.from([]);
    this.pid = child.pid;
    const closed: Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }> = new Promise(
      (resolve, reject) => {
        child.once('error', reject);
        child.once('close', (exitCode, signal) => resolve({ exitCode, signal: signal || null }));
      },
    );
    this.done = closed.then(async (result) => {
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

/** 以非 shell、独立进程组方式启动命令，防止参数被再次解释。 */
export function spawnTree(command: string, args: readonly string[], options: SpawnOptions = {}): ProcessOperation {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    shell: false,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  return new ProcessOperation(child, command, args);
}
