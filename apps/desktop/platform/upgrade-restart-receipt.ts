import * as fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import * as path from 'node:path';

export const OTA_RESTART_RECEIPT_ARGUMENT = '--dsh-forge-ota-restart-receipt';
export const OTA_RESTART_TOKEN_ARGUMENT = '--dsh-forge-ota-restart-token';
export const OTA_RESTART_STAGING_CLEANUP_ARGUMENT = '--dsh-forge-ota-staging-cleanup';

const RESTART_RECEIPT_SCHEMA = 'dsh-forge/ota-restart-receipt@1';
const TOKEN_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STAGING_CLEANUP_ATTEMPTS = 20;
const STAGING_CLEANUP_INTERVAL_MS = 500;
const CONTROLLED_WINDOWS_PACKAGE_PATTERN = /^package-[0-9a-f-]{36}\.exe$/i;
const CONTROLLED_WINDOWS_RUNNER_PATTERN = /^\.upgrade-[0-9a-f-]{36}\.cmd$/i;

export interface UpgradeRestartReceiptRequest {
  readonly receiptPath: string;
  readonly token: string;
}

export interface ParsedUpgradeRestartReceiptRequest extends UpgradeRestartReceiptRequest {
  readonly stagingCleanupPaths: readonly string[];
}

function isDescendant(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return Boolean(relative) && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function otaStagingDirectory(userData: string): string {
  if (!path.isAbsolute(userData)) throw new Error('OTA 重启回执用户数据目录无效');
  return path.join(path.resolve(userData), 'dsh-forge', 'ota');
}

/** 只接受 helper 注入到重启进程的受控回执参数，拒绝任意写入路径。 */
export function parseUpgradeRestartReceiptRequest(
  argv: readonly string[],
  userData: string,
): ParsedUpgradeRestartReceiptRequest | null {
  const receiptIndices = argv.flatMap((value, index) => value === OTA_RESTART_RECEIPT_ARGUMENT ? [index] : []);
  const tokenIndices = argv.flatMap((value, index) => value === OTA_RESTART_TOKEN_ARGUMENT ? [index] : []);
  const stagingCleanupIndices = argv.flatMap((value, index) => (
    value === OTA_RESTART_STAGING_CLEANUP_ARGUMENT ? [index] : []
  ));
  if (receiptIndices.length === 0 && tokenIndices.length === 0 && stagingCleanupIndices.length === 0) return null;
  if (receiptIndices.length !== 1 || tokenIndices.length !== 1)
    throw new Error('OTA 重启回执参数无效');
  const receiptPath = argv[receiptIndices[0]! + 1];
  const token = argv[tokenIndices[0]! + 1];
  if (typeof receiptPath !== 'string' || typeof token !== 'string' || !TOKEN_PATTERN.test(token))
    throw new Error('OTA 重启回执参数无效');
  const stagingDirectory = otaStagingDirectory(userData);
  if (!path.isAbsolute(receiptPath) || !receiptPath.endsWith('.restart.json') || !isDescendant(stagingDirectory, receiptPath))
    throw new Error('OTA 重启回执路径无效');
  const stagingCleanupPaths = stagingCleanupIndices.map((index) => argv[index + 1]);
  if (stagingCleanupPaths.some((candidate) => (
    typeof candidate !== 'string'
    || !path.isAbsolute(candidate)
    || !isDescendant(stagingDirectory, candidate)
    || (!CONTROLLED_WINDOWS_PACKAGE_PATTERN.test(path.basename(candidate))
      && !CONTROLLED_WINDOWS_RUNNER_PATTERN.test(path.basename(candidate)))
  )))
    throw new Error('OTA 重启暂存清理路径无效');
  return Object.freeze({
    receiptPath: path.resolve(receiptPath),
    token,
    stagingCleanupPaths: Object.freeze(stagingCleanupPaths.map((candidate) => path.resolve(candidate!))),
  });
}

/** generation 只有在 Host、窗口和 renderer 都就绪后才提交回执。 */
export async function writeUpgradeRestartReceipt(request: UpgradeRestartReceiptRequest): Promise<void> {
  const directory = path.dirname(request.receiptPath);
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory())
    throw new Error('OTA 重启回执目录不可用');
  const content = JSON.stringify({ schema: RESTART_RECEIPT_SCHEMA, token: request.token });
  await fsPromises.writeFile(request.receiptPath, `${content}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
}

export function restartReceiptArguments(
  request: UpgradeRestartReceiptRequest,
  stagingCleanupPaths: readonly string[] = [],
): readonly string[] {
  const arguments_ = [OTA_RESTART_RECEIPT_ARGUMENT, request.receiptPath, OTA_RESTART_TOKEN_ARGUMENT, request.token];
  for (const cleanupPath of stagingCleanupPaths)
    arguments_.push(OTA_RESTART_STAGING_CLEANUP_ARGUMENT, cleanupPath);
  return Object.freeze(arguments_);
}

/** helper 读取回执时只接受自身创建的 schema 和随机 token。 */
export function restartReceiptMatches(receiptPath: string, token: string): boolean {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    return typeof value === 'object'
      && value !== null
      && !Array.isArray(value)
      && (value as { readonly schema?: unknown }).schema === RESTART_RECEIPT_SCHEMA
      && (value as { readonly token?: unknown }).token === token;
  } catch {
    return false;
  }
}

/** 新版 generation 就绪后延迟清理 Windows OTA 暂存文件，失败时保留下一轮重试机会。 */
export function scheduleUpgradeStagingCleanup(stagingCleanupPaths: readonly string[]): void {
  if (!stagingCleanupPaths.length) return;
  let attempts = STAGING_CLEANUP_ATTEMPTS;
  const remove = async (): Promise<void> => {
    try {
      await Promise.all(stagingCleanupPaths.map((cleanupPath) => fsPromises.rm(cleanupPath, { force: true })));
    } catch {
      attempts -= 1;
      if (attempts > 0) scheduleCleanupAttempt(remove);
    }
  };
  scheduleCleanupAttempt(remove);
}

function scheduleCleanupAttempt(remove: () => Promise<void>): void {
  const timer = setTimeout(() => void remove(), STAGING_CLEANUP_INTERVAL_MS);
  timer.unref();
}
