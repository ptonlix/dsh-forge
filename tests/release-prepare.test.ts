/** 发布准备命令的版本/build 规则、格式保留和失败恢复测试。 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  compareReleaseVersions,
  parseReleaseArguments,
  prepareRelease,
} from '../scripts/prepare-release.ts';

function fixture(version = '0.1.0', build: number | string = 1): { readonly root: string; readonly distributionFile: string; readonly packageFile: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-release-prepare-'));
  const distributionFile = path.join(root, 'distribution.yml');
  const packageFile = path.join(root, 'package.json');
  fs.writeFileSync(
    distributionFile,
    `schema: dsh-forge/distribution@1\nversion: ${version} # 保留注释\nname: DSH Forge\n`,
  );
  fs.writeFileSync(
    packageFile,
    `{
  "name": "@dsh-forge/core",
  "version": "${version}",
  "dshForgeBuild": ${build},
  "description": "保留其他字段"
}\n`,
  );
  return { root, distributionFile, packageFile };
}

test('新版本更新版本并将 build 重置为 1，同时保留源文件格式', () => {
  const files = fixture('0.1.0', 8);
  try {
    const result = prepareRelease({ ...files, version: '0.2.0' });
    assert.deepEqual(result, { currentVersion: '0.1.0', version: '0.2.0', currentBuild: 8, build: 1 });
    const distribution = fs.readFileSync(files.distributionFile, 'utf8');
    const packageJson = fs.readFileSync(files.packageFile, 'utf8');
    assert.match(distribution, /^version: 0\.2\.0 # 保留注释$/m);
    assert.match(packageJson, /^  "version": "0\.2\.0",$/m);
    assert.match(packageJson, /^  "dshForgeBuild": 1,$/m);
    assert.match(packageJson, /"description": "保留其他字段"/);
  } finally {
    fs.rmSync(files.root, { recursive: true, force: true });
  }
});

test('同一版本重发只递增 build', () => {
  const files = fixture('0.2.0', 1);
  try {
    const result = prepareRelease({ ...files, version: '0.2.0' });
    assert.equal(result.build, 2);
    assert.match(fs.readFileSync(files.distributionFile, 'utf8'), /^version: 0\.2\.0 # 保留注释$/m);
    const packageJson = fs.readFileSync(files.packageFile, 'utf8');
    assert.match(packageJson, /^  "version": "0\.2\.0",$/m);
    assert.match(packageJson, /^  "dshForgeBuild": 2,$/m);
  } finally {
    fs.rmSync(files.root, { recursive: true, force: true });
  }
});

test('预发布版本按 SemVer 顺序比较，构建元数据不影响优先级', () => {
  assert.equal(compareReleaseVersions('1.0.0-rc.1', '1.0.0-rc.2'), -1);
  assert.equal(compareReleaseVersions('1.0.0-rc.2', '1.0.0'), -1);
  assert.equal(compareReleaseVersions('1.0.0+build.1', '1.0.0+build.2'), 0);
});

test('拒绝非法参数和版本降级，且不修改源文件', () => {
  assert.throws(() => parseReleaseArguments([]), /用法/);
  assert.throws(() => parseReleaseArguments(['0.2.0', 'extra']), /用法/);
  assert.throws(() => parseReleaseArguments(['v0.2.0']), /精确 SemVer/);
  assert.equal(parseReleaseArguments(['--', '0.2.0']), '0.2.0');
  const files = fixture('0.2.0', 3);
  const beforeDistribution = fs.readFileSync(files.distributionFile, 'utf8');
  const beforePackage = fs.readFileSync(files.packageFile, 'utf8');
  try {
    assert.throws(() => prepareRelease({ ...files, version: '0.1.9' }), /低于当前版本/);
    assert.equal(fs.readFileSync(files.distributionFile, 'utf8'), beforeDistribution);
    assert.equal(fs.readFileSync(files.packageFile, 'utf8'), beforePackage);
  } finally {
    fs.rmSync(files.root, { recursive: true, force: true });
  }
});

test('无效 build、字段缺失和 build 溢出均不会修改源文件', () => {
  const invalidBuild = fixture('0.1.0', 0);
  try {
    assert.throws(() => prepareRelease({ ...invalidBuild, version: '0.2.0' }), /正安全整数/);
  } finally {
    fs.rmSync(invalidBuild.root, { recursive: true, force: true });
  }

  const overflow = fixture('0.2.0', Number.MAX_SAFE_INTEGER);
  const overflowBefore = fs.readFileSync(overflow.distributionFile, 'utf8');
  try {
    assert.throws(() => prepareRelease({ ...overflow, version: '0.2.0' }), /超出正安全整数范围/);
    assert.equal(fs.readFileSync(overflow.distributionFile, 'utf8'), overflowBefore);
  } finally {
    fs.rmSync(overflow.root, { recursive: true, force: true });
  }

  const missingVersion = fixture();
  fs.writeFileSync(missingVersion.distributionFile, 'schema: dsh-forge/distribution@1\n');
  try {
    assert.throws(() => prepareRelease({ ...missingVersion, version: '0.2.0' }), /唯一的顶层 version/);
  } finally {
    fs.rmSync(missingVersion.root, { recursive: true, force: true });
  }
});

test('拒绝 distribution 与根 package.json 版本不一致', () => {
  const files = fixture('0.1.0', 1);
  fs.writeFileSync(files.packageFile, fs.readFileSync(files.packageFile, 'utf8').replace('"version": "0.1.0"', '"version": "0.1.1"'));
  const beforeDistribution = fs.readFileSync(files.distributionFile, 'utf8');
  const beforePackage = fs.readFileSync(files.packageFile, 'utf8');
  try {
    assert.throws(() => prepareRelease({ ...files, version: '0.2.0' }), /版本.*不一致/);
    assert.equal(fs.readFileSync(files.distributionFile, 'utf8'), beforeDistribution);
    assert.equal(fs.readFileSync(files.packageFile, 'utf8'), beforePackage);
  } finally {
    fs.rmSync(files.root, { recursive: true, force: true });
  }
});

test('第二个文件写入失败时恢复第一个文件', () => {
  const files = fixture('0.1.0', 1);
  const beforeDistribution = fs.readFileSync(files.distributionFile, 'utf8');
  const beforePackage = fs.readFileSync(files.packageFile, 'utf8');
  try {
    fs.chmodSync(files.packageFile, 0o444);
    assert.throws(() => prepareRelease({ ...files, version: '0.2.0' }), /发布文件写入失败/);
    assert.equal(fs.readFileSync(files.distributionFile, 'utf8'), beforeDistribution);
    assert.equal(fs.readFileSync(files.packageFile, 'utf8'), beforePackage);
  } finally {
    fs.chmodSync(files.packageFile, 0o600);
    fs.rmSync(files.root, { recursive: true, force: true });
  }
});
