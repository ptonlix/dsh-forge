/** 桌面 capability 包边界：公开 contract 不泄露 provider，profile 不持久化 desktop layer。 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';

const root = path.resolve(__dirname, '..');
const requireFromRoot = createRequire(path.join(root, 'package.json'));

test('公开 desktop-services exports 不暴露 provider、launcher 或历史包路径', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'packages/desktop-services/package.json'), 'utf8')) as {
    readonly exports: Record<string, unknown>;
  };
  assert.deepEqual(Object.keys(manifest.exports), ['.']);
  for (const specifier of [
    '@dsh-forge/desktop-services/launcher',
    '@dsh-forge/desktop-plugin',
  ]) {
    assert.throws(() => requireFromRoot.resolve(specifier));
  }
});

test('desktop layer 是唯一 bundle provider 所有者，默认 profile 只持久化上游基线', () => {
  const layer = JSON.parse(fs.readFileSync(path.join(root, 'packages/bundles/desktop-layer/package.json'), 'utf8')) as {
    readonly dependencies: Record<string, string>;
  };
  assert.equal(layer.dependencies['@dsh-forge/desktop-services-local'], 'workspace:*');
  for (const profile of ['dsh-forge-official', 'developer']) {
    const content = fs.readFileSync(path.join(root, 'profiles', profile, 'profile.yml'), 'utf8');
    assert.match(content, /@deepseek-ai\/dsh-base/);
    assert.match(content, /@deepseek-ai\/dsh-web-app/);
    assert.doesNotMatch(content, /desktop-layer|product-base/);
  }
  for (const directory of fs.readdirSync(path.join(root, 'packages', 'bundles'))) {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'packages', 'bundles', directory, 'package.json'), 'utf8')) as {
      readonly dependencies?: Record<string, string>;
    };
    if (directory !== 'desktop-layer')
      assert.equal(manifest.dependencies?.['@dsh-forge/desktop-services-local'], undefined);
  }
});

test('desktop layer 的客户端打包脚本使用跨平台 banner 引号', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'packages/bundles/desktop-layer/package.json'), 'utf8')) as {
    readonly scripts?: { readonly bundle?: string };
  };
  assert.match(manifest.scripts?.bundle ?? '', /--banner:js="\/\* eslint-disable no-var \*\//);
  assert.doesNotMatch(manifest.scripts?.bundle ?? '', /--banner:js='\/\* eslint-disable no-var \*\//);
});
