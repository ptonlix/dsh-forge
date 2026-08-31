import * as path from 'node:path';
import type { FullPackageUpdate, FullPackageUpdater } from '@dsh-forge/desktop-services-local/launcher';
import { prepareFullPackageUpgrade, type FullPackageUpgradeRequest } from './full-package-upgrade.ts';

export type FullPackageUpgradeOfferResult =
  | Readonly<{ readonly kind: 'unavailable' }>
  | Readonly<{ readonly kind: 'declined' }>
  | Readonly<{ readonly kind: 'prepared' }>
  | Readonly<{ readonly kind: 'failed'; readonly code: string }>;

/**
 * OTA 只在当前 generation 已提交后由主进程发起。失败和用户拒绝均保持当前
 * 应用运行；只有 helper 已启动后才请求受控退出。
 */
export async function offerFullPackageUpgrade({
  updater,
  update,
  confirm,
  requestExit,
  prepare = prepareFullPackageUpgrade,
  signal,
  onDownloadProgress,
  onPreparing,
}: {
  readonly updater: FullPackageUpdater;
  readonly update?: FullPackageUpdate;
  readonly confirm: (update: { readonly version: string; readonly build: number }) => Promise<boolean>;
  readonly requestExit: (reason: string) => Promise<void>;
  readonly prepare?: (request: FullPackageUpgradeRequest) => ReturnType<typeof prepareFullPackageUpgrade>;
  readonly signal?: AbortSignal;
  readonly onDownloadProgress?: (progress: {
    readonly receivedBytes: number;
    readonly totalBytes: number | null;
    readonly percent: number | null;
  }) => void;
  readonly onPreparing?: () => void;
}): Promise<FullPackageUpgradeOfferResult> {
  let stagedPackage: string | null = null;
  let helperPrepared = false;
  try {
    let candidate = update;
    if (!candidate) {
      const check = await updater.check(signal);
      if (check.kind !== 'available') return Object.freeze({ kind: 'unavailable' });
      candidate = check.update;
    }
    if (!(await confirm(candidate))) return Object.freeze({ kind: 'declined' });
    stagedPackage = await updater.download(candidate, { signal, onProgress: onDownloadProgress });
    onPreparing?.();
    await prepare({
      platform: candidate.platform,
      stagedPackage,
      stagingDirectory: path.dirname(stagedPackage),
      electronPid: process.pid,
      executablePath: process.execPath,
      appImagePath: process.env.APPIMAGE,
    });
    helperPrepared = true;
    await requestExit('full-package-upgrade');
    return Object.freeze({ kind: 'prepared' });
  } catch {
    // 升级失败不影响当前 generation；下载器和 helper 都不会在此处泄露本机路径。
    if (stagedPackage && !helperPrepared) await updater.discard(stagedPackage);
    return Object.freeze({ kind: 'failed', code: 'OTA_UPGRADE_FAILED' });
  }
}
