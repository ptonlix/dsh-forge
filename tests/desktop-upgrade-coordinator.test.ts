/** generation-owned 升级协调器的静默检查、合并和释放语义测试。 */
import assert from 'node:assert/strict';
import type { FullPackageUpdateCheck, FullPackageUpdater } from '../packages/desktop-services-local/src/full-package-ota.ts';
import { UpgradeCoordinator } from '../apps/desktop/platform/upgrade-coordinator.ts';

function updater(
  check: (signal?: AbortSignal) => Promise<FullPackageUpdateCheck>,
  download: FullPackageUpdater['download'] = async () => '/tmp/package.exe',
): FullPackageUpdater {
  return {
    isSupported: () => true,
    check,
    download,
    cancel: () => {},
    discard: async () => {},
  };
}

test('就绪后的静默检查只更新状态，不显示确认', async () => {
  let checks = 0;
  let confirmations = 0;
  const coordinator = new UpgradeCoordinator({
    updater: updater(async () => {
      checks += 1;
      return {
        kind: 'available',
        update: { platform: 'windows', version: '1.1.0', build: 2, url: 'https://example.com/app.exe' },
      };
    }),
    version: '1.0.0',
    build: 1,
    confirm: async () => {
      confirmations += 1;
      return false;
    },
    requestExit: async () => {},
  });
  coordinator.start();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(checks, 1);
  assert.equal(confirmations, 0);
  assert.equal(coordinator.status().phase, 'available');
  coordinator.dispose();
});

test('重叠检查共享同一个 version.json 请求', async () => {
  let release!: (value: FullPackageUpdateCheck) => void;
  let checks = 0;
  const pending = new Promise<FullPackageUpdateCheck>((resolve) => {
    release = resolve;
  });
  const coordinator = new UpgradeCoordinator({
    updater: updater(async () => {
      checks += 1;
      return pending;
    }),
    version: '1.0.0',
    build: 1,
    confirm: async () => false,
    requestExit: async () => {},
  });
  const first = coordinator.check();
  const second = coordinator.check();
  assert.strictEqual(first, second);
  release({ kind: 'current' });
  await first;
  assert.equal(checks, 1);
  coordinator.dispose();
});

test('立即升级会重新检查，旧候选失效时不确认也不下载', async () => {
  let checks = 0;
  let confirmations = 0;
  let downloads = 0;
  const coordinator = new UpgradeCoordinator({
    updater: updater(async () => {
      checks += 1;
      return checks === 1
        ? { kind: 'available', update: { platform: 'windows', version: '1.1.0', build: 2, url: 'https://example.com/app.exe' } }
        : { kind: 'current' };
    }, async () => {
      downloads += 1;
      return '/tmp/package.exe';
    }),
    version: '1.0.0',
    build: 1,
    confirm: async () => {
      confirmations += 1;
      return true;
    },
    requestExit: async () => {},
  });
  await coordinator.check();
  await coordinator.startUpgrade();
  assert.equal(checks, 2);
  assert.equal(confirmations, 0);
  assert.equal(downloads, 0);
  assert.equal(coordinator.status().phase, 'current');
  coordinator.dispose();
});

test('释放会取消进行中的检查且迟到结果不能写回', async () => {
  let signal: AbortSignal | undefined;
  let release!: (value: FullPackageUpdateCheck) => void;
  const pending = new Promise<FullPackageUpdateCheck>((resolve) => {
    release = resolve;
  });
  const coordinator = new UpgradeCoordinator({
    updater: updater(async (candidateSignal) => {
      signal = candidateSignal;
      return pending;
    }),
    version: '1.0.0',
    build: 1,
    confirm: async () => false,
    requestExit: async () => {},
  });
  const task = coordinator.check();
  coordinator.dispose();
  release({ kind: 'available', update: { platform: 'windows', version: '1.1.0', build: 2, url: 'https://example.com/app.exe' } });
  await task;
  assert.equal(signal?.aborted, true);
  assert.equal(coordinator.status().phase, 'checking');
});

test('下载期间状态投影百分比，准备 helper 时清空进度', async () => {
  let releaseDownload!: () => void;
  const downloadStarted = new Promise<void>((resolve) => { releaseDownload = resolve; });
  let receivedProgress: ((progress: {
    readonly receivedBytes: number;
    readonly totalBytes: number | null;
    readonly percent: number | null;
  }) => void) | undefined;
  const coordinator = new UpgradeCoordinator({
    updater: updater(
      async () => ({
        kind: 'available',
        update: { platform: 'windows', version: '1.1.0', build: 2, url: 'https://example.com/app.exe' },
      }),
      async (_update, options) => {
        receivedProgress = options?.onProgress;
        receivedProgress?.({ receivedBytes: 50, totalBytes: 100, percent: 50 });
        await downloadStarted;
        receivedProgress?.({ receivedBytes: 100, totalBytes: 100, percent: 100 });
        return '/tmp/package.exe';
      },
    ),
    version: '1.0.0',
    build: 1,
    confirm: async () => true,
    requestExit: async () => {},
  });
  const upgrading = coordinator.startUpgrade();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(coordinator.status().phase, 'downloading');
  assert.deepEqual(coordinator.status().download, { receivedBytes: 50, totalBytes: 100, percent: 50 });
  releaseDownload();
  await upgrading;
  coordinator.dispose();
});
