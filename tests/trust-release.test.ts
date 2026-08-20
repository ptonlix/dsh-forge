/** trust/release 测试覆盖 catalog 审计、签名摘要、native 检查和更新失败隔离。 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

import {
  assertNoStartupInstall,
  loadStaticCatalog,
  installationConfirmation,
  NON_ISOLATION_NOTICE,
  requiresReaudit,
  verifyCatalog,
} from '@dsh-forge/profile-toolchain/trust';
import {
  createChannelMetadata,
  generateEvidence,
  inspectPackage,
  releaseGate,
  UpdateCoordinator,
  validateRuntimeTargets,
  verifyChannelMetadata,
  verifyEvidence,
} from '@dsh-forge/profile-toolchain/release';
import { ForgeError } from '@dsh-forge/profile-toolchain/core/errors';
import type { RuntimeManifest } from '@dsh-forge/profile-toolchain/types';

const root = path.resolve(__dirname, '..');

test('catalog 是静态审计快照且明确 trusted-in-process 非隔离语义', () => {
  const catalog = loadStaticCatalog(path.join(root, 'catalog/catalog.yml'));
  const firstEntry = catalog.entries[0]!;
  assert.equal(firstEntry.executionMode, 'trusted-in-process');
  assert.match(NON_ISOLATION_NOTICE, /不构成/);
  assert.throws(
    () => installationConfirmation(firstEntry, 'official'),
    (error: unknown) => error instanceof ForgeError && error.code === 'CATALOG_CONFIRMATION_REQUIRED',
  );
  assert.equal(installationConfirmation(firstEntry, 'official', true).userConfirmed, true);
  assert.throws(
    () => assertNoStartupInstall(catalog, { type: 'install' }),
    (error: unknown) => error instanceof ForgeError && error.code === 'CATALOG_STARTUP_INSTALL',
  );
  const changed = JSON.parse(JSON.stringify(catalog));
  changed.entries[0].capabilities.push('newCapability');
  assert.equal(requiresReaudit(firstEntry, changed.entries[0]!), true);
  assert.throws(
    () => verifyCatalog(changed, { now: Date.parse('2027-12-31') }),
    (error: unknown) => error instanceof ForgeError && error.code === 'CATALOG_AUDIT_EXPIRED',
  );
});

test('更新拒绝错误信任根、摘要与降级', () => {
  const pair = crypto.generateKeyPairSync('ed25519');
  const artifact = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-update-')), 'update.zip');
  fs.writeFileSync(artifact, 'update');
  const trustRoot = { id: 'root', publicKey: pair.publicKey };
  const base = createChannelMetadata({
    distributionId: 'd',
    version: '2.0.0',
    platform: 'darwin',
    architecture: 'arm64',
    artifactFile: artifact,
    trustRoot,
    privateKey: pair.privateKey,
  });
  assert.equal(
    verifyChannelMetadata(
      { ...base, downloadedSha256: base.artifact.sha256 },
      { version: '1.0.0', distributionId: 'd', platform: 'darwin', architecture: 'arm64' },
      trustRoot,
    ),
    true,
  );
  assert.throws(
    () =>
      verifyChannelMetadata(
        { ...base, version: '1.0.0', downloadedSha256: base.artifact.sha256 },
        { version: '1.0.0', distributionId: 'd', platform: 'darwin', architecture: 'arm64' },
        trustRoot,
      ),
    (error: unknown) => error instanceof ForgeError && error.code === 'UPDATE_SIGNATURE',
  );
  assert.throws(
    () =>
      verifyChannelMetadata(
        { ...base, downloadedSha256: base.artifact.sha256 },
        { version: '2.0.0', distributionId: 'd', platform: 'darwin', architecture: 'arm64' },
        trustRoot,
      ),
    (error: unknown) => error instanceof ForgeError && error.code === 'UPDATE_DOWNGRADE',
  );
  fs.rmSync(path.dirname(artifact), { recursive: true, force: true });
});

test('运行时闭包检查原生文件，生产发布拒绝未签名 smoke', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-package-'));
  fs.mkdirSync(path.join(dir, 'profile'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{}');
  fs.writeFileSync(path.join(dir, 'profile/package.json'), '{}');
  const manifest: RuntimeManifest = {
    packageRoot: dir,
    targets: [
      {
        os: 'darwin',
        architectures: ['arm64'],
        nativeFiles: [{ path: 'app.asar.unpacked/native.node', executable: true }],
      },
    ],
    signing: { signed: false },
  };
  const inspection = inspectPackage(manifest, { requireSignature: true });
  assert.equal(inspection.valid, false);
  assert.equal(
    inspection.failures.some((failure) => failure.code === 'NATIVE_FILE_MISSING'),
    true,
  );
  assert.throws(
    () =>
      releaseGate({
        profileVerified: true,
        configDump: { healthy: true },
        packageInspection: { valid: true },
        catalogVerified: { valid: true },
        manifest,
        updateConfigured: true,
        packageSmoke: null,
        evidence: null,
      }),
    (error: unknown) => error instanceof ForgeError && error.code === 'RELEASE_GATE',
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test('产物证据要求 SBOM 与许可证通知同时存在', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-evidence-'));
  const app = path.join(dir, 'app');
  fs.mkdirSync(app);
  fs.writeFileSync(path.join(app, 'package.json'), '{}');
  const evidence = generateEvidence({ packageRoot: app, targets: [], signing: { signed: false } }, dir);
  const sbom = path.join(dir, 'sbom.input.json');
  const notices = path.join(dir, 'THIRD-PARTY-NOTICES.txt');
  fs.writeFileSync(sbom, '{}');
  fs.writeFileSync(notices, 'MIT');
  assert.equal(verifyEvidence(evidence, { sbomFile: sbom, licenseFile: notices }).valid, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('平台目标同时覆盖 macOS 与 Windows，并拒绝非法 native 相对路径', () => {
  assert.equal(
    validateRuntimeTargets([
      { os: 'darwin', architectures: ['arm64', 'x64'] },
      { os: 'win32', architectures: ['x64'] },
    ]),
    true,
  );
  assert.throws(
    () => validateRuntimeTargets([{ os: 'win32', architectures: ['x64'], nativeFiles: [{ path: '../bad.node' }] }]),
    (error: unknown) => error instanceof ForgeError && error.code === 'RUNTIME_TARGETS',
  );
});

test('更新暂存会先验证签名，失败文件隔离且不会 dispose 当前 generation', async () => {
  const pair = crypto.generateKeyPairSync('ed25519');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-stage-'));
  const input = path.join(dir, 'input.zip');
  fs.writeFileSync(input, 'valid');
  const trustRoot = { id: 'root', publicKey: pair.publicKey };
  const metadata = createChannelMetadata({
    distributionId: 'd',
    version: '2.0.0',
    platform: 'darwin',
    architecture: 'arm64',
    artifactFile: input,
    trustRoot,
    privateKey: pair.privateKey,
  });
  let disposed = false;
  const coordinator = new UpdateCoordinator({
    stageDir: path.join(dir, 'stage'),
    trustRoot,
    disposeGeneration: async () => {
      disposed = true;
    },
    installer: async () => ({ installed: true }),
  });
  const result = await coordinator.apply({
    metadata,
    installed: { version: '1.0.0', distributionId: 'd', platform: 'darwin', architecture: 'arm64' },
    download: async () => fs.readFileSync(input),
    userConfirmed: true,
  });
  assert.equal((result as { installed: boolean }).installed, true);
  assert.equal(disposed, true);
  disposed = false;
  await assert.rejects(
    coordinator.apply({
      metadata: { ...metadata, version: '3.0.0' },
      installed: { version: '1.0.0', distributionId: 'd', platform: 'darwin', architecture: 'arm64' },
      download: async () => Buffer.from('bad'),
      userConfirmed: true,
    }),
    (error: unknown) => error instanceof ForgeError && error.code === 'UPDATE_INTEGRITY',
  );
  assert.equal(disposed, false);
  assert.equal(
    fs.readdirSync(path.join(dir, 'stage')).some((name) => name.endsWith('.rejected')),
    true,
  );
  fs.rmSync(dir, { recursive: true, force: true });
});
