/** profile 闭包裁剪必须按打包目标删除调试文件，并保留当前架构的 node-pty prebuild。 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ForgeError } from '@dsh-forge/profile-toolchain/core/errors';
import { prunePackagedProfileClosure } from '../scripts/prune-packaged-profile-closure.ts';

function writeFile(file: string, contents = 'x'): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
}

function writePackage(directory: string, name: string, version: string): void {
  writeFile(path.join(directory, 'package.json'), `${JSON.stringify({ name, version })}\n`);
}

function writePrebuild(root: string, platformArch: string, fileName: string): void {
  writeFile(path.join(root, 'prebuilds', platformArch, fileName));
}

function exists(root: string, relative: string): boolean {
  return fs.existsSync(path.join(root, relative));
}

test('darwin-arm64 删除 map、pdb、demo、README 和异架构 prebuilds，保留许可证与当前 prebuild', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-prune-'));
  try {
    writePackage(path.join(root, 'example'), 'example', '1.0.0');
    writeFile(path.join(root, 'example', 'dist', 'index.js'), 'module.exports = 1');
    writeFile(path.join(root, 'example', 'dist', 'index.js.map'), '{}');
    writeFile(path.join(root, 'example', 'README.md'), '# example');
    writeFile(path.join(root, 'example', 'LICENSE'), 'MIT');
    writeFile(path.join(root, 'example', 'LICENSE.md'), 'MIT');
    writeFile(path.join(root, 'cytoscape-fcose', 'demo', 'demo.gif'), 'gif');
    writePackage(path.join(root, 'cytoscape-fcose'), 'cytoscape-fcose', '2.0.0');
    writePackage(path.join(root, 'node-pty'), 'node-pty', '1.1.0');
    writePrebuild(path.join(root, 'node-pty'), 'darwin-arm64', 'pty.node');
    writePrebuild(path.join(root, 'node-pty'), 'darwin-x64', 'pty.node');
    writePrebuild(path.join(root, 'node-pty'), 'win32-x64', 'conpty.pdb');
    writePrebuild(path.join(root, 'node-pty'), 'win32-x64', 'conpty.exe');
    writePrebuild(path.join(root, 'node-pty'), 'linux-x64', 'pty.node');
    writePackage(path.join(root, 'dsh-better-sidebar'), 'dsh-better-sidebar', '0.18.0');
    writePackage(path.join(root, 'dsh-better-sidebar', 'node_modules', 'node-pty'), 'node-pty', '1.1.0');
    writePrebuild(path.join(root, 'dsh-better-sidebar', 'node_modules', 'node-pty'), 'win32-arm64', 'conpty.pdb');
    writePrebuild(path.join(root, 'dsh-better-sidebar', 'node_modules', 'node-pty'), 'darwin-arm64', 'pty.node');

    prunePackagedProfileClosure(root, { os: 'darwin', architectures: ['arm64'] });

    assert.equal(exists(root, 'example/dist/index.js'), true);
    assert.equal(exists(root, 'example/dist/index.js.map'), false);
    assert.equal(exists(root, 'example/README.md'), false);
    assert.equal(exists(root, 'example/LICENSE'), true);
    assert.equal(exists(root, 'example/LICENSE.md'), true);
    assert.equal(exists(root, 'cytoscape-fcose/demo'), false);
    assert.equal(exists(root, 'node-pty/prebuilds/darwin-arm64/pty.node'), true);
    assert.equal(exists(root, 'node-pty/prebuilds/darwin-x64'), false);
    assert.equal(exists(root, 'node-pty/prebuilds/win32-x64'), false);
    assert.equal(exists(root, 'node-pty/prebuilds/linux-x64'), false);
    assert.equal(exists(root, 'dsh-better-sidebar/node_modules/node-pty'), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('darwin-universal 同时保留 darwin-arm64 与 darwin-x64 prebuilds', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-prune-'));
  try {
    writePackage(path.join(root, 'node-pty'), 'node-pty', '1.1.0');
    writePrebuild(path.join(root, 'node-pty'), 'darwin-arm64', 'pty.node');
    writePrebuild(path.join(root, 'node-pty'), 'darwin-x64', 'pty.node');
    writePrebuild(path.join(root, 'node-pty'), 'win32-x64', 'conpty.exe');
    prunePackagedProfileClosure(root, { os: 'darwin', architectures: ['arm64', 'x64'] });
    assert.equal(exists(root, 'node-pty/prebuilds/darwin-arm64/pty.node'), true);
    assert.equal(exists(root, 'node-pty/prebuilds/darwin-x64/pty.node'), true);
    assert.equal(exists(root, 'node-pty/prebuilds/win32-x64'), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('嵌套 node-pty 版本不同时两份都保留并各自裁剪 prebuilds', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-prune-'));
  try {
    writePackage(path.join(root, 'node-pty'), 'node-pty', '1.1.0');
    writePrebuild(path.join(root, 'node-pty'), 'darwin-arm64', 'pty.node');
    writePrebuild(path.join(root, 'node-pty'), 'win32-x64', 'conpty.exe');
    const nested = path.join(root, 'other-plugin', 'node_modules', 'node-pty');
    writePackage(nested, 'node-pty', '1.0.0');
    writePrebuild(nested, 'darwin-arm64', 'pty.node');
    writePrebuild(nested, 'linux-x64', 'pty.node');
    prunePackagedProfileClosure(root, { os: 'darwin', architectures: ['arm64'] });
    assert.equal(exists(root, 'node-pty/package.json'), true);
    assert.equal(exists(root, 'other-plugin/node_modules/node-pty/package.json'), true);
    assert.equal(exists(root, 'other-plugin/node_modules/node-pty/prebuilds/darwin-arm64/pty.node'), true);
    assert.equal(exists(root, 'other-plugin/node_modules/node-pty/prebuilds/linux-x64'), false);
    assert.equal(exists(root, 'node-pty/prebuilds/win32-x64'), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('linux-x64 仅有 build/Release 时通过，并删除异架构 prebuilds', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-prune-'));
  try {
    writePackage(path.join(root, 'node-pty'), 'node-pty', '1.1.0');
    writeFile(path.join(root, 'node-pty', 'build', 'Release', 'pty.node'));
    writePrebuild(path.join(root, 'node-pty'), 'win32-x64', 'conpty.exe');
    writePrebuild(path.join(root, 'node-pty'), 'darwin-arm64', 'pty.node');
    prunePackagedProfileClosure(root, { os: 'linux', architectures: ['x64'] });
    assert.equal(exists(root, 'node-pty/build/Release/pty.node'), true);
    assert.equal(exists(root, 'node-pty/prebuilds/win32-x64'), false);
    assert.equal(exists(root, 'node-pty/prebuilds/darwin-arm64'), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('当前目标没有任何 node-pty prebuild 时失败', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-prune-'));
  try {
    writePackage(path.join(root, 'node-pty'), 'node-pty', '1.1.0');
    writePrebuild(path.join(root, 'node-pty'), 'win32-x64', 'conpty.exe');
    assert.throws(
      () => prunePackagedProfileClosure(root, { os: 'darwin', architectures: ['arm64'] }),
      (error: unknown) => error instanceof ForgeError && error.code === 'PACKAGE_PROFILE_PTY_PREBUILD_MISSING',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('没有 node-pty 的闭包仍可裁剪文档文件', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-prune-'));
  try {
    writePackage(path.join(root, 'yaml'), 'yaml', '2.9.0');
    writeFile(path.join(root, 'yaml', 'README.md'), '# yaml');
    prunePackagedProfileClosure(root, { os: 'darwin', architectures: ['arm64'] });
    assert.equal(exists(root, 'yaml/package.json'), true);
    assert.equal(exists(root, 'yaml/README.md'), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
