/** 使用真实 Cordis Context 验证 provider 注册、公开 descriptor 与 fiber teardown。 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import {
  assertDesktopServicesProtocol,
  desktopServiceNames,
  type DesktopProfileSummary,
} from '@dsh-forge/desktop-services';
import localProvider from '@dsh-forge/desktop-services-local';
import { createDesktopHostCapability } from '@dsh-forge/desktop-services-local/launcher';
import { compileProfile } from '@dsh-forge/profile-toolchain/compiler';
import { ensureManagedProfile } from '../apps/desktop/runtime/managed-profile.ts';
import { startDshHost } from '../apps/desktop/main.ts';

const root = path.resolve(__dirname, '..');

function profile(): DesktopProfileSummary {
  return {
    name: 'fixture',
    exists: true,
    bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'],
    webCompatible: true,
    default: true,
    selectable: true,
    error: null,
    reason: null,
  };
}

test('真实 Cordis Loader 只在 capability 注入后发布公开桌面 services，并在 dispose 后移除', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-loader-'));
  const generation = { id: 'loader-generation', profile: 'fixture', stage: 'committed', closed: false };
  const capability = createDesktopHostCapability({
    generation,
    profileDir: directory,
    profiles: [profile()],
    manager: { select: async () => generation },
    catalog: [],
    reconcile: async () => {},
    verifyNextGeneration: async () => true,
  });
  const ctx = new Context();
  ctx.provide('dshForgeDesktopCapability', capability);
  const fiber = await ctx.plugin(localProvider);
  const descriptor = ctx.get(desktopServiceNames.descriptor);
  assert.ok(descriptor);
  assertDesktopServicesProtocol(descriptor);
  assert.equal(ctx.get(desktopServiceNames.profiles)?.snapshot().current, 'fixture');
  assert.ok(ctx.get(desktopServiceNames.pnpm));
  await fiber.dispose();
  assert.equal(ctx.get(desktopServiceNames.profiles), undefined);
  assert.equal(ctx.get(desktopServiceNames.pnpm), undefined);
  assert.equal(ctx.get(desktopServiceNames.descriptor), undefined);
  fs.rmSync(directory, { recursive: true, force: true });
});

test('缺少 launcher capability 时 provider 不会伪造桌面服务', async () => {
  const ctx = new Context();
  const fiber = ctx.plugin(localProvider);
  assert.equal(ctx.get(desktopServiceNames.descriptor), undefined);
  await fiber.dispose();
});

test('协议主版本不兼容时在执行操作前稳定失败', () => {
  assert.throws(
    () => assertDesktopServicesProtocol({ protocol: 2 }, 1),
    /desktop services 协议不兼容: 需要 1，实际 2/,
  );
});

test(
  'Desktop Host 从受管 profile 闭包加载第三方 bundle，并只临时补齐 launcher runtime',
  async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-host-loader-'));
    try {
      const compiled = compileProfile({ root });
      const managed = ensureManagedProfile({
        source: compiled.profileDir,
        dshHome: home,
        distributionId: compiled.distribution.id,
        sourceProfile: compiled.profile.name,
      });
      const bundles = compiled.profile.bundles;
      const desktopProfile = {
        name: managed.profileName,
        dir: managed.directory,
        bundles,
        exists: true,
        webCompatible: true,
        default: true,
        selectable: true,
        error: null,
        reason: null,
      };
      const generation = { id: 'desktop-loader-host', profile: managed.profileName, stage: 'prepared', closed: false };
      const capability = createDesktopHostCapability({
        generation,
        profileDir: managed.directory,
        profiles: [desktopProfile],
        manager: { select: async () => generation },
        catalog: [],
        reconcile: async () => {},
        verifyNextGeneration: async () => true,
      });
      const host = await startDshHost({
        root,
        home,
        runtimeRoot: root,
        profile: desktopProfile,
        generationId: generation.id,
        capability,
      });
      try {
        await host.entriesSettled();
        assert.equal(bundles.filter((bundle) => bundle === 'dsh-better-sidebar').length, 1);
        assert.equal(bundles.filter((bundle) => bundle === 'dsh-dream-skin').length, 1);
        assert.equal(bundles.includes('@dsh-forge/desktop-layer'), false);
        const dependencies = path.join(managed.directory, 'node_modules');
        assert.equal(fs.existsSync(path.join(dependencies, 'dsh-better-sidebar', 'package.json')), true);
        assert.equal(fs.existsSync(path.join(dependencies, 'dsh-dream-skin', 'package.json')), true);
        assert.equal(fs.existsSync(path.join(dependencies, '@deepseek-ai', 'dsh-llm', 'package.json')), true);
        assert.equal(fs.existsSync(path.join(dependencies, '@dsh-forge', 'desktop-layer', 'package.json')), true);
        assert.equal(fs.lstatSync(path.join(dependencies, '@deepseek-ai', 'dsh-llm')).isDirectory(), true);
        assert.equal(fs.lstatSync(path.join(dependencies, '@dsh-forge', 'desktop-layer')).isSymbolicLink(), true);
      } finally {
        await host.dispose();
      }
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  },
  55_000,
);
