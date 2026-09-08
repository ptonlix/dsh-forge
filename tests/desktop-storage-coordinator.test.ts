/**
 * 存储协调器测试：分类求和、符号链接、跨卷、并发 `STORAGE_BUSY`、generation
 * 关闭、确认拒绝、允许清单删除与禁止删除 `other`。
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ForgeError } from '@dsh-forge/profile-toolchain/core/errors';
import { StorageCoordinator, type StorageGenerationLike } from '../apps/desktop/platform/storage-coordinator.ts';
import {
  ELECTRON_CACHE_DIRECTORY_NAMES,
  isSessionProjectionCacheEntry,
} from '../apps/desktop/platform/storage-volume.ts';
import { storageCleanTargets } from '../apps/desktop/platform/storage-clean.ts';

const VOLUME = Object.freeze({ totalBytes: 1_000_000_000, usedBytes: 400_000_000, freeBytes: 600_000_000 });

interface Tree {
  readonly root: string;
  readonly cleanup: () => void;
}

function tree(): Tree {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-storage-'));
  return { root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

function writeTree(root: string, entries: Readonly<Record<string, string | number>>): void {
  for (const [relative, content] of Object.entries(entries)) {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (typeof content === 'number') fs.writeFileSync(file, Buffer.alloc(content, 0x61));
    else fs.writeFileSync(file, content);
  }
}

function generation(closed = false): StorageGenerationLike & { close(): void } {
  const self: StorageGenerationLike & { close(): void } = {
    id: 'gen-storage-test',
    profile: 'dsh-forge-official',
    stage: 'committed',
    closed,
    close() {
      (self as { closed: boolean }).closed = true;
    },
  };
  return self;
}

function makeCoordinator(overrides: {
  readonly dshHome: string;
  readonly userData: string;
  readonly gen?: StorageGenerationLike & { close(): void };
  readonly confirmCacheClean?: () => Promise<boolean>;
  readonly confirmSessionsClean?: () => Promise<boolean>;
  readonly otaStagingBusy?: () => boolean;
  readonly sameVolume?: (left: string, right: string) => boolean;
}) {
  const gen = overrides.gen || generation();
  const instance = new StorageCoordinator({
    generation: gen,
    dshHome: overrides.dshHome,
    userData: overrides.userData,
    confirmCacheClean: overrides.confirmCacheClean ?? (async () => true),
    confirmSessionsClean: overrides.confirmSessionsClean ?? (async () => true),
    otaStagingBusy: overrides.otaStagingBusy,
    volumeFacts: () => VOLUME,
    sameVolume: overrides.sameVolume ?? (() => true),
  });
  return { coordinator: instance, gen };
}

function assertForgeCode(promise: Promise<unknown>, code: string): Promise<void> {
  return promise.then(
    () => {
      assert.fail(`应抛出错误 code ${code}`);
    },
    (error: unknown) => {
      assert.ok(error instanceof ForgeError, `期望 ForgeError，实际 ${String(error)}`);
      assert.equal(error.code, code);
    },
  );
}

test('分类汇总固定根目录且三类之和等于应用已用总量', async () => {
  const home = tree();
  const userData = tree();
  try {
    writeTree(home.root, {
      'sessions/workspace-a/session-1.jsonl': 10,
      'storages/session_projcache/cache.bin': 20,
      'storages/session_projcache.json': 5,
      'storages/session_projcache.incompatible-2026-09-01T00-00-00/moved.bin': 3,
      'storages/session-domain/x.bin': 7,
      'profiles/dsh-forge-official/package.json': 9,
      '.credentials.yaml': 3,
    });
    writeTree(userData.root, {
      'Cache/f_000001': 100,
      'Code Cache/js/script.js': 50,
      'GPUCache/data_0': 25,
      'dsh-forge/ota/package-12345678-1234-4123-8123-123456789012.dmg': 200,
      'dsh-forge/ota/package-12345678-1234-4123-8123-123456789013.exe.partial': 40,
      'dsh-forge/profile-state.json': 30,
      'Preferences': 40,
    });
    const { coordinator } = makeCoordinator({ dshHome: home.root, userData: userData.root });
    const snapshot = await coordinator.refresh();
    assert.equal(snapshot.phase, 'ready');
    assert.equal(snapshot.cacheBytes, 20 + 5 + 3 + 100 + 50 + 25 + 200 + 40);
    assert.equal(snapshot.sessionsBytes, 10);
    assert.equal(snapshot.otherBytes, 7 + 9 + 3 + 30 + 40);
    assert.equal(snapshot.appUsedBytes, snapshot.cacheBytes + snapshot.sessionsBytes + snapshot.otherBytes);
    assert.deepEqual(snapshot.volume, VOLUME);
    assert.equal(snapshot.userDataOnDifferentVolume, false);
    assert.equal(snapshot.errorCode, null);
    assert.ok(typeof snapshot.scannedAt === 'string');
  } finally {
    home.cleanup();
    userData.cleanup();
  }
});

test('启动与未打开页面时快照保持 idle，不触发扫描', () => {
  const home = tree();
  const userData = tree();
  try {
    writeTree(home.root, { 'sessions/a.bin': 10 });
    const { coordinator } = makeCoordinator({ dshHome: home.root, userData: userData.root });
    const snapshot = coordinator.status();
    assert.equal(snapshot.phase, 'idle');
    assert.equal(snapshot.appUsedBytes, 0);
    assert.equal(snapshot.volume, null);
    assert.equal(snapshot.scannedAt, null);
  } finally {
    home.cleanup();
    userData.cleanup();
  }
});

test('指向根外的符号链接不计占用也不被删除', async () => {
  const home = tree();
  const userData = tree();
  const outside = tree();
  const canLink = (): boolean => {
    try {
      fs.writeFileSync(path.join(outside.root, 'secret.bin'), Buffer.alloc(500, 0x62));
      fs.symlinkSync(outside.root, path.join(home.root, 'linked-outside'), 'dir');
      fs.symlinkSync(path.join(outside.root, 'secret.bin'), path.join(home.root, 'sessions', 'linked-file'), 'file');
      return true;
    } catch {
      return false;
    }
  };
  try {
    writeTree(home.root, { 'sessions/real.bin': 10, 'storages/session_projcache/c.bin': 4 });
    if (!canLink()) return;
    const { coordinator } = makeCoordinator({ dshHome: home.root, userData: userData.root });
    const snapshot = await coordinator.refresh();
    assert.equal(snapshot.sessionsBytes, 10);
    assert.equal(snapshot.otherBytes, 0);
    assert.equal(snapshot.cacheBytes, 4);
    await coordinator.cleanCache();
    assert.equal(fs.existsSync(path.join(outside.root, 'secret.bin')), true);
    assert.equal(fs.existsSync(path.join(home.root, 'linked-outside')), true);
    assert.equal(fs.existsSync(path.join(home.root, 'sessions', 'linked-file')), true);
  } finally {
    outside.cleanup();
    home.cleanup();
    userData.cleanup();
  }
});

test('userData 跨卷时只标记，不把两卷容量相加', async () => {
  const home = tree();
  const userData = tree();
  try {
    writeTree(home.root, { 'sessions/a.bin': 10 });
    writeTree(userData.root, { 'Cache/f.bin': 100 });
    const { coordinator } = makeCoordinator({
      dshHome: home.root,
      userData: userData.root,
      sameVolume: () => false,
    });
    const snapshot = await coordinator.refresh();
    assert.equal(snapshot.userDataOnDifferentVolume, true);
    assert.deepEqual(snapshot.volume, VOLUME);
  } finally {
    home.cleanup();
    userData.cleanup();
  }
});

test('扫描与清理并发时第二次请求以 STORAGE_BUSY 失败', async () => {
  const home = tree();
  const userData = tree();
  let acceptClean: (value: boolean) => void = () => {};
  const confirmGate = new Promise<boolean>((resolve) => {
    acceptClean = resolve;
  });
  try {
    writeTree(home.root, { 'sessions/a.bin': 10 });
    const { coordinator } = makeCoordinator({
      dshHome: home.root,
      userData: userData.root,
      confirmCacheClean: () => confirmGate,
    });
    const cleaning = coordinator.cleanCache();
    await new Promise<void>((resolve) => setImmediate(resolve));
    await assertForgeCode(coordinator.refresh(), 'STORAGE_BUSY');
    await assertForgeCode(coordinator.cleanSessions(), 'STORAGE_BUSY');
    acceptClean(true);
    const after = await cleaning;
    // 缓存清理不删除会话正文；快照与会话文件保持一致。
    assert.equal(after.sessionsBytes, 10);
    assert.equal(fs.existsSync(path.join(home.root, 'sessions', 'a.bin')), true);
  } finally {
    home.cleanup();
    userData.cleanup();
  }
});

test('generation 关闭后调用以 GENERATION_CLOSED 失败，进行中的清理停止且不改磁盘', async () => {
  const home = tree();
  const userData = tree();
  let acceptClean: (value: boolean) => void = () => {};
  const confirmGate = new Promise<boolean>((resolve) => {
    acceptClean = resolve;
  });
  try {
    writeTree(home.root, { 'sessions/a.bin': 10, 'storages/session_projcache/c.bin': 4 });
    const gen = generation();
    const { coordinator } = makeCoordinator({
      dshHome: home.root,
      userData: userData.root,
      gen,
      confirmSessionsClean: () => confirmGate,
    });
    const cleaning = coordinator.cleanSessions();
    await new Promise<void>((resolve) => setImmediate(resolve));
    gen.close();
    acceptClean(true);
    await assertForgeCode(cleaning, 'GENERATION_CLOSED');
    assert.equal(fs.existsSync(path.join(home.root, 'sessions', 'a.bin')), true);
    await assertForgeCode(coordinator.refresh(), 'GENERATION_CLOSED');
  } finally {
    home.cleanup();
    userData.cleanup();
  }
});

test('扫描中途 generation 关闭时停止遍历且迟到快照不写回', async () => {
  const home = tree();
  const userData = tree();
  try {
    const entries: Record<string, string | number> = {};
    for (let index = 0; index < 2_000; index += 1) {
      entries[`Cache/file-${index}.bin`] = 1;
    }
    writeTree(userData.root, entries);
    const gen = generation();
    const { coordinator } = makeCoordinator({ dshHome: home.root, userData: userData.root, gen });
    const scanning = coordinator.refresh();
    gen.close();
    await assertForgeCode(scanning, 'GENERATION_CLOSED');
    assert.equal(coordinator.status().phase, 'scanning');
    assert.equal(coordinator.status().scannedAt, null);
  } finally {
    home.cleanup();
    userData.cleanup();
  }
});

test('dispose 取消进行中的扫描，结果不得写回', async () => {
  const home = tree();
  const userData = tree();
  try {
    const entries: Record<string, string | number> = {};
    for (let index = 0; index < 2_000; index += 1) {
      entries[`Cache/file-${index}.bin`] = 1;
    }
    writeTree(userData.root, entries);
    const { coordinator } = makeCoordinator({ dshHome: home.root, userData: userData.root });
    const scanning = coordinator.refresh();
    coordinator.dispose();
    await assertForgeCode(scanning, 'STORAGE_CANCELLED');
    assert.equal(coordinator.status().phase, 'scanning');
  } finally {
    home.cleanup();
    userData.cleanup();
  }
});

test('用户拒绝清理缓存时磁盘不变，快照保持确认前的分类字节', async () => {
  const home = tree();
  const userData = tree();
  try {
    writeTree(home.root, { 'storages/session_projcache/c.bin': 40 });
    const { coordinator } = makeCoordinator({
      dshHome: home.root,
      userData: userData.root,
      confirmCacheClean: async () => false,
    });
    const before = await coordinator.refresh();
    const after = await coordinator.cleanCache();
    assert.equal(after.cacheBytes, before.cacheBytes);
    assert.equal(fs.existsSync(path.join(home.root, 'storages', 'session_projcache', 'c.bin')), true);
  } finally {
    home.cleanup();
    userData.cleanup();
  }
});

test('缓存清理只删除允许清单，保留会话、凭据、受管 profile 与其他数据', async () => {
  const home = tree();
  const userData = tree();
  try {
    writeTree(home.root, {
      'sessions/a.jsonl': 10,
      'storages/session_projcache/c.bin': 20,
      'storages/session_projcache.json': 5,
      'storages/session_projcache.incompatible-2026-09-01T00-00-00/m.bin': 3,
      'profiles/dsh-forge-official/package.json': 9,
      '.credentials.yaml': 3,
    });
    writeTree(userData.root, {
      'Cache/f.bin': 100,
      'Code Cache/js/x.js': 50,
      'dsh-forge/ota/package-12345678-1234-4123-8123-123456789012.dmg': 200,
      'dsh-forge/ota/package-12345678-1234-4123-8123-123456789013.exe.partial': 40,
      'dsh-forge/profile-state.json': 30,
      'Preferences': 40,
    });
    const { coordinator } = makeCoordinator({ dshHome: home.root, userData: userData.root });
    await coordinator.refresh();
    const after = await coordinator.cleanCache();
    for (const gone of [
      'storages/session_projcache',
      'storages/session_projcache.json',
      'storages/session_projcache.incompatible-2026-09-01T00-00-00',
    ]) {
      assert.equal(fs.existsSync(path.join(home.root, gone)), false, `${gone} 应被删除`);
    }
    assert.equal(fs.existsSync(path.join(userData.root, 'Cache')), false);
    assert.equal(fs.existsSync(path.join(userData.root, 'Code Cache')), false);
    assert.equal(fs.existsSync(path.join(userData.root, 'dsh-forge', 'ota', 'package-12345678-1234-4123-8123-123456789012.dmg')), false);
    assert.equal(fs.existsSync(path.join(userData.root, 'dsh-forge', 'ota', 'package-12345678-1234-4123-8123-123456789013.exe.partial')), false);
    assert.equal(fs.existsSync(path.join(home.root, 'sessions', 'a.jsonl')), true);
    assert.equal(fs.existsSync(path.join(home.root, 'profiles', 'dsh-forge-official', 'package.json')), true);
    assert.equal(fs.existsSync(path.join(home.root, '.credentials.yaml')), true);
    assert.equal(fs.existsSync(path.join(userData.root, 'dsh-forge', 'profile-state.json')), true);
    assert.equal(fs.existsSync(path.join(userData.root, 'Preferences')), true);
    assert.equal(after.sessionsBytes, 10);
    assert.equal(after.cacheBytes, 0);
  } finally {
    home.cleanup();
    userData.cleanup();
  }
});

test('OTA 下载或准备中时缓存清理跳过暂存目录', async () => {
  const home = tree();
  const userData = tree();
  try {
    writeTree(userData.root, {
      'dsh-forge/ota/package-12345678-1234-4123-8123-123456789012.dmg': 200,
      'Cache/f.bin': 20,
    });
    const { coordinator } = makeCoordinator({
      dshHome: home.root,
      userData: userData.root,
      otaStagingBusy: () => true,
    });
    await coordinator.refresh();
    await coordinator.cleanCache();
    assert.equal(fs.existsSync(path.join(userData.root, 'Cache')), false);
    assert.equal(
      fs.existsSync(path.join(userData.root, 'dsh-forge', 'ota', 'package-12345678-1234-4123-8123-123456789012.dmg')),
      true,
    );
  } finally {
    home.cleanup();
    userData.cleanup();
  }
});

test('会话清理只删除 sessions/ 正文并保留凭据与受管 profile', async () => {
  const home = tree();
  const userData = tree();
  try {
    writeTree(home.root, {
      'sessions/workspace-a/session-1.jsonl': 10,
      'sessions/workspace-a/session-2.jsonl': 20,
      'storages/session_projcache/c.bin': 30,
      'profiles/dsh-forge-official/package.json': 9,
      '.credentials.yaml': 3,
    });
    const { coordinator } = makeCoordinator({ dshHome: home.root, userData: userData.root });
    await coordinator.refresh();
    const after = await coordinator.cleanSessions();
    assert.equal(fs.existsSync(path.join(home.root, 'sessions', 'workspace-a')), false);
    assert.equal(fs.existsSync(path.join(home.root, 'sessions')), true);
    assert.equal(fs.existsSync(path.join(home.root, '.credentials.yaml')), true);
    assert.equal(fs.existsSync(path.join(home.root, 'profiles', 'dsh-forge-official', 'package.json')), true);
    assert.equal(fs.existsSync(path.join(home.root, 'storages', 'session_projcache', 'c.bin')), true);
    assert.equal(after.sessionsBytes, 0);
    assert.equal(after.cacheBytes, 30);
  } finally {
    home.cleanup();
    userData.cleanup();
  }
});

test('禁止把 other、凭据或受管 profile 作为清理目标', () => {
  const home = tree();
  const userData = tree();
  try {
    writeTree(home.root, {
      '.credentials.yaml': 3,
      'profiles/dsh-forge-official/package.json': 9,
      'sessions/a.jsonl': 10,
    });
    writeTree(userData.root, { 'Preferences': 4 });
    assert.throws(
      () => storageCleanTargets({ dshHome: home.root, userData: userData.root }, 'other' as never),
      (error: unknown) => error instanceof ForgeError && error.code === 'STORAGE_CLEAN_NOT_ALLOWED',
    );
    const cacheTargets = storageCleanTargets({ dshHome: home.root, userData: userData.root }, 'cache');
    const sessionsTargets = storageCleanTargets({ dshHome: home.root, userData: userData.root }, 'sessions');
    const serialized = cacheTargets.concat(sessionsTargets).join('\n');
    assert.doesNotMatch(serialized, /credentials|profiles|Preferences/);
  } finally {
    home.cleanup();
    userData.cleanup();
  }
});

test('权限不足时快照带 STORAGE_SCAN_INCOMPLETE，不抛出未分类异常', async () => {
  const home = tree();
  const userData = tree();
  const blocked = path.join(home.root, 'storages', 'session_projcache', 'blocked');
  let canBlock = true;
  try {
    writeTree(home.root, {
      'sessions/a.jsonl': 10,
      'storages/session_projcache/readable.bin': 5,
      'storages/session_projcache/blocked/inside.bin': 100,
    });
    try {
      fs.chmodSync(blocked, 0o000);
    } catch {
      canBlock = false;
    }
    if (!canBlock || process.platform === 'win32') return;
    const { coordinator } = makeCoordinator({ dshHome: home.root, userData: userData.root });
    const snapshot = await coordinator.refresh();
    assert.equal(snapshot.errorCode, 'STORAGE_SCAN_INCOMPLETE');
    assert.equal(snapshot.cacheBytes, 5);
    assert.equal(snapshot.sessionsBytes, 10);
  } finally {
    if (canBlock) {
      try {
        fs.chmodSync(blocked, 0o755);
      } catch {
        // 目录可能已被测试运行环境清理。
      }
    }
    home.cleanup();
    userData.cleanup();
  }
});

test('缓存清理结束后返回包含新占用事实的快照', async () => {
  const home = tree();
  const userData = tree();
  try {
    writeTree(home.root, { 'storages/session_projcache/big.bin': 500, 'sessions/a.jsonl': 10 });
    const { coordinator } = makeCoordinator({ dshHome: home.root, userData: userData.root });
    const before = await coordinator.refresh();
    const after = await coordinator.cleanCache();
    assert.ok(after.cacheBytes < before.cacheBytes);
    assert.equal(after.sessionsBytes, before.sessionsBytes);
    assert.ok(typeof after.scannedAt === 'string');
  } finally {
    home.cleanup();
    userData.cleanup();
  }
});

test('扫描分类辅助保持投影缓存与 Electron 缓存目录的固定命名', () => {
  assert.equal(isSessionProjectionCacheEntry('session_projcache'), true);
  assert.equal(isSessionProjectionCacheEntry('session_projcache.json'), true);
  assert.equal(isSessionProjectionCacheEntry('session_projcache.incompatible-2026-09-01T00-00-00'), true);
  assert.equal(isSessionProjectionCacheEntry('session-domain'), false);
  assert.ok(ELECTRON_CACHE_DIRECTORY_NAMES.includes('Cache'));
  assert.ok(ELECTRON_CACHE_DIRECTORY_NAMES.includes('Code Cache'));
  assert.ok(ELECTRON_CACHE_DIRECTORY_NAMES.includes('GPUCache'));
});
