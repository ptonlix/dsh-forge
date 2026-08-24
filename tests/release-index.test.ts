import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildReleaseIndex } from '../scripts/release-index.ts';

function writeTarget(root: string, target: string, digest: string): void {
  const directory = path.join(root, target);
  fs.mkdirSync(directory, { recursive: true });
  const universal = target === 'darwin-universal';
  const runtime = {
    inputDigest: digest,
    distribution: { id: 'dsh-forge-official', version: '0.1.0' },
    profile: { name: 'dsh-forge-official' },
    targets: [{ os: universal ? 'darwin' : target.split('-')[0], architectures: universal ? ['arm64', 'x64'] : ['x64'] }],
  };
  fs.writeFileSync(path.join(directory, 'runtime-manifest.json'), JSON.stringify(runtime));
  fs.writeFileSync(path.join(directory, 'package-evidence.json'), JSON.stringify({ manifest: runtime }));
  fs.writeFileSync(path.join(directory, `native-verification.${target}.json`), JSON.stringify({ result: 'passed' }));
  fs.writeFileSync(path.join(directory, `package-smoke.${target}.json`), JSON.stringify({ healthy: true }));
  fs.writeFileSync(path.join(directory, 'package.zip'), `${target}\n`);
}

test('release index 要求三个目标且保持 digest 一致', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-release-index-'));
  try {
    for (const target of ['darwin-universal', 'win32-x64', 'linux-x64']) writeTarget(root, target, 'a'.repeat(64));
    const index = buildReleaseIndex({
      root,
      expectedTargets: ['darwin-universal', 'win32-x64', 'linux-x64'],
      distribution: 'dsh-forge-official',
      version: '0.1.0',
      profile: 'dsh-forge-official',
    });
    assert.equal(index.targets.length, 3);
    assert.equal(index.targets[0]!.files.some((file) => file.path === 'package.zip' && /^[a-f0-9]{64}$/.test(file.sha256)), true);
    fs.rmSync(path.join(root, 'linux-x64', 'package-smoke.linux-x64.json'));
    assert.throws(() => buildReleaseIndex({
      root,
      expectedTargets: ['darwin-universal', 'win32-x64', 'linux-x64'],
      distribution: 'dsh-forge-official',
      version: '0.1.0',
      profile: 'dsh-forge-official',
    }), /缺少文件/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('release index 拒绝 input digest 漂移', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-release-index-drift-'));
  try {
    writeTarget(root, 'darwin-universal', 'a'.repeat(64));
    writeTarget(root, 'win32-x64', 'b'.repeat(64));
    writeTarget(root, 'linux-x64', 'a'.repeat(64));
    assert.throws(() => buildReleaseIndex({
      root,
      expectedTargets: ['darwin-universal', 'win32-x64', 'linux-x64'],
      distribution: 'dsh-forge-official',
      version: '0.1.0',
      profile: 'dsh-forge-official',
    }), /inputDigest 漂移: win32-x64.*expectedTarget.*darwin-universal.*expectedDigest.*actualDigest/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
