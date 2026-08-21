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
