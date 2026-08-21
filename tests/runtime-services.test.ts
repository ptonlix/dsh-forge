/** 桌面服务生命周期测试：generation、lease、取消、WAL 与来源校验。 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Readable } from 'node:stream';

import { GenerationManager, Generation } from '../apps/desktop/runtime/generation.ts';
import { ProfileStateStore } from '../apps/desktop/runtime/state-store.ts';
import type { DesktopProfileSummary } from '@dsh-forge/desktop-services';
import { ForgeError } from '@dsh-forge/profile-toolchain/core/errors';
import type { CatalogEntry } from '@dsh-forge/profile-toolchain/schema';
import { DesktopPnpmProvider, assertExactSemVer } from '../packages/desktop-services-local/src/packages.ts';
import { DesktopProfilesProvider } from '../packages/desktop-services-local/src/profiles.ts';
import { recoverTransactions, snapshotProfile } from '../packages/desktop-services-local/src/recovery.ts';
import { spawnTree } from '../packages/desktop-services-local/src/process-tree.ts';
import { createDesktopHostCapability } from '../packages/desktop-services-local/src/launcher.ts';
import type { DesktopHostCapability, GenerationLike, ProcessOperation } from '../packages/desktop-services-local/src/types.ts';

const DISTRIBUTION_PROFILE = 'dsh-forge-official';

function makeManager(
  hooks: ConstructorParameters<typeof GenerationManager>[0]['hooks'] = {},
  profiles: ConstructorParameters<typeof GenerationManager>[0]['profiles'] = [
    { name: DISTRIBUTION_PROFILE, default: true, selectable: true },
  ],
) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-state-'));
  return {
    dir,
    manager: new GenerationManager({
      stateStore: new ProfileStateStore(dir),
      profiles,
      hooks,
      healthDeadlineMs: 30,
    }),
  };
}

function fakeSpawn(
  result: { exitCode: number | null; signal: NodeJS.Signals | null; cancelled: boolean } = {
    exitCode: 0,
    signal: null,
    cancelled: false,
  },
): () => ProcessOperation {
  return () => ({
    stdout: Readable.from([]),
    stderr: Readable.from([]),
    done: Promise.resolve(result),
    cancel: () => Promise.resolve(),
  });
}

function generation(): GenerationLike & { closed: boolean } {
  return { id: 'test-generation', profile: DISTRIBUTION_PROFILE, stage: 'committed', closed: false };
}

function catalogEntry(): CatalogEntry {
  return {
    schema: 'dsh-forge/catalog@1',
    id: 'fixture-plugin',
    tier: 'L1',
    packageName: '@fixture/plugin',
    version: '1.2.3-rc.1+build.9',
    source: {
      kind: 'npm',
      package: '@fixture/plugin',
      registry: 'https://registry.example.test',
      tarball: 'https://registry.example.test/@fixture/plugin/-/plugin-1.2.3-rc.1.tgz',
    },
    integrity: 'sha512-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    license: 'MIT',
    maintainer: 'Fixture',
    dependencies: [],
    scripts: [],
    capabilities: [],
    verifiedOn: ['darwin-arm64'],
    verifiedAt: '2026-08-20',
    executionMode: 'trusted-in-process',
    hostSupport: ['desktop-protocol-1'],
    pluginRequest: [],
    grant: 'required',
    audit: 'reviewed',
    enforcement: 'unavailable',
  };
}

function profileSummary(): DesktopProfileSummary {
  return {
    name: DISTRIBUTION_PROFILE,
    exists: true,
    bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'],
    webCompatible: true,
    default: true,
    selectable: true,
    error: null,
    reason: null,
  };
}

function capability(
  directory: string,
  current = generation(),
  extra: Partial<DesktopHostCapability> = {},
): DesktopHostCapability {
  return createDesktopHostCapability({
    generation: current,
    profileDir: directory,
    profiles: [profileSummary()],
    manager: { select: async () => current },
    catalog: [catalogEntry()],
    reconcile: async () => {},
    verifyNextGeneration: async () => true,
    spawn: fakeSpawn(),
    ...extra,
  });
}

test('同目标选择合并，不同目标被拒绝，成功后提交 last-known-good', async () => {
  let resume: () => void = () => {};
  const { dir, manager } = makeManager(
    {
      prepare: () => new Promise<void>((resolve) => { resume = resolve; }),
      hostReady: async () => {},
      webReady: async () => {},
      windowReady: async () => {},
      rendererReady: async () => {},
      interactionReady: async () => {},
    },
    [
      { name: DISTRIBUTION_PROFILE, default: true, selectable: true },
      { name: 'other-profile', selectable: true },
    ],
  );
  const first = manager.select(DISTRIBUTION_PROFILE);
  assert.equal(first, manager.select(DISTRIBUTION_PROFILE));
  assert.throws(
    () => manager.select('other-profile'),
    (error: unknown) => error instanceof ForgeError && error.code === 'PROFILE_SELECTION_BUSY',
  );
  resume();
  await first;
  assert.equal(manager.snapshot.lastKnownGood, DISTRIBUTION_PROFILE);
  await manager.dispose();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('过期 generation 的 profile service 失败且不影响后续 generation', () => {
  const current = generation();
  const service = new DesktopProfilesProvider(current, { select: async () => current }, [profileSummary()]);
  assert.equal(Object.isFrozen(service.snapshot()), true);
  current.closed = true;
  assert.throws(
    () => service.list(),
    (error: unknown) => error instanceof ForgeError && error.code === 'GENERATION_CLOSED',
  );
});

test('package lease 覆盖进程完成后的 finalize，并在 dispose 时取消', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-lease-'));
  let settle: (result: { exitCode: number; signal: null; cancelled: boolean }) => void = () => {};
  const active: ProcessOperation = {
    stdout: Readable.from([]), stderr: Readable.from([]),
    done: new Promise((resolve) => { settle = resolve; }),
    cancel: async () => settle({ exitCode: 0, signal: null, cancelled: true }),
  };
  let finalize: () => void = () => {};
  const provider = new DesktopPnpmProvider(capability(directory, generation(), {
    spawn: () => active,
    reconcile: () => new Promise<void>((resolve) => { finalize = resolve; }),
  }));
  const operation = provider.run({ kind: 'reconcile' });
  settle({ exitCode: 0, signal: null, cancelled: false });
  await Promise.resolve();
  assert.throws(
    () => provider.run({ kind: 'inspect', query: 'list' }),
    (error: unknown) => error instanceof ForgeError && error.code === 'PACKAGE_BUSY',
  );
  finalize();
  await operation.done;
  await provider.dispose();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('严格 SemVer 支持 prerelease/build 并拒绝 range、tag 与 alias', () => {
  assert.doesNotThrow(() => assertExactSemVer('1.2.3-rc.1+build.9'));
  for (const value of ['^1.2.3', 'latest', 'workspace:*', 'file:../plugin']) {
    assert.throws(
      () => assertExactSemVer(value),
      (error: unknown) => error instanceof ForgeError && error.code === 'PACKAGE_VERSION',
    );
  }
});

test('安装 confirmation、lockfile 事实与 receipt 在同一事务结算', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-install-'));
  for (const file of ['package.json', 'pnpm-workspace.yaml'])
    fs.writeFileSync(path.join(directory, file), `${file}-before`);
  const entry = catalogEntry();
  const lockfile = [
    'lockfileVersion: \'9.0\'',
    'packages:',
    '  \'@fixture/plugin@1.2.3-rc.1+build.9\':',
    '    resolution:',
    '      tarball: https://registry.example.test/@fixture/plugin/-/plugin-1.2.3-rc.1.tgz',
    '      integrity: sha512-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(directory, 'pnpm-lock.yaml'), lockfile);
  const request = (await import('@dsh-forge/profile-toolchain/trust')).installationConfirmation(entry, DISTRIBUTION_PROFILE, true);
  const provider = new DesktopPnpmProvider(capability(directory));
  const result = await provider.install(request).done;
  assert.equal(result.exitCode, 0);
  assert.equal(fs.readdirSync(path.join(directory, '.recovery')).some((file) => file.endsWith('.receipt')), true);
  await provider.dispose();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('伪造确认、来源漂移、非零退出和健康失败不会提交 receipt', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-install-failure-'));
  for (const file of ['package.json', 'pnpm-workspace.yaml'])
    fs.writeFileSync(path.join(directory, file), `${file}-before`);
  const validLockfile = [
    'lockfileVersion: \'9.0\'',
    'packages:',
    '  \'@fixture/plugin@1.2.3-rc.1+build.9\':',
    '    resolution:',
    '      tarball: https://registry.example.test/@fixture/plugin/-/plugin-1.2.3-rc.1.tgz',
    '      integrity: sha512-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(directory, 'pnpm-lock.yaml'), validLockfile);
  const request = (await import('@dsh-forge/profile-toolchain/trust')).installationConfirmation(
    catalogEntry(),
    DISTRIBUTION_PROFILE,
    true,
  );
  const forged = { ...request, source: { ...request.source } };
  const provider = new DesktopPnpmProvider(capability(directory));
  assert.throws(
    () => provider.install(forged as never),
    (error: unknown) => error instanceof ForgeError && error.code === 'CATALOG_CONFIRMATION_REQUIRED',
  );
  await provider.dispose();

  fs.writeFileSync(
    path.join(directory, 'pnpm-lock.yaml'),
    validLockfile.replace('plugin-1.2.3-rc.1.tgz', 'drift.tgz'),
  );
  const drift = new DesktopPnpmProvider(capability(directory));
  await assert.rejects(
    drift.install(request).done,
    (error: unknown) => error instanceof ForgeError && error.code === 'INSTALL_MANUAL_RECOVERY',
  );
  await drift.dispose();

  fs.writeFileSync(path.join(directory, 'pnpm-lock.yaml'), validLockfile);
  const nonzero = new DesktopPnpmProvider(
    capability(directory, generation(), { spawn: fakeSpawn({ exitCode: 1, signal: null, cancelled: false }) }),
  );
  assert.equal((await nonzero.install(request).done).exitCode, 1);
  assert.equal(fs.readdirSync(path.join(directory, '.recovery')).some((file) => file.endsWith('.failed')), true);
  await nonzero.dispose();

  const unhealthy = new DesktopPnpmProvider(
    capability(directory, generation(), { verifyNextGeneration: async () => false }),
  );
  await assert.rejects(
    unhealthy.install(request).done,
    (error: unknown) => error instanceof ForgeError && error.code === 'INSTALL_MANUAL_RECOVERY',
  );
  await unhealthy.dispose();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('未知 lockfile 与恢复 WAL 均进入人工恢复，而非报告安装成功', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-recovery-'));
  for (const file of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']) fs.writeFileSync(path.join(directory, file), `${file}-before`);
  const request = (await import('@dsh-forge/profile-toolchain/trust')).installationConfirmation(catalogEntry(), DISTRIBUTION_PROFILE, true);
  const provider = new DesktopPnpmProvider(capability(directory));
  await assert.rejects(provider.install(request).done, (error: unknown) => error instanceof ForgeError && error.code === 'INSTALL_MANUAL_RECOVERY');
  const snapshot = snapshotProfile(directory);
  fs.writeFileSync(path.join(directory, 'package.json'), 'changed');
  fs.writeFileSync(path.join(directory, '.recovery', 'install-interrupted.json'), JSON.stringify({ schema: 'dsh-forge/desktop-install-wal@1', snapshot }));
  const result = recoverTransactions(directory, path.join(directory, '.recovery'));
  assert.equal(result.manualRecovery, true);
  assert.equal(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'), 'package.json-before');
  fs.rmSync(directory, { recursive: true, force: true });
});

test('取消的受管进程树在 operation 结算前退出', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-tree-'));
  const script = path.join(directory, 'child.js');
  fs.writeFileSync(script, 'setInterval(() => {}, 1000);');
  const operation = spawnTree(process.execPath, [script], { cwd: directory, env: process.env });
  await new Promise((resolve) => setTimeout(resolve, 40));
  await operation.cancel();
  assert.equal((await operation.done).cancelled, true);
  fs.rmSync(directory, { recursive: true, force: true });
});

test('关闭 generation 的管理器仍拒绝旧 service', async () => {
  const { dir, manager } = makeManager();
  const old = new Generation(manager, DISTRIBUTION_PROFILE);
  await old.dispose();
  assert.throws(() => old.assertOpen(), (error: unknown) => error instanceof ForgeError && error.code === 'GENERATION_CLOSED');
  fs.rmSync(dir, { recursive: true, force: true });
});
