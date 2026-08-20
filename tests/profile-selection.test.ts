import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { main } from '@dsh-forge/profile-toolchain/cli';
import { resolveProfile } from '@dsh-forge/profile-toolchain/compiler';

describe('profile 命令选择', () => {
  it('显式选择官方 profile 并报告 profile 名称', () => {
    expect(main('profile:resolve', 'official')).toBe(0);
  });

  it('不存在的显式 profile 必须失败而不是回退默认值', () => {
    expect(() => main('profile:resolve', 'missing-profile')).toThrow(/profile 不存在/);
  });

  it('官方与 Fork profile 的产物按 profile 名称隔离', () => {
    expect(main('profile:resolve', 'developer')).toBe(0);
    const root = path.resolve(__dirname, '..');
    const official = fs.readdirSync(path.join(root, 'artifacts', 'dsh-forge-official', 'official'));
    const developer = fs.readdirSync(path.join(root, 'artifacts', 'dsh-forge-official', 'developer'));
    expect(official.length).toBeGreaterThan(0);
    expect(developer.length).toBeGreaterThan(0);
  });

  it('profile schema 无效时在写入产物前失败', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-invalid-profile-'));
    const file = path.join(directory, 'profile.yml');
    fs.writeFileSync(
      file,
      "schema: invalid\nname: developer\nruntime:\n  dshPackageFamily: '@deepseek-ai/dsh'\n  dshVersion: 0.1.0-rc.7\n  cordisVersion: 4.0.1\n  desktopProtocol: 1\n  electronVersion: 43.4.0\n  nodeEngine: '>=20.0.0'\nbundles: ['@deepseek-ai/dsh-base']\n",
      { mode: 0o600 },
    );
    try {
      expect(() =>
        resolveProfile({ root: path.resolve(__dirname, '..'), profileName: 'developer', profileFile: file }),
      ).toThrow(/不支持的 profile schema/);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
