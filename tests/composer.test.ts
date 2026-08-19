/** composer 测试使用真实 DSH dump，验证 patch 顺序、launcher 所有权和激活诊断。 */
import assert from 'node:assert/strict';
import * as path from 'node:path';

import { compileProfile } from '../src/compiler/index.ts';
import { composeCompiled, desktopBundleOrder, entryActivation, validateOverlay } from '../src/composer/index.ts';
import { ForgeError } from '../src/core/errors.ts';

const root = path.resolve(__dirname, '..');

test('真实 DSH dump 按 bundle 顺序临时注入 desktop layer', () => {
  const compiled = compileProfile({ root });
  const dump = composeCompiled(compiled, { overlay: { port: 38100, generationId: 'test-generation' } });
  assert.equal(dump.healthy, true);
  assert.deepEqual(dump.bundleOrder, [
    '@deepseek-ai/dsh-base',
    '@deepseek-ai/dsh-web-app',
    '@dsh-forge/desktop-layer',
    '@dsh-forge/product-base',
  ]);
  assert.equal(
    dump.entries.some(
      (entry) => entry.id === 'dsh-forge-desktop-services' && entry.name === '@dsh-forge/desktop-plugin',
    ),
    true,
  );
  assert.equal(compiled.profile.bundles.includes('@dsh-forge/desktop-layer'), false);
});

test('真实 patch 诊断未匹配行，完整 config 覆盖遵从上游 Loader', () => {
  const compiled = compileProfile({ root });
  const dump = composeCompiled(compiled, {
    homePatch: [
      { id: 'webserver', name: '@deepseek-ai/dsh-host-webserver', config: { host: '127.0.0.1', port: 39100 } },
      { id: 'missing-entry', disabled: true },
    ],
  });
  const webserver = dump.entries.find((entry) => entry.id === 'webserver');
  assert.deepEqual(webserver?.config, { host: '127.0.0.1', port: 39100 });
  assert.equal(
    dump.diagnostics.some((item) => item.code === 'PATCH_UNMATCHED'),
    true,
  );
});

test('launcher overlay 和持久 desktop layer 所有权被拒绝', () => {
  assert.throws(
    () => validateOverlay({ model: 'override' } as never),
    (error: unknown) => error instanceof ForgeError && error.code === 'OVERLAY_FORBIDDEN',
  );
  assert.throws(
    () => desktopBundleOrder(['@deepseek-ai/dsh-web-app', '@dsh-forge/desktop-layer']),
    (error: unknown) => error instanceof ForgeError && error.code === 'DESKTOP_LAYER_OWNERSHIP',
  );
});

test('launcher overlay 是真实 dump 的最后一层，entry 激活不依赖列表顺序', () => {
  const compiled = compileProfile({ root });
  const dump = composeCompiled(compiled, {
    homePatch: [
      { id: 'webserver', name: '@deepseek-ai/dsh-host-webserver', config: { host: '127.0.0.1', port: 39101 } },
    ],
    overlay: { port: 39102, generationId: 'overlay-test' },
  });
  const webserver = dump.entries.find((entry) => entry.id === 'webserver');
  assert.equal((webserver?.config as { port: number }).port, 39102);
  const activation = entryActivation([
    { id: 'consumer', inject: ['service-a'] },
    { id: 'provider', provides: ['service-a'] },
  ]);
  assert.equal(activation[0]?.active, false);
  assert.equal(activation[1]?.active, true);
});
