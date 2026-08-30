/** 完整安装包 OTA 的确认、helper 准备与受控退出编排测试。 */
import assert from 'node:assert/strict';
import { offerFullPackageUpgrade } from '../apps/desktop/platform/full-package-offer.ts';
import type { FullPackageUpdater } from '../packages/desktop-services-local/src/full-package-ota.ts';

function updater(overrides: Partial<FullPackageUpdater> = {}): FullPackageUpdater {
  return {
    isSupported: () => true,
    check: async () => ({
      kind: 'available',
      update: {
        platform: 'windows',
        version: '1.0.0',
        build: 2,
        url: 'https://github.com/ptonlix/dsh-forge/releases/download/v1.0.0/dsh-forge-windows.exe',
      },
    }),
    download: async () => '/temporary/dsh-forge/ota/package.exe',
    cancel: () => {},
    discard: async () => {},
    ...overrides,
  };
}

test('用户拒绝升级时不下载、不准备 helper，也不退出当前 generation', async () => {
  const calls: string[] = [];
  await offerFullPackageUpgrade({
    updater: updater({
      check: async () => {
        calls.push('check');
        return {
          kind: 'available',
          update: {
            platform: 'windows',
            version: '1.0.0',
            build: 2,
            url: 'https://github.com/ptonlix/dsh-forge/releases/download/v1.0.0/dsh-forge-windows.exe',
          },
        };
      },
      download: async () => {
        calls.push('download');
        return '/temporary/dsh-forge/ota/package.exe';
      },
    }),
    confirm: async () => {
      calls.push('confirm');
      return false;
    },
    prepare: async () => {
      calls.push('prepare');
      return { configuration: '/temporary/dsh-forge/ota/upgrade.json' };
    },
    requestExit: async () => {
      calls.push('exit');
    },
  });
  assert.deepEqual(calls, ['check', 'confirm']);
});

test('完整包下载并准备 helper 成功后才按受控路径退出', async () => {
  const calls: string[] = [];
  await offerFullPackageUpgrade({
    updater: updater({
      check: async () => {
        calls.push('check');
        return {
          kind: 'available',
          update: {
            platform: 'ubuntu',
            version: '1.0.1',
            build: 1,
            url: 'https://github.com/ptonlix/dsh-forge/releases/download/v1.0.0/dsh-forge-ubuntu.AppImage',
          },
        };
      },
      download: async () => {
        calls.push('download');
        return '/temporary/dsh-forge/ota/package.AppImage';
      },
    }),
    confirm: async () => {
      calls.push('confirm');
      return true;
    },
    prepare: async (request) => {
      calls.push(`prepare:${request.platform}:${request.stagedPackage}`);
      return { configuration: '/temporary/dsh-forge/ota/upgrade.json' };
    },
    requestExit: async (reason) => {
      calls.push(`exit:${reason}`);
    },
  });
  assert.deepEqual(calls, [
    'check',
    'confirm',
    'download',
    'prepare:ubuntu:/temporary/dsh-forge/ota/package.AppImage',
    'exit:full-package-upgrade',
  ]);
});

test('helper 准备失败时删除本次完整包且不退出', async () => {
  const calls: string[] = [];
  await offerFullPackageUpgrade({
    updater: updater({
      download: async () => {
        calls.push('download');
        return '/temporary/dsh-forge/ota/package.exe';
      },
      discard: async (stagedPackage) => {
        calls.push(`discard:${stagedPackage}`);
      },
    }),
    confirm: async () => true,
    prepare: async () => Promise.reject(new Error('helper 无法启动')),
    requestExit: async () => {
      calls.push('exit');
    },
  });
  assert.deepEqual(calls, ['download', 'discard:/temporary/dsh-forge/ota/package.exe']);
});
