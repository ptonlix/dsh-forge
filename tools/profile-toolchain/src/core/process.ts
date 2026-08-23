import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import type { SpawnSyncReturns } from 'node:child_process';

const MAX_DIAGNOSTIC_CHARS = 4_000;

interface PackageManifest {
  readonly bin?: string | Readonly<Record<string, string>>;
}

interface SpawnError extends Error {
  readonly code?: string;
}

interface SpawnFailureResult {
  readonly status: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly error?: SpawnError;
  readonly stdout?: string;
  readonly stderr?: string;
}

function truncate(value: string): string {
  const normalized = value.trim();
  return normalized.length <= MAX_DIAGNOSTIC_CHARS
    ? normalized
    : (() => {
      const marker = '...<truncated>...';
      const available = MAX_DIAGNOSTIC_CHARS - marker.length;
      const headLength = Math.ceil(available / 2);
      return `${normalized.slice(0, headLength)}${marker}${normalized.slice(-available + headLength)}`;
    })();
}

function requireFromRoot(root: string): NodeRequire {
  return createRequire(path.join(root, 'package.json'));
}

/** 解析包 manifest 中声明的 bin，避免依赖 pnpm 在各平台生成的 shell/cmd shim。 */
export function resolvePackageBin(root: string, packageName: string, binName: string): string {
  const requireFrom = requireFromRoot(root);
  const manifestFile = requireFrom.resolve(`${packageName}/package.json`);
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')) as PackageManifest;
  const declared = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[binName];
  if (!declared) throw new Error(`${packageName} 未声明 bin.${binName}`);
  const executable = path.resolve(path.dirname(manifestFile), declared);
  if (!fs.existsSync(executable)) throw new Error(`${packageName} bin 不存在: ${executable}`);
  return executable;
}

/** 解析 Electron package 返回的真实运行时二进制，而不是 electron cli shim。 */
export function resolveElectronBinary(root: string): string {
  const electron = requireFromRoot(root)('electron');
  if (typeof electron !== 'string' || !electron || !fs.existsSync(electron))
    throw new Error(`Electron runtime 不存在: ${String(electron)}`);
  return electron;
}

/** 将 spawnSync 的启动、超时、信号和有限输出合并成可操作诊断。 */
export function spawnFailureMessage(result: SpawnFailureResult, fallback: string): string {
  const parts = [
    result.error?.message,
    result.error?.code ? `code=${result.error.code}` : undefined,
    result.status === null ? 'status=null' : `status=${result.status}`,
    result.signal ? `signal=${result.signal}` : undefined,
    result.stderr ? `stderr=${truncate(result.stderr)}` : undefined,
    result.stdout ? `stdout=${truncate(result.stdout)}` : undefined,
  ].filter((part): part is string => Boolean(part));
  return parts.length ? parts.join('; ') : fallback;
}

/** 将 Node 的 SpawnSyncReturns 收窄为诊断辅助可消费的形状。 */
export function spawnFailureDetails(result: SpawnSyncReturns<string>): Record<string, unknown> {
  const error = result.error as SpawnError | undefined;
  return {
    status: result.status,
    signal: result.signal,
    error: error
      ? { name: error.name, message: error.message, code: error.code ?? null }
      : null,
    stdout: result.stdout ? truncate(result.stdout) : '',
    stderr: result.stderr ? truncate(result.stderr) : '',
  };
}
