/** runtime service 生命周期测试：覆盖 generation 回退、进程取消、WAL 恢复和 profile 越界。 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Readable } from 'node:stream';

import { ProfileStateStore } from '../apps/desktop/runtime/state-store.ts';
import { GenerationManager, Generation } from '../apps/desktop/runtime/generation.ts';
import {
  DesktopPnpmProvider,
  DesktopProfilesProvider,
  recoverTransactions,
  snapshotProfile,
} from '@dsh-forge/desktop-plugin';
import { spawnTree } from '../packages/desktop-plugin/host/process-tree.ts';
import { ForgeError } from '../packages/desktop-plugin/host/errors.ts';
import type { GenerationHooks, ProcessResult, ProcessOperation } from '../apps/desktop/runtime/types.ts';

const DISTRIBUTION_PROFILE = 'dsh-forge-official';

function makeManager(hooks: GenerationHooks = {}): { dir: string; manager: GenerationManager } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-state-'));
  const store = new ProfileStateStore(dir);
  return {
    dir,
    manager: new GenerationManager({
      stateStore: store,
      profiles: [{ name: DISTRIBUTION_PROFILE, default: true, selectable: true }],
      hooks,
      healthDeadlineMs: 30,
    }),
  };
}
function fakeSpawn(result: ProcessResult = { exitCode: 0, signal: null, cancelled: false }): () => ProcessOperation {
  return () => ({
    stdout: Readable.from([]),
    stderr: Readable.from([]),
    done: Promise.resolve(result),
    cancel: () => Promise.resolve(),
  });
}

test('同目标选择合并，不同目标被拒绝，成功后提交 last-known-good', async () => {
  const { dir, manager } = makeManager({
    hostReady: async () => {},
    webReady: async () => {},
    windowReady: async () => {},
    rendererReady: async () => {},
    interactionReady: async () => {},
  });
  const first = manager.select(DISTRIBUTION_PROFILE);
  const second = manager.select(DISTRIBUTION_PROFILE);
  assert.equal(first, second);
  await first;
  assert.equal(manager.snapshot.lastKnownGood, DISTRIBUTION_PROFILE);
  assert.equal(manager.snapshot.pending, null);
  await manager.dispose();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('renderer 超时进入 manual recovery，旧 generation service 调用失败', async () => {
  const { dir, manager } = makeManager({
    hostReady: async () => {},
    webReady: async () => {},
    windowReady: async () => {},
    rendererReady: () => new Promise(() => {}),
  });
  await assert.rejects(
    manager.select(DISTRIBUTION_PROFILE),
    (error: unknown) => error instanceof ForgeError && error.code === 'GENERATION_FAILED',
  );
  assert.ok(manager.snapshot.manualRecovery);
  const old = new Generation(manager, DISTRIBUTION_PROFILE);
  await old.dispose();
  assert.throws(
    () => old.assertOpen(),
    (error: unknown) => error instanceof ForgeError && error.code === 'GENERATION_CLOSED',
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test('失败 generation 最多自动恢复一次到 last-known-good，并保留失败事实', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-recovery-state-'));
  let failBeta = false;
  const store = new ProfileStateStore(dir);
  const manager = new GenerationManager({
    stateStore: store,
    profiles: [
      { name: DISTRIBUTION_PROFILE, default: true, selectable: true },
      { name: 'beta', selectable: true },
    ],
    hooks: {
      hostReady: async () => {},
      webReady: async () => {},
      windowReady: async () => {},
      rendererReady: async (generation) => {
        if (failBeta && generation.profile === 'beta') throw new Error('beta failure');
      },
      interactionReady: async () => {},
    },
  });
  await manager.select(DISTRIBUTION_PROFILE);
  failBeta = true;
  const generation = await manager.select('beta');
  assert.equal(generation.profile, DISTRIBUTION_PROFILE);
  assert.equal(manager.snapshot.active, DISTRIBUTION_PROFILE);
  assert.equal(manager.snapshot.lastFailure.target, 'beta');
  await manager.dispose();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('状态目录拒绝符号链接，窗口隐藏与显式退出具有不同生命周期', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-link-'));
  const target = path.join(parent, 'target');
  fs.mkdirSync(target);
  const link = path.join(parent, 'link');
  fs.symlinkSync(target, link);
  assert.throws(
    () => new ProfileStateStore(link),
    (error: unknown) => error instanceof ForgeError && error.code === 'STATE_SYMLINK',
  );
  let hidden = 0;
  let disposed = 0;
  const { dir, manager } = makeManager({
    hostReady: async () => {},
    webReady: async () => {},
    windowReady: async () => {},
    rendererReady: async () => {},
    interactionReady: async () => {},
    hideWindow: async () => {
      hidden += 1;
    },
    dispose: async () => {
      disposed += 1;
    },
  });
  await manager.select(DISTRIBUTION_PROFILE);
  await manager.hideWindow();
  assert.equal(hidden, 1);
  assert.equal(disposed, 0);
  await manager.signal('SIGTERM');
  assert.equal(disposed, 1);
  fs.rmSync(parent, { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('desktopPnpm 拒绝 add、busy、NUL 与关闭 generation', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-pnpm-'));
  const generation = { id: 'test', profile: DISTRIBUTION_PROFILE, context: {}, stage: 'preparing', closed: false, attach() {} };
  const provider = new DesktopPnpmProvider({ generation, profileDir: dir, spawn: fakeSpawn() });
  assert.throws(
    () => provider.runPlugin(['add', 'x']),
    (error: unknown) => error instanceof ForgeError && error.code === 'PACKAGE_INSTALL_API',
  );
  assert.throws(
    () => provider.runPlugin(['x\0']),
    (error: unknown) => error instanceof ForgeError && error.code === 'SERVICE_ARGUMENT',
  );
  let complete: (result: ProcessResult) => void = () => {};
  const active = {
    stdout: Readable.from([]),
    stderr: Readable.from([]),
    done: new Promise<ProcessResult>((resolve) => {
      complete = resolve;
    }),
    cancel: () => {
      complete({ exitCode: null, signal: 'SIGTERM', cancelled: true });
      return Promise.resolve();
    },
  };
  provider.spawn = () => active;
  provider.runPlugin(['install']);
  assert.throws(
    () => provider.runPlugin(['install']),
    (error: unknown) => error instanceof ForgeError && error.code === 'PACKAGE_BUSY',
  );
  await provider.dispose();
  assert.equal(provider.closed, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('可恢复安装封存 receipt，失败时只恢复受保护 profile 文件', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-install-'));
  for (const file of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'])
    fs.writeFileSync(path.join(dir, file), `${file}-before`);
  const generation = { id: 'test', profile: DISTRIBUTION_PROFILE, context: {}, stage: 'preparing', closed: false, attach() {} };
  const provider = new DesktopPnpmProvider({ generation, profileDir: dir, spawn: fakeSpawn() });
  const operation = provider.installPlugin(
    { bundle: '@fixture/plugin', version: '1.2.3', source: 'npm' },
    { reconcile: async () => {}, verifyNextGeneration: async () => true },
  );
  assert.equal((await operation.done).exitCode, 0);
  assert.equal(
    fs.readdirSync(path.join(dir, '.recovery')).some((file) => file.endsWith('.receipt')),
    true,
  );
  await provider.dispose();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('安装部分失败恢复配置，但明确不承诺 node_modules 回滚', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-install-failure-'));
  for (const file of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'])
    fs.writeFileSync(path.join(dir, file), `${file}-before`);
  const generation = { id: 'test', profile: DISTRIBUTION_PROFILE, context: {}, stage: 'preparing', closed: false, attach() {} };
  const provider = new DesktopPnpmProvider({
    generation,
    profileDir: dir,
    spawn: fakeSpawn({ exitCode: 1, signal: null, cancelled: false }),
  });
  const operation = provider.installPlugin(
    { bundle: '@fixture/plugin', version: '1.2.3', source: 'npm' },
    { verifyNextGeneration: async () => true },
  );
  assert.equal((await operation.done).exitCode, 1);
  assert.equal(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'), 'package.json-before');
  assert.equal(
    fs.readdirSync(path.join(dir, '.recovery')).some((file) => file.endsWith('.failed')),
    true,
  );
  await provider.dispose();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('desktopProfiles 返回不可变快照，普通操作的相对 source 必须锚定 profile', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-profile-service-'));
  fs.mkdirSync(path.join(dir, 'plugins'));
  const generation = { id: 'test', profile: DISTRIBUTION_PROFILE, context: {}, stage: 'preparing', closed: false, attach() {} };
  const manager = { select: async () => generation };
  const profiles = new DesktopProfilesProvider({
    generation,
    manager,
    profiles: [{ name: DISTRIBUTION_PROFILE, selectable: true }],
  });
  assert.equal(Object.isFrozen(profiles.snapshot()), true);
  const provider = new DesktopPnpmProvider({ generation, profileDir: dir, spawn: fakeSpawn() });
  assert.throws(
    () => provider.runPlugin(['install'], { source: '../escape' }),
    (error: unknown) => error instanceof ForgeError && error.code === 'SERVICE_CWD',
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test('恢复事务只恢复受保护配置并阻止自动继续安装', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-recovery-'));
  for (const file of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'])
    fs.writeFileSync(path.join(dir, file), `${file}-before`);
  const recovery = path.join(dir, '.recovery');
  fs.mkdirSync(recovery);
  const snapshot = snapshotProfile(dir);
  fs.writeFileSync(path.join(dir, 'package.json'), 'after');
  fs.writeFileSync(path.join(recovery, 'install-test.json'), JSON.stringify({ snapshot }));
  const result = recoverTransactions(dir, recovery);
  assert.equal(result.manualRecovery, true);
  assert.equal(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'), 'package.json-before');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('package operation 取消后等待受管进程树退出', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-tree-'));
  const script = path.join(dir, 'child.js');
  fs.writeFileSync(script, 'setInterval(() => {}, 1000);');
  const operation = spawnTree(process.execPath, [script], { cwd: dir, env: process.env });
  await new Promise((resolve) => setTimeout(resolve, 40));
  await operation.cancel();
  const result = await operation.done;
  assert.equal(result.cancelled, true);
  fs.rmSync(dir, { recursive: true, force: true });
});
