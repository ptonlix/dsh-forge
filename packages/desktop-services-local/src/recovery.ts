import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ConfirmedPluginInstall } from '@dsh-forge/desktop-services';
import { errorMessage } from '@dsh-forge/profile-toolchain/types';
import type { ProtectedProfileSnapshot, RecoveryFact, ResolvedInstallFact } from './types.ts';

interface ProtectedProfileFile {
  readonly file: keyof ProtectedProfileSnapshot;
  readonly target: string;
}

export interface InstallWal {
  readonly schema: 'dsh-forge/desktop-install-wal@1';
  readonly request: ConfirmedPluginInstall;
  readonly snapshot: ProtectedProfileSnapshot;
  readonly startedAt: string;
}

export interface InstallReceipt {
  readonly schema: 'dsh-forge/desktop-install-receipt@1';
  readonly request: ConfirmedPluginInstall;
  readonly resolved: ResolvedInstallFact;
  readonly committedAt: string;
}

function protectedProfileFiles(profileDir: string): readonly ProtectedProfileFile[] {
  return ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'].map((file) => ({
    file: file as keyof ProtectedProfileSnapshot,
    target: path.join(profileDir, file),
  }));
}

/** WAL 只保护声明和 lockfile；不会声称回滚 node_modules。 */
export function snapshotProfile(profileDir: string): ProtectedProfileSnapshot {
  const snapshot: Record<keyof ProtectedProfileSnapshot, string | null> = {
    'package.json': null,
    'pnpm-lock.yaml': null,
    'pnpm-workspace.yaml': null,
  };
  for (const { file, target } of protectedProfileFiles(profileDir))
    snapshot[file] = fs.existsSync(target) ? fs.readFileSync(target).toString('base64') : null;
  return Object.freeze(snapshot);
}

/** 使用写前镜像恢复受保护文件，未记录的文件将被删除。 */
export function restoreProfile(profileDir: string, snapshot: ProtectedProfileSnapshot): void {
  for (const { file, target } of protectedProfileFiles(profileDir)) {
    const content = snapshot[file];
    if (content === null) {
      if (fs.existsSync(target)) fs.unlinkSync(target);
    } else {
      fs.writeFileSync(target, Buffer.from(content, 'base64'), { mode: 0o600 });
    }
  }
}

/** 启动时恢复未结算事务，并将 node_modules 状态标记为需人工检查。 */
export function recoverTransactions(profileDir: string, transactionDir: string): RecoveryFact {
  if (!fs.existsSync(transactionDir)) return Object.freeze({ recovered: false, manualRecovery: false, reason: null });
  let recovered = false;
  for (const name of fs.readdirSync(transactionDir).filter((file) => /^install-.*\.json$/.test(file))) {
    const file = path.join(transactionDir, name);
    try {
      const wal = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<InstallWal>;
      if (wal.schema !== 'dsh-forge/desktop-install-wal@1' || !wal.snapshot) throw new Error('WAL 缺少可恢复快照');
      restoreProfile(profileDir, wal.snapshot);
      fs.renameSync(file, `${file}.recovered`);
      recovered = true;
    } catch (error) {
      return Object.freeze({ recovered, manualRecovery: true, reason: errorMessage(error) });
    }
  }
  return Object.freeze({
    recovered,
    manualRecovery: recovered,
    reason: recovered ? '已恢复受保护 profile 文件；node_modules 需要人工检查' : null,
  });
}

export function writeJsonExclusive(file: string, value: unknown): void {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
}
