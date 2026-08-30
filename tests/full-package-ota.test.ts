/** 完整安装包 OTA 的版本、平台边界和受控下载测试。 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ForgeError } from '@dsh-forge/profile-toolchain/core/errors';
import {
  createFullPackageUpdater,
  parseFullPackageVersionManifest,
  readDshForgeBuild,
  type FullPackageUpdaterOptions,
} from '../packages/desktop-services-local/src/full-package-ota.ts';
import type { GenerationLike } from '../packages/desktop-services-local/src/types.ts';

function manifest(overrides: Partial<Record<'windows' | 'macos' | 'ubuntu', Record<string, unknown>>> = {}): string {
  return JSON.stringify({
    windows: { version: '1.0.0', build: 8, url: 'https://github.com/ptonlix/dsh-forge/releases/download/v1.0.0/dsh-forge-windows.exe', ...overrides.windows },
    macos: { version: '1.0.1', build: 1, url: 'https://github.com/ptonlix/dsh-forge/releases/download/v1.0.0/dsh-forge-macos.dmg', ...overrides.macos },
    ubuntu: { version: '1.0.0', build: 9, url: 'https://github.com/ptonlix/dsh-forge/releases/download/v1.0.0/dsh-forge-ubuntu.AppImage', ...overrides.ubuntu },
  });
}

function generation(): GenerationLike & { closed: boolean } {
  return { id: 'ota-generation', profile: 'dsh-forge-official', stage: 'committed', closed: false };
}

function fixtureOptions(
  directory: string,
  current: GenerationLike,
  extra: Partial<FullPackageUpdaterOptions> = {},
): FullPackageUpdaterOptions {
  const packageJsonPath = path.join(directory, 'package.json');
  fs.writeFileSync(packageJsonPath, JSON.stringify({ name: '@dsh-forge/core', dshForgeBuild: 7 }));
  return {
    generation: current,
    userData: path.join(directory, 'user-data'),
    appVersion: '1.0.0',
    packageJsonPath,
    platform: 'win32',
    fetch: async () => new Response(manifest(), { headers: { 'content-type': 'application/json' } }),
    ...extra,
  };
}

test('同版本更高 build 和更高 SemVer 分别在 Windows、macOS、Ubuntu AppImage 可升级', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-ota-version-'));
  const appImage = path.join(directory, 'dsh-forge-ubuntu.AppImage');
  fs.writeFileSync(appImage, 'old');
  fs.chmodSync(appImage, 0o700);
  try {
    const current = generation();
    const windows = createFullPackageUpdater(fixtureOptions(directory, current));
    const windowsCheck = await windows.check();
    assert.equal(windowsCheck.kind, 'available');
    if (windowsCheck.kind === 'available') assert.equal(windowsCheck.update.platform, 'windows');

    const macos = createFullPackageUpdater(fixtureOptions(directory, current, { platform: 'darwin' }));
    const macosCheck = await macos.check();
    assert.equal(macosCheck.kind, 'available');
    if (macosCheck.kind === 'available') assert.equal(macosCheck.update.version, '1.0.1');

    const ubuntu = createFullPackageUpdater(
      fixtureOptions(directory, current, {
        platform: 'linux',
        environment: { APPIMAGE: appImage },
        readOsRelease: () => 'ID=ubuntu\nVERSION_ID="22.04"\n',
      }),
    );
    const ubuntuCheck = await ubuntu.check();
    assert.equal(ubuntuCheck.kind, 'available');
    if (ubuntuCheck.kind === 'available') assert.equal(ubuntuCheck.update.platform, 'ubuntu');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('降级、相同 build、本地非法 build 与无效清单均不会开始下载', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-ota-invalid-'));
  try {
    const current = generation();
    const sameBuild = createFullPackageUpdater(
      fixtureOptions(directory, current, { fetch: async () => new Response(manifest({ windows: { build: 7 } })) }),
    );
    assert.deepEqual(await sameBuild.check(), { kind: 'current' });

    const lowerVersion = createFullPackageUpdater(
      fixtureOptions(directory, current, {
        fetch: async () => new Response(manifest({ windows: { version: '0.9.9', build: 99 } })),
      }),
    );
    assert.deepEqual(await lowerVersion.check(), { kind: 'current' });

    const invalidLocal = createFullPackageUpdater(fixtureOptions(directory, current));
    fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ dshForgeBuild: 0 }));
    assert.deepEqual(await invalidLocal.check(), { kind: 'error', code: 'OTA_LOCAL_BUILD_INVALID' });

    const invalidManifest = createFullPackageUpdater(
      fixtureOptions(directory, current, {
        fetch: async () => new Response(manifest({ windows: { url: 'http://github.com/ptonlix/dsh-forge/releases/download/v1.0.0/dsh-forge-windows.exe' } })),
      }),
    );
    assert.deepEqual(await invalidManifest.check(), { kind: 'error', code: 'OTA_MANIFEST_INVALID' });
    assert.throws(
      () => parseFullPackageVersionManifest({ windows: {}, macos: {}, ubuntu: {}, extra: {} }),
      (error: unknown) => error instanceof ForgeError && error.code === 'OTA_MANIFEST_INVALID',
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('仅 Ubuntu 22.04+ 的可写绝对 AppImage 支持升级', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-ota-ubuntu-'));
  const appImage = path.join(directory, 'dsh-forge-ubuntu.AppImage');
  fs.writeFileSync(appImage, 'old');
  fs.chmodSync(appImage, 0o700);
  try {
    const current = generation();
    const unsupportedDistribution = createFullPackageUpdater(
      fixtureOptions(directory, current, {
        platform: 'linux',
        environment: { APPIMAGE: appImage },
        readOsRelease: () => 'ID=debian\nVERSION_ID="12"\n',
      }),
    );
    assert.deepEqual(await unsupportedDistribution.check(), { kind: 'unsupported' });

    const unsupportedVersion = createFullPackageUpdater(
      fixtureOptions(directory, current, {
        platform: 'linux',
        environment: { APPIMAGE: appImage },
        readOsRelease: () => 'ID=ubuntu\nVERSION_ID="20.04"\n',
      }),
    );
    assert.deepEqual(await unsupportedVersion.check(), { kind: 'unsupported' });

    const relativeAppImage = createFullPackageUpdater(
      fixtureOptions(directory, current, {
        platform: 'linux',
        environment: { APPIMAGE: './dsh-forge-ubuntu.AppImage' },
        readOsRelease: () => 'ID=ubuntu\nVERSION_ID="24.04"\n',
      }),
    );
    assert.deepEqual(await relativeAppImage.check(), { kind: 'unsupported' });

    const linkedAppImage = path.join(directory, 'linked.AppImage');
    fs.symlinkSync(appImage, linkedAppImage);
    const symbolicAppImage = createFullPackageUpdater(
      fixtureOptions(directory, current, {
        platform: 'linux',
        environment: { APPIMAGE: linkedAppImage },
        readOsRelease: () => 'ID=ubuntu\nVERSION_ID="24.04"\n',
      }),
    );
    assert.deepEqual(await symbolicAppImage.check(), { kind: 'unsupported' });

    const readOnlyAppImage = path.join(directory, 'read-only.AppImage');
    fs.writeFileSync(readOnlyAppImage, 'old');
    fs.chmodSync(readOnlyAppImage, 0o400);
    const nonWritableAppImage = createFullPackageUpdater(
      fixtureOptions(directory, current, {
        platform: 'linux',
        environment: { APPIMAGE: readOnlyAppImage },
        readOsRelease: () => 'ID=ubuntu\nVERSION_ID="24.04"\n',
      }),
    );
    assert.deepEqual(await nonWritableAppImage.check(), { kind: 'unsupported' });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('generation 在完整安装包下载中关闭时中止流并删除暂存文件', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-ota-generation-close-'));
  try {
    const current = generation();
    let markStarted: (() => void) | null = null;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const updater = createFullPackageUpdater(
      fixtureOptions(directory, current, {
        fetch: async (_input, init) => {
          const body = new ReadableStream<Uint8Array>({
            start(controller) {
              markStarted?.();
              init?.signal?.addEventListener('abort', () => controller.error(new Error('aborted')), { once: true });
            },
          });
          return new Response(body);
        },
      }),
    );
    const downloading = updater.download({
      platform: 'windows',
      version: '1.0.0',
      build: 8,
      url: 'https://github.com/ptonlix/dsh-forge/releases/download/v1.0.0/dsh-forge-windows.exe',
    });
    await started;
    current.closed = true;
    await assert.rejects(
      downloading,
      (error: unknown) => error instanceof ForgeError && error.code === 'GENERATION_CLOSED',
    );
    const staging = path.join(directory, 'user-data', 'dsh-forge', 'ota');
    assert.equal(fs.existsSync(staging) ? fs.readdirSync(staging).length : 0, 0);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('generation 在版本清单请求中关闭时中止请求且不返回旧结果', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-ota-check-close-'));
  try {
    const current = generation();
    let started!: () => void;
    const requestStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const updater = createFullPackageUpdater(
      fixtureOptions(directory, current, {
        fetch: async (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            started();
            init?.signal?.addEventListener('abort', () => reject(new Error('请求已取消')), { once: true });
          }),
      }),
    );
    const checking = updater.check();
    await requestStarted;
    current.closed = true;
    await assert.rejects(
      checking,
      (error: unknown) => error instanceof ForgeError && error.code === 'GENERATION_CLOSED',
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('GitHub Release 清单和安装包请求跟随正常重定向', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-ota-redirect-'));
  try {
    const redirects: Array<RequestInit['redirect']> = [];
    let request = 0;
    const updater = createFullPackageUpdater(
      fixtureOptions(directory, generation(), {
        fetch: async (_input, init) => {
          redirects.push(init?.redirect);
          request += 1;
          return request === 1 ? new Response(manifest()) : new Response('full-installer');
        },
      }),
    );
    const result = await updater.check();
    assert.equal(result.kind, 'available');
    if (result.kind !== 'available') throw new Error('预期存在更新');
    await updater.download(result.update);
    assert.deepEqual(redirects, ['follow', 'follow']);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('完整安装包下载响应失败时删除暂存文件', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-ota-download-failure-'));
  try {
    const current = generation();
    let request = 0;
    const updater = createFullPackageUpdater(
      fixtureOptions(directory, current, {
        fetch: async () => {
          request += 1;
          return request === 1 ? new Response(manifest()) : new Response('failed', { status: 503 });
        },
      }),
    );
    const check = await updater.check();
    assert.equal(check.kind, 'available');
    if (check.kind !== 'available') throw new Error('预期存在更新');
    await assert.rejects(
      updater.download(check.update),
      (error: unknown) => error instanceof ForgeError && error.code === 'OTA_DOWNLOAD_FAILED',
    );
    const staging = path.join(directory, 'user-data', 'dsh-forge', 'ota');
    assert.equal(fs.existsSync(staging) ? fs.readdirSync(staging).length : 0, 0);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('确认后才下载到唯一暂存文件，下载失败、取消和 generation 关闭均会清理', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-ota-download-'));
  try {
    const current = generation();
    let request = 0;
    const updater = createFullPackageUpdater(
      fixtureOptions(directory, current, {
        fetch: async () => {
          request += 1;
          return request === 1
            ? new Response(manifest())
            : new Response('full-installer', { headers: { 'content-length': '14' } });
        },
      }),
    );
    const result = await updater.check();
    assert.equal(result.kind, 'available');
    if (result.kind !== 'available') throw new Error('预期存在更新');
    const staged = await updater.download(result.update);
    assert.equal(path.extname(staged), '.exe');
    assert.equal(fs.readFileSync(staged, 'utf8'), 'full-installer');
    await updater.discard(staged);
    assert.equal(fs.existsSync(staged), false);

    const cancelling = createFullPackageUpdater(
      fixtureOptions(directory, current, {
        fetch: async (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
          }),
      }),
    );
    const cancelled = cancelling.download(result.update);
    cancelling.cancel();
    await assert.rejects(
      cancelled,
      (error: unknown) => error instanceof ForgeError && error.code === 'OTA_DOWNLOAD_CANCELLED',
    );
    const staging = path.join(directory, 'user-data', 'dsh-forge', 'ota');
    assert.equal(fs.existsSync(staging) ? fs.readdirSync(staging).length : 0, 0);

    current.closed = true;
    await assert.rejects(
      updater.check(),
      (error: unknown) => error instanceof ForgeError && error.code === 'GENERATION_CLOSED',
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('本地 build 必须是正安全整数', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-ota-build-'));
  const packageJson = path.join(directory, 'package.json');
  try {
    fs.writeFileSync(packageJson, JSON.stringify({ dshForgeBuild: 4 }));
    assert.equal(readDshForgeBuild(packageJson), 4);
    for (const build of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, undefined]) {
      fs.writeFileSync(packageJson, JSON.stringify({ dshForgeBuild: build }));
      assert.throws(
        () => readDshForgeBuild(packageJson),
        (error: unknown) => error instanceof ForgeError && error.code === 'OTA_LOCAL_BUILD_INVALID',
      );
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
