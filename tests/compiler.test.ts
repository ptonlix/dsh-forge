/** compiler/schema 契约测试：使用 tests/fixtures，同时覆盖漂移、来源和构建授权失败。 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  parseDistribution,
  parseProfile,
  parseBundleManifest,
  projectDistributionIdentity,
  ForgeError,
} from '@dsh-forge/profile-toolchain/schema';
import { bundleDirectory, collectBundles, compileProfile, verifyProfile } from '@dsh-forge/profile-toolchain/compiler';
import { readYaml } from '@dsh-forge/profile-toolchain/core/yaml';
import { assertResolvedManifest } from './helpers.ts';

const root = path.resolve(__dirname, '..');
function tempFile(name: string, content: string): { dir: string; file: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-schema-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, content);
  return { dir, file };
}
function throwsCode(fn: () => unknown, code: string): void {
  assert.throws(fn, (error: unknown) => error instanceof ForgeError && error.code === code);
}

test('发行版与官方 profile 能生成确定性上游 profile 产物', () => {
  const compiled = compileProfile({ root });
  for (const file of ['package.json', 'cordis.patch.yml', 'pnpm-workspace.yaml', 'pnpm-lock.yaml'])
    assert.ok(fs.existsSync(path.join(compiled.profileDir, file)));
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(compiled.profileDir, 'package.json'), 'utf8')).dsh.profile.bundles,
    compiled.profile.bundles,
  );
  assertResolvedManifest(compiled.resolved);
  const input = compiled.resolved.input as { dependencyClosure?: unknown; sourceLockfileDigest?: unknown };
  assert.equal(input.dependencyClosure, undefined);
  assert.match(String(input.sourceLockfileDigest), /^sha256-[a-f0-9]{64}$/);
  assert.ok(fs.existsSync(path.join(compiled.profileDir, 'cordis.yml')));
  assert.match(fs.readFileSync(path.join(compiled.profileDir, 'pnpm-lock.yaml'), 'utf8'), /lockfileVersion:/);
  const profilePackage = JSON.parse(fs.readFileSync(path.join(compiled.profileDir, 'package.json'), 'utf8')) as {
    dependencies: Record<string, string>;
  };
  assert.equal(profilePackage.dependencies['dsh-better-sidebar'], '0.14.0');
  assert.ok(fs.existsSync(path.join(compiled.profileDir, 'node_modules', 'dsh-better-sidebar', 'package.json')));
  const workspace = fs.readFileSync(path.join(compiled.profileDir, 'pnpm-workspace.yaml'), 'utf8');
  assert.match(workspace, /node-pty: true/);
  assert.match(workspace, /"@google\/genai": false/);
  assert.match(workspace, /autoInstallPeers: true/);
  const lock = readYaml(path.join(compiled.profileDir, 'pnpm-lock.yaml')) as {
    packages: Record<string, { resolution?: { integrity?: string } }>;
  };
  const external = compiled.resolved.bundles.find((bundle) => bundle.name === 'dsh-better-sidebar') as {
    source?: { integrity?: string };
  } | undefined;
  assert.equal(external?.source?.integrity, lock.packages['dsh-better-sidebar@0.14.0']?.resolution?.integrity);
  assert.match(compiled.resolved.pnpmEvidence.materialized, /--offline --frozen-lockfile/);
  assert.equal(verifyProfile({ root }).verified, true);
});

test('schema 拒绝未知字段、顶层 plugins、非法 profile 名与未解析默认 profile', () => {
  let fixture = tempFile(
    'profile.yml',
    'schema: dsh-forge/profile@1\nname: INVALID_NAME\nruntime: {}\nbundles: []\nplugins: []\n',
  );
  throwsCode(() => parseProfile(fixture.file), 'SCHEMA_FORBIDDEN_FIELD');
  fs.rmSync(fixture.dir, { recursive: true, force: true });
  fixture = tempFile(
    'distribution.yml',
    'schema: dsh-forge/distribution@1\nid: valid-id\nname: X\npackageScope: "@valid"\napplicationId: ai.valid.desktop\nversion: 0.1.0\ndefaultProfile: missing\nplatforms:\n  - os: darwin\n    architectures: [arm64]\nunknown: yes\n',
  );
  throwsCode(() => parseDistribution(fixture.file), 'SCHEMA_UNKNOWN_FIELD');
  fs.rmSync(fixture.dir, { recursive: true, force: true });
});

test('仓库失败夹具可被解析器稳定拒绝', () => {
  throwsCode(
    () => parseDistribution(path.join(root, 'tests/fixtures/invalid/distribution-unknown-field.yml')),
    'SCHEMA_UNKNOWN_FIELD',
  );
  throwsCode(
    () => parseProfile(path.join(root, 'tests/fixtures/invalid/profile-plugins.yml')),
    'SCHEMA_FORBIDDEN_FIELD',
  );
});

test('正式 bundle 解析不隐式读取测试夹具', () => {
  assert.throws(
    () => bundleDirectory('@fixture/third-party', root),
    (error: unknown) => error instanceof ForgeError && error.code === 'BUNDLE_MISSING',
  );
  assert.equal(
    bundleDirectory('@fixture/third-party', root, { fixtureRoot: path.join(root, 'tests/fixtures') }),
    fs.realpathSync(path.join(root, 'tests/fixtures/bundles/third-party')),
  );
});

test('Git monorepo 依赖、许可证与 allowBuilds 事实被保留', () => {
  const manifest = parseBundleManifest(path.join(root, 'tests/fixtures/bundles/third-party'));
  assert.equal(manifest.license, 'MIT');
  assert.deepEqual(manifest.allowBuilds, ['@fixture/git-plugin']);
  assert.match(manifest.dependencies['@fixture/git-plugin']!, /#[0-9a-f]{40}&path:packages\/plugin$/);
});

test('bundle 缺少 patch 与浮动 Git 来源被拒绝', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-bundle-'));
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: '@fixture/no-patch', version: '1.0.0', license: 'MIT', dsh: { bundle: {} } }),
  );
  throwsCode(() => parseBundleManifest(dir), 'BUNDLE_PATCH_REQUIRED');
  fs.writeFileSync(path.join(dir, 'cordis.patch.yml'), '[]\n');
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({
      name: '@fixture/floating',
      version: '1.0.0',
      license: 'MIT',
      dsh: { bundle: { patch: './cordis.patch.yml' } },
      dependencies: { '@fixture/plugin': 'github:fixture/plugin#main' },
    }),
  );
  throwsCode(() => parseBundleManifest(dir), 'BUNDLE_SOURCE_FLOATING');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('profile 不得持久化 launcher 所有的 desktop layer', () => {
  const fixture = tempFile(
    'profile.yml',
    'schema: dsh-forge/profile@1\nname: desktop\nruntime:\n  dshPackageFamily: "@deepseek-ai/dsh"\n  dshVersion: 0.1.0-rc.8\n  cordisVersion: 4.0.1\n  desktopProtocol: 1\n  electronVersion: 43.4.0\n  nodeEngine: ">=20.0.0"\nbundles: ["@dsh-forge/desktop-layer"]\n',
  );
  throwsCode(() => parseProfile(fixture.file), 'DESKTOP_LAYER_OWNERSHIP');
  fs.rmSync(fixture.dir, { recursive: true, force: true });
});

test('发行版身份投影不可变，并校验更新信任根输入', () => {
  const distribution = parseDistribution(path.join(root, 'distribution.yml'), {
    profilesRoot: path.join(root, 'profiles'),
  });
  const identity = projectDistributionIdentity(distribution);
  assert.equal(identity.applicationId, 'ai.dshforge.desktop');
  assert.equal(identity.packageScope, '@dsh-forge');
  assert.equal(Object.isFrozen(identity), true);
  const invalid = tempFile(
    'distribution.yml',
    'schema: dsh-forge/distribution@1\nid: test\nname: Test\npackageScope: "@test"\napplicationId: ai.test.desktop\nversion: 1.0.0\ndefaultProfile: dsh-forge-official\nplatforms:\n  - os: darwin\n    architectures: [arm64]\nupdates:\n  enabled: true\n',
  );
  throwsCode(() => parseDistribution(invalid.file), 'SCHEMA_REQUIRED');
  fs.rmSync(invalid.dir, { recursive: true, force: true });
});

test('解析器拒绝非法 profile 名', () => {
  const invalid = tempFile(
    'profile.yml',
    'schema: dsh-forge/profile@1\nname: INVALID\nruntime:\n  dshPackageFamily: "@deepseek-ai/dsh"\n  dshVersion: 0.1.0-rc.8\n  cordisVersion: 4.0.1\n  desktopProtocol: 1\n  electronVersion: 43.4.0\n  nodeEngine: ">=20.0.0"\nbundles: ["@fixture/dsh-base"]\n',
  );
  throwsCode(() => parseProfile(invalid.file), 'SCHEMA_IDENTIFIER');
  fs.rmSync(invalid.dir, { recursive: true, force: true });
});

test('依赖闭包要求显式 allowBuilds，并拒绝重复 peer', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-bundles-'));
  const fixtureRoot = path.join(temp, 'tests', 'fixtures');
  const bundles = path.join(fixtureRoot, 'bundles');
  fs.mkdirSync(bundles, { recursive: true });
  fs.writeFileSync(path.join(temp, 'pnpm-workspace.yaml'), 'allowBuilds: {}\n');
  const writeBundle = (name: string, peer: string | null, script: boolean): void => {
    const directory = path.join(bundles, name);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'cordis.patch.yml'), '[]\n');
    fs.writeFileSync(
      path.join(directory, 'package.json'),
      JSON.stringify({
        name: `@fixture/${name}`,
        version: '1.0.0',
        license: 'MIT',
        dsh: { bundle: { patch: './cordis.patch.yml' } },
        peerDependencies: peer ? { '@fixture/peer': peer } : {},
        peerDependenciesMeta: peer ? { '@fixture/peer': { optional: true } } : {},
        scripts: script ? { install: 'node build.js' } : {},
      }),
    );
  };
  writeBundle('a', null, true);
  const profile = { bundles: ['@fixture/a'], runtime: { cordisVersion: '4.0.1' } };
  assert.throws(
    () => collectBundles(profile, temp, { fixtureRoot }),
    (error: unknown) => error instanceof ForgeError && error.code === 'ALLOW_BUILDS_REQUIRED',
  );
  fs.writeFileSync(path.join(temp, 'pnpm-workspace.yaml'), "allowBuilds:\n  '@fixture/a': true\n");
  assert.equal(collectBundles(profile, temp, { fixtureRoot }).allowBuilds.includes('@fixture/a'), true);
  writeBundle('a', '^1.0.0', true);
  writeBundle('b', '^2.0.0', false);
  assert.throws(
    () => collectBundles({ ...profile, bundles: ['@fixture/a', '@fixture/b'] }, temp, { fixtureRoot }),
    (error: unknown) => error instanceof ForgeError && error.code === 'PEER_DUPLICATE',
  );
  fs.rmSync(temp, { recursive: true, force: true });
});

test('profile verify 能检测锁文件漂移', () => {
  const artifactsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-lock-drift-'));
  const compiled = compileProfile({ root, artifactsDir });
  const lockFile = path.join(compiled.profileDir, 'pnpm-lock.yaml');
  const original = fs.readFileSync(lockFile, 'utf8');
  try {
    fs.writeFileSync(lockFile, `${original}# drift\n`);
    assert.throws(
      () => verifyProfile({ root, artifactsDir }),
      (error: unknown) => error instanceof ForgeError && error.code === 'VERIFY_LOCK_DRIFT',
    );
  } finally {
    fs.rmSync(artifactsDir, { recursive: true, force: true });
  }
});
