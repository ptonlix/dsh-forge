/** trust/release 测试覆盖 catalog 审计、签名摘要、native 检查和更新失败隔离。 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { createPackage } from '@electron/asar';

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
  runtimePaths,
  sha256,
  UpdateCoordinator,
  validateRuntimeTargets,
  verifyChannelMetadata,
  verifyEvidence,
} from '@dsh-forge/profile-toolchain/release';
import { ForgeError } from '@dsh-forge/profile-toolchain/core/errors';
import type { RuntimeManifest } from '@dsh-forge/profile-toolchain/types';

const root = path.resolve(__dirname, '..');

function passingSmoke(os: 'darwin' | 'win32', architecture: 'arm64' | 'x64') {
  return {
    healthy: true,
    nativeEvidence: {
      schema: 'dsh-forge/native-verification@1',
      target: { os, architecture },
      electron: '43.4.0',
      electronAbi: '148',
      runtimeManifestSha256: '0'.repeat(64),
      nativeFiles: [],
      result: 'passed',
      verifiedAt: '2026-08-21T00:00:00.000Z',
    },
  };
}

test('catalog 是静态审计快照且明确 trusted-in-process 非隔离语义', () => {
  const catalog = loadStaticCatalog(path.join(root, 'catalog/catalog.yml'));
  const firstEntry = catalog.entries[0]!;
  assert.equal(firstEntry.executionMode, 'trusted-in-process');
  assert.match(NON_ISOLATION_NOTICE, /不构成/);
  assert.throws(
    () => installationConfirmation(firstEntry, 'dsh-forge-official'),
    (error: unknown) => error instanceof ForgeError && error.code === 'CATALOG_CONFIRMATION_REQUIRED',
  );
  assert.equal(installationConfirmation(firstEntry, 'dsh-forge-official', true).confirmation.userConfirmed, true);
  assert.throws(
    () => assertNoStartupInstall(catalog, { type: 'install' }),
    (error: unknown) => error instanceof ForgeError && error.code === 'CATALOG_STARTUP_INSTALL',
  );
  const changed = JSON.parse(JSON.stringify(catalog));
  changed.entries[0].capabilities.push('newCapability');
  assert.equal(requiresReaudit(firstEntry, changed.entries[0]!), true);
  const sidebar = catalog.entries.find((entry) => entry.packageName === 'dsh-better-sidebar');
  assert.deepEqual(sidebar?.dependencies, [
    '@codemirror/commands',
    '@codemirror/lang-cpp',
    '@codemirror/lang-css',
    '@codemirror/lang-go',
    '@codemirror/lang-html',
    '@codemirror/lang-java',
    '@codemirror/lang-javascript',
    '@codemirror/lang-json',
    '@codemirror/lang-markdown',
    '@codemirror/lang-php',
    '@codemirror/lang-python',
    '@codemirror/lang-rust',
    '@codemirror/lang-sql',
    '@codemirror/lang-vue',
    '@codemirror/lang-xml',
    '@codemirror/lang-yaml',
    '@codemirror/language',
    '@codemirror/legacy-modes',
    '@codemirror/search',
    '@codemirror/state',
    '@codemirror/view',
    '@lezer/highlight',
    'clsx',
    'dompurify',
    'mermaid',
    'node-pty',
    'react-icons',
    'rxjs',
    'schemastery',
    'ws',
  ]);
  const dreamSkin = catalog.entries.find((entry) => entry.packageName === 'dsh-dream-skin');
  assert.deepEqual(dreamSkin?.dependencies, []);
  assert.deepEqual(dreamSkin?.scripts, []);
  assert.deepEqual(dreamSkin?.capabilities, [
    'browser-storage',
    'user-selected-file-read',
    'dsh-home-file-write',
    'loopback-http-route',
    'theme-registration',
  ]);
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

test('运行时闭包检查原生文件，包检查仍可单独要求签名', () => {
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
        nativeFiles: [],
      },
    ],
    nativeAddons: [{ root: 'app.asar.unpacked', path: 'native.node', executable: true, sha256: '0'.repeat(64) }],
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
        packageInspections: [{ valid: true }],
        catalogVerified: { valid: true },
        manifest,
        packageSmokes: [],
        evidence: null,
      }),
    (error: unknown) => error instanceof ForgeError && error.code === 'RELEASE_GATE',
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test('runtime manifest 必须完整记录三个受限资源根中的 native 文件摘要', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-native-manifest-'));
  const native = path.join(dir, 'app.asar.unpacked', 'native.node');
  fs.mkdirSync(path.dirname(native), { recursive: true });
  fs.mkdirSync(path.join(dir, 'profile'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{}');
  fs.writeFileSync(path.join(dir, 'profile', 'package.json'), '{}');
  fs.writeFileSync(native, 'native-addon');
  const manifest: RuntimeManifest = {
    packageRoot: dir,
    targets: [{ os: 'win32', architectures: ['x64'] }],
    declaredTargets: [{ os: 'win32', architectures: ['x64'] }],
    nativeAddons: [{ root: 'app.asar.unpacked', path: 'native.node', executable: false, sha256: sha256(native) }],
    signing: { signed: false },
  };
  assert.equal(inspectPackage(manifest).valid, true);
  const drift = {
    ...manifest,
    nativeAddons: [{ ...manifest.nativeAddons![0]!, sha256: 'f'.repeat(64) }],
  };
  assert.equal(
    inspectPackage(drift).failures.some((failure) => failure.code === 'NATIVE_FILE_DIGEST_MISMATCH'),
    true,
  );
  assert.equal(
    inspectPackage({ ...manifest, nativeAddons: [] }).failures.some((failure) => failure.code === 'NATIVE_FILE_UNDECLARED'),
    true,
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test('非当前平台的预编译 native 文件保留在清单中但不参与当前架构校验', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-native-platform-'));
  const native = path.join(dir, 'app.asar.unpacked', 'index.win32-x64-msvc.node');
  fs.mkdirSync(path.dirname(native), { recursive: true });
  fs.mkdirSync(path.join(dir, 'profile'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{}');
  fs.writeFileSync(path.join(dir, 'profile', 'package.json'), '{}');
  fs.writeFileSync(native, 'windows-native-addon');
  const manifest: RuntimeManifest = {
    packageRoot: dir,
    targets: [{ os: 'darwin', architectures: ['arm64'] }],
    declaredTargets: [{ os: 'darwin', architectures: ['arm64'] }],
    nativeAddons: [{ root: 'app.asar.unpacked', path: 'index.win32-x64-msvc.node', executable: false, sha256: sha256(native) }],
    signing: { signed: false },
  };
  assert.equal(inspectPackage(manifest).valid, true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('macOS inspect 跳过 Linux musl、FreeBSD 与 OpenBSD 的 optional native 预构建', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-native-optional-platform-'));
  const paths = [
    'profile/node_modules/@img/sharp-linuxmusl-arm64/lib/sharp-linuxmusl-arm64.node',
    'profile/node_modules/@koromix/koffi-freebsd-x64/freebsd_x64/koffi.node',
    'profile/node_modules/@koromix/koffi-openbsd-x64/openbsd_x64/koffi.node',
  ];
  for (const relative of paths) {
    const file = path.join(dir, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'foreign-native-addon');
  }
  fs.writeFileSync(path.join(dir, 'package.json'), '{}');
  fs.mkdirSync(path.join(dir, 'profile'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'profile', 'package.json'), '{}');
  const manifest: RuntimeManifest = {
    packageRoot: dir,
    targets: [{ os: 'darwin', architectures: ['arm64', 'x64'] }],
    declaredTargets: [{ os: 'darwin', architectures: ['arm64', 'x64'] }],
    nativeAddons: paths.map((relative) => ({
      root: 'dsh-forge/profile' as const,
      path: relative.replace('profile/', ''),
      executable: false,
      sha256: sha256(path.join(dir, relative)),
    })),
    signing: { signed: false },
  };
  assert.deepEqual(inspectPackage(manifest).failures, []);
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

test('发布门禁拒绝缺少声明目标 native evidence 的单平台 smoke', () => {
  const manifest: RuntimeManifest = {
    packageRoot: null,
    targets: [{ os: 'darwin', architectures: ['arm64'] }],
    declaredTargets: [
      { os: 'darwin', architectures: ['arm64', 'x64'] },
      { os: 'win32', architectures: ['x64'] },
    ],
    signing: { signed: false },
  };
  assert.throws(
    () =>
      releaseGate({
        profileVerified: true,
        configDump: { healthy: true },
        packageInspections: [{ valid: true }],
        catalogVerified: { valid: true },
        manifest,
        packageSmokes: [passingSmoke('darwin', 'arm64')],
        evidence: { valid: true },
      }),
    /声明目标缺少 native evidence: darwin-x64.*win32-x64/,
  );
});

test('发布门禁接受覆盖全部声明目标的独立 native evidence', () => {
  const manifest: RuntimeManifest = {
    packageRoot: null,
    targets: [{ os: 'darwin', architectures: ['arm64'] }],
    declaredTargets: [
      { os: 'darwin', architectures: ['arm64', 'x64'] },
      { os: 'win32', architectures: ['x64'] },
    ],
    signing: { signed: false },
  };
  assert.deepEqual(
    releaseGate({
      profileVerified: true,
      configDump: { healthy: true },
      packageInspections: [{ valid: true }],
      catalogVerified: { valid: true },
      manifest,
      packageSmokes: [passingSmoke('darwin', 'arm64'), passingSmoke('darwin', 'x64'), passingSmoke('win32', 'x64')],
      evidence: { valid: true },
    }),
    { publishable: true },
  );
});

test('Windows 可执行文件使用同级 resources 作为 runtime 根', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-windows-runtime-'));
  const executable = path.join(root, 'DSH Forge.exe');
  fs.writeFileSync(executable, '');
  const paths = runtimePaths(executable, 'win32');
  const directoryPaths = runtimePaths(root, 'win32');
  assert.equal(paths?.application, root);
  assert.equal(directoryPaths?.application, root);
  assert.equal(paths?.resources, path.join(root, 'resources'));
  assert.equal(directoryPaths?.resources, path.join(root, 'resources'));
  assert.equal(paths?.profile, path.join(root, 'resources', 'dsh-forge', 'profile'));
  assert.equal(paths?.runtime, path.join(root, 'resources', 'dsh-forge', 'runtime', 'node_modules'));
  fs.rmSync(root, { recursive: true, force: true });
});

test('package inspect 归一化 ASAR 的 Windows 路径分隔符', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-asar-paths-'));
  const source = path.join(root, 'asar-source');
  const archive = path.join(root, 'resources', 'app.asar');
  const entries = [
    'dist\\apps\\desktop\\electron-main.js',
    'dist\\apps\\desktop\\preload.js',
    'packages\\desktop-services-local\\dist\\index.js',
    'packages\\desktop-services\\dist\\index.js',
  ];
  try {
    fs.mkdirSync(source, { recursive: true });
    for (const entry of entries) fs.writeFileSync(path.join(source, entry), 'entry');
    await createPackage(source, archive);
    const inspection = inspectPackage({
      packageRoot: root,
      targets: [{ os: 'darwin', architectures: ['arm64'] }],
      signing: { signed: false },
    });
    assert.equal(inspection.failures.some((failure) => failure.code === 'ASAR_RUNTIME_ENTRY_MISSING'), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
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
    () =>
      validateRuntimeTargets([
        {
          os: 'win32',
          architectures: ['x64'],
          nativeFiles: [{ root: 'app.asar.unpacked', path: '../bad.node', executable: false, sha256: '0'.repeat(64) }],
        },
      ]),
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
