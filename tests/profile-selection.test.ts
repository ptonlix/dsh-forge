import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { main } from '@dsh-forge/profile-toolchain/cli';
import { resolveProfile } from '@dsh-forge/profile-toolchain/compiler';
import {
  packagedProfileName,
  profileFromArguments,
  selectDesktopProfile,
} from '../apps/desktop/runtime/profile-selection.ts';

describe('profile 命令选择', () => {
  it('显式选择发行 profile 并报告 profile 名称', () => {
    expect(main('profile:resolve', 'dsh-forge-official')).toBe(0);
  });

  it('不存在的显式 profile 必须失败而不是回退默认值', () => {
    expect(() => main('profile:resolve', 'missing-profile')).toThrow(/profile 不存在/);
  });

  it('发行 profile 与 Fork profile 的产物按 profile 名称隔离', () => {
    expect(main('profile:resolve', 'developer')).toBe(0);
    const root = path.resolve(__dirname, '..');
    const forgeOfficial = fs.readdirSync(path.join(root, 'artifacts', 'dsh-forge-official', 'dsh-forge-official'));
    const developer = fs.readdirSync(path.join(root, 'artifacts', 'dsh-forge-official', 'developer'));
    expect(forgeOfficial.length).toBeGreaterThan(0);
    expect(developer.length).toBeGreaterThan(0);
  });

  it('profile schema 无效时在写入产物前失败', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-invalid-profile-'));
    const file = path.join(directory, 'profile.yml');
    fs.writeFileSync(
      file,
      "schema: invalid\nname: developer\nruntime:\n  dshPackageFamily: '@deepseek-ai/dsh'\n  dshVersion: 0.1.2-alpha.4\n  cordisVersion: 4.0.2\n  desktopProtocol: 1\n  electronVersion: 43.4.0\n  nodeEngine: '>=20.0.0'\nbundles: ['@deepseek-ai/dsh-base']\n",
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

describe('Desktop profile 选择', () => {
  it('开发态仅接受一个显式 profile 参数', () => {
    expect(profileFromArguments(['electron', '.', '--profile', 'developer'])).toBe('developer');
    expect(profileFromArguments(['electron', '.'])).toBeNull();
    expect(() => profileFromArguments(['electron', '.', '--profile'])).toThrow(/必须提供/);
    expect(() => profileFromArguments(['electron', '.', '--profile', '../escape'])).toThrow(/无效/);
    expect(() => profileFromArguments(['electron', '.', '--profile', 'developer', '--profile', 'beta'])).toThrow(/重复/);
  });

  it('打包应用从 resolved manifest 绑定 profile，并拒绝不一致的参数', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-packaged-profile-'));
    const manifest = path.join(directory, 'resolved-manifest.json');
    fs.writeFileSync(manifest, JSON.stringify({ profile: { name: 'developer' } }), { mode: 0o600 });
    try {
      const embedded = packagedProfileName(manifest);
      expect(embedded).toBe('developer');
      expect(
        selectDesktopProfile({
          defaultProfile: 'dsh-forge-official',
          requestedProfile: null,
          packagedProfile: embedded,
        }),
      ).toBe('developer');
      expect(() =>
        selectDesktopProfile({
          defaultProfile: 'dsh-forge-official',
          requestedProfile: 'dsh-forge-official',
          packagedProfile: embedded,
        }),
      ).toThrow(/仅包含 profile/);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
