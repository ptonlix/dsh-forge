/** GitHub Release version.json 的字段、build 与资产 URL 配置测试。 */
import assert from 'node:assert/strict';
import { createFullPackageVersionManifest } from '../scripts/create-version-manifest.ts';
import { readDshForgeBuild } from '../scripts/package-desktop.ts';

test('version.json 以同一版本/build 生成 Windows、macOS、Ubuntu AppImage 条目', () => {
  const manifest = createFullPackageVersionManifest('1.0.0', 3);
  assert.deepEqual(manifest, {
    windows: { version: '1.0.0', build: 3, url: 'https://github.com/ptonlix/dsh-forge/releases/download/v1.0.0/dsh-forge-windows.exe' },
    macos: { version: '1.0.0', build: 3, url: 'https://github.com/ptonlix/dsh-forge/releases/download/v1.0.0/dsh-forge-macos.dmg' },
    ubuntu: { version: '1.0.0', build: 3, url: 'https://github.com/ptonlix/dsh-forge/releases/download/v1.0.0/dsh-forge-ubuntu.AppImage' },
  });
});

test('version.json 拒绝非法 build、版本和非 HTTPS Release 资产 URL', () => {
  assert.throws(() => createFullPackageVersionManifest('1.0', 1), /精确 SemVer/);
  assert.throws(() => createFullPackageVersionManifest('1.0.0', 0), /正安全整数/);
  assert.throws(
    () =>
      createFullPackageVersionManifest('1.0.0', 1, {
        windows: 'http://github.com/ptonlix/dsh-forge/releases/download/v1.0.0/dsh-forge-windows.exe',
        macos: 'https://github.com/ptonlix/dsh-forge/releases/download/v1.0.0/dsh-forge-macos.dmg',
        ubuntu: 'https://github.com/ptonlix/dsh-forge/releases/download/v1.0.0/dsh-forge-ubuntu.AppImage',
      }),
    /Release 资产 URL 无效/,
  );
});

test('打包 staging 只接受正安全整数 dshForgeBuild', () => {
  assert.equal(readDshForgeBuild({ dshForgeBuild: 2 }), 2);
  for (const build of [undefined, 0, -1, 1.1, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => readDshForgeBuild({ dshForgeBuild: build }), /dshForgeBuild 必须是正安全整数/);
  }
});
