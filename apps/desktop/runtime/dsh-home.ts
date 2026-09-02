import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** DSH 约定的用户数据根目录环境变量。 */
export const DSH_HOME_ENV = 'DSH_HOME';
const DEFAULT_DSH_HOME_DIR = '.dsh';

export type DshHomeSource = 'environment' | 'default';

export interface ResolvedDshHome {
  readonly path: string;
  readonly source: DshHomeSource;
}

/**
 * 按上游 DSH 的规则展开 Home 路径。
 *
 * 空白 `DSH_HOME` 视为未设置；非空值保留原始字符后再解析，避免把含空格的
 * 合法路径静默改写。此规则与 `@deepseek-ai/dsh-home-paths` 保持一致。
 */
function expandHomePath(value: string, homeDirectory: string): string {
  if (value === '~') return homeDirectory;
  if (value.startsWith('~/') || value.startsWith('~\\')) return path.join(homeDirectory, value.slice(2));
  return value;
}

/**
 * 解析本次 Desktop 应使用的 DSH 用户根目录。
 *
 * 环境变量优先于默认的 `~/.dsh`，但该函数不写入 `process.env`。这样动态加载的
 * 上游组件、Desktop Host 与用户在终端启动的 DSH 会落到同一个根目录。
 */
export function resolveDesktopDshHome(
  env: Readonly<Record<string, string | undefined>> = process.env,
  homeDirectory = os.homedir(),
): ResolvedDshHome {
  const configured = env[DSH_HOME_ENV];
  const source: DshHomeSource = configured !== undefined && configured.trim().length > 0 ? 'environment' : 'default';
  const selected = source === 'environment' ? configured! : path.join(homeDirectory, DEFAULT_DSH_HOME_DIR);
  return Object.freeze({ path: path.resolve(expandHomePath(selected, homeDirectory)), source });
}

const CREDENTIALS_LOCK = '.credentials.yaml.lock';

export interface DshHomeWriterLockState {
  readonly removed: readonly string[];
  readonly busyPid: number | null;
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * 处理 DSH Home 里 credentials 的跨进程写锁。
 *
 * 上游锁等待默认 30s，generation preparing 只有 15s，崩溃留下的死进程锁会表现为
 * “preparing 超时”。持有锁的进程仍在运行时必须立即失败，不能删除活锁。
 */
export function reconcileDshHomeWriterLocks(home: string): DshHomeWriterLockState {
  const lockFile = path.join(home, CREDENTIALS_LOCK);
  try {
    const stat = fs.lstatSync(lockFile);
    if (!stat.isFile() || stat.isSymbolicLink()) return Object.freeze({ removed: [], busyPid: null });
  } catch {
    return Object.freeze({ removed: [], busyPid: null });
  }
  const pid = Number.parseInt(fs.readFileSync(lockFile, 'utf8').trim(), 10);
  if (!Number.isInteger(pid) || pid <= 0) return Object.freeze({ removed: [], busyPid: null });
  if (processExists(pid)) return Object.freeze({ removed: [], busyPid: pid });
  fs.unlinkSync(lockFile);
  const removed = [lockFile];
  for (const name of fs.readdirSync(home)) {
    if (!name.startsWith('.credentials.yaml.') || !name.endsWith('.tmp')) continue;
    const file = path.join(home, name);
    try {
      const stat = fs.lstatSync(file);
      if (stat.isFile() && !stat.isSymbolicLink()) {
        fs.unlinkSync(file);
        removed.push(file);
      }
    } catch {
      // 并发启动时临时文件可能已经消失。
    }
  }
  return Object.freeze({ removed, busyPid: null });
}

function flattenErrorText(error: unknown, depth = 0): string {
  if (!error || depth > 6) return '';
  if (typeof error === 'string') return error;
  const record = typeof error === 'object' ? (error as Record<string, unknown>) : {};
  const parts = [typeof record.message === 'string' ? record.message : String(error)];
  if (record.cause) parts.push(flattenErrorText(record.cause, depth + 1));
  if (Array.isArray(record.errors)) {
    for (const child of record.errors) parts.push(flattenErrorText(child, depth + 1));
  }
  return parts.join('\n');
}

/** 旧版 session_projcache 缺少 0.1.2 新增 identity 字段时，整个 Host 无法加载。 */
export function isIncompatibleSessionProjectionCache(error: unknown): boolean {
  const text = flattenErrorText(error);
  return text.includes("domain 'session_projcache'") && text.includes('does not match its schema');
}

/**
 * 把不兼容的投影缓存移出运行路径。会话正文在 `sessions/`，缓存可从日志重建。
 */
export function quarantineIncompatibleSessionProjectionCache(home: string): readonly string[] {
  const stamp = new Date().toISOString().replaceAll(':', '-');
  const storages = path.join(home, 'storages');
  const moved: string[] = [];
  for (const name of ['session_projcache', 'session_projcache.json'] as const) {
    const source = path.join(storages, name);
    try {
      const stat = fs.lstatSync(source);
      if (stat.isSymbolicLink()) continue;
      if (!stat.isFile() && !stat.isDirectory()) continue;
    } catch {
      continue;
    }
    const destination = path.join(storages, `${name}.incompatible-${stamp}`);
    fs.renameSync(source, destination);
    moved.push(destination);
  }
  return Object.freeze(moved);
}
