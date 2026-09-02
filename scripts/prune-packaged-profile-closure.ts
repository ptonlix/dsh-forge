import * as fs from 'node:fs';
import * as path from 'node:path';
import { fail } from '@dsh-forge/profile-toolchain/core/errors';
import type { Architecture, Platform } from '@dsh-forge/profile-toolchain/schema';

/** 打包目标的 os/arch，与 native rebuild 使用同一组事实。 */
export interface ProfileClosurePruneTarget {
  readonly os: Platform;
  readonly architectures: readonly Architecture[];
}

const LICENSE_NAMES = new Set([
  'license',
  'licence',
  'copying',
  'license.md',
  'licence.md',
  'copying.md',
  'license.txt',
  'licence.txt',
  'copying.txt',
]);

interface PackageIdentity {
  readonly name: string;
  readonly version: string;
}

function isLicenseFile(name: string): boolean {
  return LICENSE_NAMES.has(name.toLowerCase());
}

function isMarkdownFile(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith('.md') || lower.endsWith('.markdown');
}

function allowedPrebuildDirectoryNames(target: ProfileClosurePruneTarget): ReadonlySet<string> {
  return new Set(target.architectures.map((architecture) => `${target.os}-${architecture}`));
}

function readPackageIdentity(directory: string): PackageIdentity | null {
  const manifestFile = path.join(directory, 'package.json');
  if (!fs.existsSync(manifestFile) || !fs.statSync(manifestFile).isFile()) return null;
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')) as { name?: unknown; version?: unknown };
  if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') return null;
  return { name: manifest.name, version: manifest.version };
}

/** 收集闭包中每一份 node-pty 包目录，包含 hoist 与嵌套副本。 */
export function nodePtyPackageDirectories(nodeModules: string): string[] {
  const result: string[] = [];
  const visited = new Set<string>();
  const walk = (directory: string): void => {
    let real: string;
    try {
      real = fs.realpathSync(directory);
    } catch {
      return;
    }
    if (visited.has(real)) return;
    visited.add(real);
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(real, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const candidate = path.join(real, entry.name);
      if (entry.name === 'node-pty' && fs.existsSync(path.join(candidate, 'package.json'))) result.push(candidate);
      if (entry.isDirectory() || entry.isSymbolicLink()) walk(candidate);
    }
  };
  walk(nodeModules);
  return [...new Set(result.map((directory) => fs.realpathSync(directory)))].sort();
}

function pruneDebugAndDocs(directory: string): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory() || entry.isSymbolicLink()) {
      if (entry.name === 'demo') {
        fs.rmSync(target, { recursive: true, force: true });
        continue;
      }
      pruneDebugAndDocs(target);
      continue;
    }
    if (!entry.isFile()) continue;
    if (entry.name.endsWith('.map') || entry.name.endsWith('.pdb')) {
      fs.rmSync(target, { force: true });
      continue;
    }
    if (isMarkdownFile(entry.name) && !isLicenseFile(entry.name)) fs.rmSync(target, { force: true });
  }
}

function pruneNodePtyPrebuilds(directory: string, allowed: ReadonlySet<string>): void {
  const prebuilds = path.join(directory, 'prebuilds');
  if (!fs.existsSync(prebuilds) || !fs.statSync(prebuilds).isDirectory()) return;
  for (const entry of fs.readdirSync(prebuilds, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (allowed.has(entry.name)) continue;
    fs.rmSync(path.join(prebuilds, entry.name), { recursive: true, force: true });
  }
}

function hasAllowedPrebuild(directory: string, allowed: ReadonlySet<string>): boolean {
  const prebuilds = path.join(directory, 'prebuilds');
  if (!fs.existsSync(prebuilds) || !fs.statSync(prebuilds).isDirectory()) return false;
  return [...allowed].some((name) => {
    const candidate = path.join(prebuilds, name);
    return fs.existsSync(candidate) && fs.statSync(candidate).isDirectory();
  });
}

function removeDuplicateNestedNodePty(nodeModules: string): void {
  const hoisted = path.join(nodeModules, 'node-pty');
  const hoistedIdentity = readPackageIdentity(hoisted);
  if (!hoistedIdentity || hoistedIdentity.name !== 'node-pty') return;
  const hoistedReal = fs.realpathSync(hoisted);
  for (const directory of nodePtyPackageDirectories(nodeModules)) {
    if (directory === hoistedReal) continue;
    const identity = readPackageIdentity(directory);
    if (!identity || identity.name !== hoistedIdentity.name || identity.version !== hoistedIdentity.version) continue;
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

/**
 * 按打包目标删除 profile 闭包中的非运行时文件。
 * 调用方必须在复制完成之后、扫描 native 清单之前执行。
 */
export function prunePackagedProfileClosure(nodeModules: string, target: ProfileClosurePruneTarget): void {
  if (!fs.existsSync(nodeModules) || !fs.statSync(nodeModules).isDirectory())
    fail('打包 profile 缺少 node_modules 闭包', 'PACKAGE_PROFILE_CLOSURE_MISSING');
  pruneDebugAndDocs(nodeModules);
  removeDuplicateNestedNodePty(nodeModules);
  const allowed = allowedPrebuildDirectoryNames(target);
  for (const directory of nodePtyPackageDirectories(nodeModules)) {
    pruneNodePtyPrebuilds(directory, allowed);
    if (!hasAllowedPrebuild(directory, allowed))
      fail(
        `最终应用缺少当前目标的 node-pty prebuild: ${[...allowed].join(',')}`,
        'PACKAGE_PROFILE_PTY_PREBUILD_MISSING',
        { directory, allowed: [...allowed] },
      );
  }
}
