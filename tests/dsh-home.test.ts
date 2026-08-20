import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveStartupProfile } from '../apps/desktop/main.ts';
import { resolveDesktopDshHome } from '../apps/desktop/runtime/dsh-home.ts';
import { ensureManagedProfile } from '../apps/desktop/runtime/managed-profile.ts';
import { ProfileStateStore } from '../apps/desktop/runtime/state-store.ts';

const temporaryDirectories: string[] = [];

function temporaryDirectory(prefix: string): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function writeFile(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, content, { encoding: 'utf8', mode: 0o600 });
}

function writeProfile(directory: string, marker: string): void {
  writeFile(
    path.join(directory, 'package.json'),
    `${JSON.stringify({
      name: `@test/${marker}`,
      private: true,
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] } },
    })}\n`,
  );
  writeFile(path.join(directory, 'cordis.yml'), `# ${marker}\n[]\n`);
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe('Desktop DSH Home', () => {
  it('遵循 DSH_HOME 优先级且不把空白值当作路径', () => {
    const home = temporaryDirectory('dsh-forge-home-directory-');
    expect(resolveDesktopDshHome({}, home)).toEqual({ path: path.join(home, '.dsh'), source: 'default' });
    expect(resolveDesktopDshHome({ DSH_HOME: ' ~/custom ' }, home)).toEqual({
      path: path.resolve(' ~/custom '),
      source: 'environment',
    });
    expect(resolveDesktopDshHome({ DSH_HOME: '~/custom' }, home)).toEqual({
      path: path.join(home, 'custom'),
      source: 'environment',
    });
    expect(resolveDesktopDshHome({ DSH_HOME: '   ' }, home)).toEqual({
      path: path.join(home, '.dsh'),
      source: 'default',
    });
  });

});

describe('发行版受管 profile', () => {
  it('按仓库 profile 名称安装、更新并备份旧 profile', () => {
    const root = temporaryDirectory('dsh-forge-managed-profile-');
    const template = path.join(root, 'template');
    const dshHome = path.join(root, 'home');
    writeProfile(template, 'first');
    writeProfile(path.join(dshHome, 'profiles', 'personal'), 'personal');

    const installed = ensureManagedProfile({
      source: template,
      dshHome,
      distributionId: 'dsh-forge-official',
      sourceProfile: 'developer',
    });
    expect(installed).toMatchObject({ profileName: 'developer', installed: true, updated: false });
    expect(installed.directory).toBe(path.join(dshHome, 'profiles', 'developer'));
    expect(fs.existsSync(path.join(dshHome, 'profiles', 'personal', 'package.json'))).toBe(true);
    expect(fs.existsSync(path.join(installed.directory, '.dsh-forge-profile.json'))).toBe(true);

    writeFile(path.join(template, 'cordis.yml'), '# second\n[]\n');
    const updated = ensureManagedProfile({
      source: template,
      dshHome,
      distributionId: 'dsh-forge-official',
      sourceProfile: 'developer',
    });
    expect(updated).toMatchObject({ installed: false, updated: true });
    expect(fs.readFileSync(path.join(updated.directory, 'cordis.yml'), 'utf8')).toBe('# second\n[]\n');
    const backups = fs.readdirSync(path.join(dshHome, '.dsh-forge', 'managed-profile-backups', 'developer'));
    expect(backups).toHaveLength(1);
  });

  it('拒绝覆盖没有发行版归属标记的同名 profile', () => {
    const root = temporaryDirectory('dsh-forge-profile-collision-');
    const template = path.join(root, 'template');
    const dshHome = path.join(root, 'home');
    writeProfile(template, 'template');
    writeProfile(path.join(dshHome, 'profiles', 'dsh-forge-official'), 'user-profile');

    expect(() =>
      ensureManagedProfile({
        source: template,
        dshHome,
        distributionId: 'dsh-forge-official',
        sourceProfile: 'dsh-forge-official',
      }),
    ).toThrow(/拒绝覆盖非本发行版管理的 profile/);
  });

  it('同一发行版的旧来源标记会刷新为当前 profile', () => {
    const root = temporaryDirectory('dsh-forge-profile-marker-migration-');
    const template = path.join(root, 'template');
    const dshHome = path.join(root, 'home');
    const destination = path.join(dshHome, 'profiles', 'dsh-forge-official');
    writeProfile(template, 'same-content');
    writeProfile(destination, 'same-content');
    writeFile(
      path.join(destination, '.dsh-forge-profile.json'),
      `${JSON.stringify({
        schema: 'dsh-forge/managed-profile@1',
        distributionId: 'dsh-forge-official',
        sourceProfile: 'official',
        templateDigest: 'sha256-old',
      })}\n`,
    );

    const result = ensureManagedProfile({
      source: template,
      dshHome,
      distributionId: 'dsh-forge-official',
      sourceProfile: 'dsh-forge-official',
    });

    expect(result).toMatchObject({ installed: false, updated: false });
    expect(JSON.parse(fs.readFileSync(path.join(destination, '.dsh-forge-profile.json'), 'utf8'))).toMatchObject({
      distributionId: 'dsh-forge-official',
      sourceProfile: 'dsh-forge-official',
    });
  });
});

describe('Desktop 启动状态', () => {
  it('清除不存在 profile 的持久化引用并选择发行 profile', () => {
    const root = temporaryDirectory('dsh-forge-startup-state-');
    const store = new ProfileStateStore(root);
    store.save({
      version: 1,
      active: 'retired-profile',
      pending: { profile: 'retired-profile', requestedAt: '2026-08-20T00:00:00.000Z' },
      lastKnownGood: 'retired-profile',
      generationId: 'gen-retired',
      lastFailure: {
        target: 'retired-profile',
        stage: 'preparing',
        attempt: 0,
        reason: '历史失败',
        occurredAt: '2026-08-20T00:00:00.000Z',
      },
      manualRecovery: { target: 'retired-profile', stage: 'preparing', reason: '历史失败' },
    });

    const profile = resolveStartupProfile(
      store,
      [{ name: 'dsh-forge-official', selectable: true, default: true }],
      'dsh-forge-official',
    );

    expect(profile).toBe('dsh-forge-official');
    expect(store.load()).toMatchObject({
      active: null,
      pending: null,
      lastKnownGood: null,
      generationId: null,
      lastFailure: null,
      manualRecovery: null,
    });
  });

  it('显式 profile 优先于可恢复的历史选择', () => {
    const root = temporaryDirectory('dsh-forge-explicit-startup-profile-');
    const store = new ProfileStateStore(root);
    store.save({
      version: 1,
      active: 'dsh-forge-official',
      pending: null,
      lastKnownGood: 'dsh-forge-official',
      generationId: 'gen-official',
      lastFailure: null,
      manualRecovery: null,
    });

    expect(
      resolveStartupProfile(
        store,
        [
          { name: 'dsh-forge-official', selectable: true, default: true },
          { name: 'developer', selectable: true },
        ],
        'dsh-forge-official',
        'developer',
      ),
    ).toBe('developer');
  });
});
