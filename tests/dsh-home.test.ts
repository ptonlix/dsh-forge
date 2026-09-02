import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createShippedAgentPresetsPatch,
  resolveAuthenticatedLoopbackUrl,
  resolveShippedAgentPresetsRoot,
  resolveStartupProfile,
} from '../apps/desktop/main.ts';
import {
  isIncompatibleSessionProjectionCache,
  quarantineIncompatibleSessionProjectionCache,
  reconcileDshHomeWriterLocks,
  resolveDesktopDshHome,
} from '../apps/desktop/runtime/dsh-home.ts';
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

  it('删除死进程留下的 credentials 写锁，并拒绝抢占仍存活的锁',
    () => {
      const home = temporaryDirectory('dsh-forge-home-locks-');
      const lock = path.join(home, '.credentials.yaml.lock');
      const staleTemp = path.join(home, '.credentials.yaml.dead.tmp');
      fs.writeFileSync(lock, '999999\n', { encoding: 'utf8', mode: 0o600 });
      fs.writeFileSync(staleTemp, '', { encoding: 'utf8', mode: 0o600 });
      const recovered = reconcileDshHomeWriterLocks(home);
      expect(recovered.busyPid).toBeNull();
      expect(recovered.removed).toHaveLength(2);
      expect(recovered.removed).toEqual(expect.arrayContaining([lock, staleTemp]));
      expect(fs.existsSync(lock)).toBe(false);
      expect(fs.existsSync(staleTemp)).toBe(false);

      fs.writeFileSync(lock, `${process.pid}\n`, { encoding: 'utf8', mode: 0o600 });
      expect(reconcileDshHomeWriterLocks(home)).toEqual({
        removed: [],
        busyPid: process.pid,
      });
      expect(fs.existsSync(lock)).toBe(true);
    },
  );

  it('识别 session_projcache schema 失败并隔离缓存目录',
    () => {
      const home = temporaryDirectory('dsh-forge-home-projcache-');
      const cache = path.join(home, 'storages', 'session_projcache');
      const meta = path.join(home, 'storages', 'session_projcache.json');
      writeFile(path.join(cache, 'sessions', 'session.json'), '{}\n');
      writeFile(meta, '{}\n');
      const error = new Error("domain 'session_projcache': stored record 'x' in table 'sessions' does not match its schema");
      expect(isIncompatibleSessionProjectionCache(error)).toBe(true);
      expect(isIncompatibleSessionProjectionCache(new Error('unrelated'))).toBe(false);
      const moved = quarantineIncompatibleSessionProjectionCache(home);
      expect(moved).toHaveLength(2);
      expect(fs.existsSync(cache)).toBe(false);
      expect(fs.existsSync(meta)).toBe(false);
      expect(moved.every((file) => fs.existsSync(file))).toBe(true);
    },
  );

  it('从 runtime 应用包注入官方预设根，并保留既有 roster 配置', () => {
    const runtime = temporaryDirectory('dsh-forge-runtime-presets-');
    const packageFile = path.join(runtime, 'package.json');
    const root = path.join(runtime, 'presets');
    writeFile(packageFile, '{}\n');
    writeFile(path.join(root, 'standard', 'agent.cordis.yml'), '[]\n');

    expect(resolveShippedAgentPresetsRoot(packageFile)).toBe(root);
    expect(
      createShippedAgentPresetsPatch(packageFile, { default: 'code', includeUserRoot: true }),
    ).toEqual({
      id: 'agent-presets',
      config: {
        default: 'code',
        includeUserRoot: true,
        roots: [{ path: root, trust: 'system' }],
      },
    });
  });

  it('把 Host connection 的 token 绑到当前 loopback origin', () => {
    const ctx = {
      fiber: { dispose: async () => undefined },
      provide() {},
      get(name: string) {
        if (name !== 'connection') return undefined;
        return {
          authenticatedUrl(base: string) {
            const url = new URL(base);
            url.searchParams.set('token', 'launch-token');
            return url.href;
          },
        };
      },
    };
    expect(resolveAuthenticatedLoopbackUrl(ctx, 39123)).toBe('http://127.0.0.1:39123/?token=launch-token');
  });

  it('拒绝缺少 token 或离开 loopback 的 authenticatedUrl', () => {
    const missing = {
      fiber: { dispose: async () => undefined },
      provide() {},
      get() {
        return { authenticatedUrl: () => 'http://127.0.0.1:39123/' };
      },
    };
    expect(() => resolveAuthenticatedLoopbackUrl(missing, 39123)).toThrow(/缺少 token/);
    const drifted = {
      fiber: { dispose: async () => undefined },
      provide() {},
      get() {
        return { authenticatedUrl: () => 'http://127.0.0.1:9/?token=launch-token' };
      },
    };
    expect(() => resolveAuthenticatedLoopbackUrl(drifted, 39123)).toThrow(/离开当前 loopback origin/);
  });

  it('拒绝缺少 standard 组合文件的 runtime', () => {
    const runtime = temporaryDirectory('dsh-forge-missing-presets-');
    const packageFile = path.join(runtime, 'package.json');
    writeFile(packageFile, '{}\n');

    expect(() => resolveShippedAgentPresetsRoot(packageFile)).toThrow(/缺少官方 agent preset/);
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
    ).toThrow(/拒绝覆盖不符合当前发行版受管契约的 profile/);
  });

  it('拒绝缺少当前闭包摘要的旧受管 marker', () => {
    const root = temporaryDirectory('dsh-forge-profile-legacy-marker-');
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
        sourceProfile: 'dsh-forge-official',
        templateDigest: 'sha256-old',
      })}\n`,
    );

    expect(() =>
      ensureManagedProfile({
        source: template,
        dshHome,
        distributionId: 'dsh-forge-official',
        sourceProfile: 'dsh-forge-official',
      }),
    ).toThrow(/拒绝覆盖不符合当前发行版受管契约的 profile/);
  });

  it('复制闭包内相对 pnpm 链接并将依赖摘要写入受管 marker', () => {
    const root = temporaryDirectory('dsh-forge-profile-dependencies-');
    const template = path.join(root, 'template');
    const dshHome = path.join(root, 'home');
    writeProfile(template, 'dependencies');
    const packageRoot = path.join(template, 'node_modules', '.pnpm', 'fixture@1.0.0', 'node_modules', 'fixture');
    writeFile(path.join(packageRoot, 'package.json'), '{"name":"fixture","version":"1.0.0"}\n');
    fs.symlinkSync('.pnpm/fixture@1.0.0/node_modules/fixture', path.join(template, 'node_modules', 'fixture'), 'dir');

    const installed = ensureManagedProfile({
      source: template,
      dshHome,
      distributionId: 'dsh-forge-official',
      sourceProfile: 'dsh-forge-official',
    });
    const copied = path.join(installed.directory, 'node_modules', 'fixture');
    expect(fs.lstatSync(copied).isSymbolicLink()).toBe(true);
    expect(fs.readlinkSync(copied)).toBe('.pnpm/fixture@1.0.0/node_modules/fixture');
    expect(JSON.parse(fs.readFileSync(path.join(copied, 'package.json'), 'utf8'))).toMatchObject({ name: 'fixture' });
    expect(JSON.parse(fs.readFileSync(path.join(installed.directory, '.dsh-forge-profile.json'), 'utf8')).dependencyDigest).toMatch(
      /^sha256-/,
    );

    expect(
      ensureManagedProfile({
        source: template,
        dshHome,
        distributionId: 'dsh-forge-official',
        sourceProfile: 'dsh-forge-official',
      }),
    ).toMatchObject({ installed: false, updated: false });
  });

  it('发现已安装依赖源码漂移后原子恢复受管闭包', () => {
    const root = temporaryDirectory('dsh-forge-profile-content-digest-');
    const template = path.join(root, 'template');
    const dshHome = path.join(root, 'home');
    writeProfile(template, 'content-digest');
    writeFile(path.join(template, 'node_modules', 'fixture', 'package.json'), '{"name":"fixture","version":"1.0.0"}\n');
    writeFile(path.join(template, 'node_modules', 'fixture', 'index.js'), 'module.exports = "original";\n');

    const installed = ensureManagedProfile({
      source: template,
      dshHome,
      distributionId: 'dsh-forge-official',
      sourceProfile: 'dsh-forge-official',
    });
    const installedEntry = path.join(installed.directory, 'node_modules', 'fixture', 'index.js');
    writeFile(installedEntry, 'module.exports = "tampered";\n');

    const repaired = ensureManagedProfile({
      source: template,
      dshHome,
      distributionId: 'dsh-forge-official',
      sourceProfile: 'dsh-forge-official',
    });

    expect(repaired).toMatchObject({ installed: false, updated: true });
    expect(fs.readFileSync(installedEntry, 'utf8')).toBe('module.exports = "original";\n');
  });

  it('忽略并且不复制所有层级的 pnpm 绝对 .bin shim', () => {
    const root = temporaryDirectory('dsh-forge-profile-bin-shim-');
    const template = path.join(root, 'template');
    const dshHome = path.join(root, 'home');
    writeProfile(template, 'bin-shim');
    const target = path.join(root, 'build', 'cli');
    writeFile(target, '#!/usr/bin/env node\n');
    fs.mkdirSync(path.join(template, 'node_modules', '.bin'), { recursive: true, mode: 0o700 });
    fs.symlinkSync(target, path.join(template, 'node_modules', '.bin', 'fixture-cli'), 'file');
    fs.mkdirSync(path.join(template, 'node_modules', 'fixture', 'node_modules', '.bin'), { recursive: true, mode: 0o700 });
    fs.symlinkSync(target, path.join(template, 'node_modules', 'fixture', 'node_modules', '.bin', 'fixture-cli'), 'file');

    const installed = ensureManagedProfile({
      source: template,
      dshHome,
      distributionId: 'dsh-forge-official',
      sourceProfile: 'dsh-forge-official',
    });

    expect(fs.existsSync(path.join(installed.directory, 'node_modules', '.bin'))).toBe(false);
    expect(fs.existsSync(path.join(installed.directory, 'node_modules', 'fixture', 'node_modules', '.bin'))).toBe(false);
  });

  it('不将启动时注入的 desktop fallback 纳入 profile 闭包', () => {
    const root = temporaryDirectory('dsh-forge-profile-desktop-fallback-');
    const template = path.join(root, 'template');
    const dshHome = path.join(root, 'home');
    writeProfile(template, 'desktop-fallback');
    const installed = ensureManagedProfile({
      source: template,
      dshHome,
      distributionId: 'dsh-forge-official',
      sourceProfile: 'dsh-forge-official',
    });
    const fallbackRoot = path.join(root, 'runtime');
    writeFile(path.join(fallbackRoot, 'desktop-layer', 'package.json'), '{"name":"@dsh-forge/desktop-layer"}\n');
    const fallback = path.join(installed.directory, 'node_modules', '@dsh-forge');
    fs.mkdirSync(fallback, { recursive: true, mode: 0o700 });
    fs.symlinkSync(path.join(fallbackRoot, 'desktop-layer'), path.join(fallback, 'desktop-layer'), 'dir');
    writeFile(path.join(fallback, 'desktop-services', 'package.json'), '{"name":"@dsh-forge/desktop-services"}\n');
    writeFile(path.join(fallback, 'profile-toolchain', 'package.json'), '{"name":"@dsh-forge/profile-toolchain"}\n');
    writeFile(
      path.join(fallback, 'desktop-services-local', 'package.json'),
      '{"name":"@dsh-forge/desktop-services-local"}\n',
    );

    const repeated = ensureManagedProfile({
      source: template,
      dshHome,
      distributionId: 'dsh-forge-official',
      sourceProfile: 'dsh-forge-official',
    });

    expect(repeated).toMatchObject({ installed: false, updated: false });
  });

  it('拒绝越出 profile 闭包的依赖链接', () => {
    const root = temporaryDirectory('dsh-forge-profile-escaped-dependency-');
    const template = path.join(root, 'template');
    const dshHome = path.join(root, 'home');
    writeProfile(template, 'escaped');
    writeFile(path.join(root, 'outside', 'package.json'), '{}\n');
    fs.mkdirSync(path.join(template, 'node_modules'), { recursive: true, mode: 0o700 });
    fs.symlinkSync('../../outside', path.join(template, 'node_modules', 'outside'), 'dir');

    expect(() =>
      ensureManagedProfile({
        source: template,
        dshHome,
        distributionId: 'dsh-forge-official',
        sourceProfile: 'dsh-forge-official',
      }),
    ).toThrow(/链接越出闭包/);
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
