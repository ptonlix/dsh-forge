/** 升级 Remote 的固定面测试：只允许三个无参数方法。 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { TYPERT_REMOTE } from '@dsh-forge/desktop-layer/remote';

test('Host gateway 与 Client descriptor 暴露同一组无参数方法', () => {
  assert.deepEqual(
    TYPERT_REMOTE.descriptors.map((entry) => entry.method),
    ['status', 'check', 'startUpgrade'],
  );
  for (const descriptor of TYPERT_REMOTE.descriptors) {
    assert.equal(descriptor.service, 'upgradeManager');
    assert.deepEqual(descriptor.parameters, []);
    assert.equal(descriptor.cancellation, undefined);
    assert.equal(descriptor.result.mode, 'strict');
    assert.equal(descriptor.result.typeSymbol, '@dsh-forge/desktop-layer#UpgradeManagerStatus');
    assert.equal(typeof descriptor.result.schema?.parse, 'function');
  }
});

test('设置页通过 Remote 注册且不携带 Electron 或安装路径能力', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'packages/bundles/desktop-layer/lib/client.js'), 'utf8');
  assert.match(source, /settings\.section/);
  assert.match(source, /当前安装方式不支持 OTA/);
  assert.match(source, /remote\.\$mount/);
  assert.match(source, /remote\.upgradeManager/);
  assert.doesNotMatch(source, /ipcRenderer|http:\/\/|https:\/\/|stagedPackage|executablePath|shell/);
});

test('客户端模块扫描器能够读取 desktop layer 的 manifest', () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'packages/bundles/desktop-layer/package.json'), 'utf8'),
  ) as { readonly exports?: Record<string, unknown> };
  assert.equal(manifest.exports?.['./package.json'], './package.json');
});

test('构建后的 Client 产物保留 ModuleLoader factory 契约', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'packages/bundles/desktop-layer/lib/client.js'), 'utf8');
  let registration: {
    readonly id: string;
    readonly factory: (require: (id: string) => unknown) => unknown;
  } | undefined;
  vm.runInNewContext(source, {
    window: {
      __ModuleLoader__: {
        load(config: { readonly id: string; readonly factory: (require: (id: string) => unknown) => unknown }) {
          registration = config;
        },
      },
    },
  });
  assert.equal(registration?.id, '@dsh-forge/desktop-layer');
  const exports = registration?.factory((id) => {
    if (id === 'react') return {};
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return {};
    throw new Error(`意外的 Client 依赖：${id}`);
  }) as { readonly apply?: unknown; readonly inject?: readonly string[] } | undefined;
  assert.equal(typeof exports?.apply, 'function');
  assert.deepEqual(Array.from(exports?.inject ?? []), ['slots', 'locale', 'remote']);
});
