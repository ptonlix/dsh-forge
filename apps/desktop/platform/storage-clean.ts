import * as fs from 'node:fs';
import * as path from 'node:path';
import { fail } from '../runtime/errors.ts';
import { ELECTRON_CACHE_DIRECTORY_NAMES, isSessionProjectionCacheEntry } from './storage-volume.ts';

export type StorageCleanKind = 'cache' | 'sessions';

/** 固定扫描根；清理目标只能从这两个根目录内产生。 */
export interface StorageCleanRoots {
  readonly dshHome: string;
  readonly userData: string;
}

/** OTA 下载中的受控暂存包名：`package-<uuid>.<平台扩展>`，未完成时为 `.partial`。 */
const OTA_STAGED_PACKAGE_PATTERN = new RegExp(
  '^package-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
    + '(\\.exe|\\.dmg|\\.AppImage)(\\.partial)?$',
  'i',
);
/** Windows helper 在暂存目录中等待 Electron 退出的受控 runner。 */
const OTA_WINDOWS_RUNNER_PATTERN = /^\.upgrade-[0-9a-f-]{36}\.cmd$/i;

function isDescendant(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return Boolean(relative) && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function regularEntries(directory: string): readonly string[] {
  try {
    return fs.readdirSync(directory, { withFileTypes: true }).map((entry) => entry.name);
  } catch {
    return [];
  }
}

function isSymlinkEntry(directory: string, name: string): boolean {
  try {
    return fs.lstatSync(path.join(directory, name)).isSymbolicLink();
  } catch {
    return false;
  }
}

function assertAbsoluteRoots(roots: StorageCleanRoots): void {
  if (!path.isAbsolute(roots.dshHome) || !path.isAbsolute(roots.userData))
    fail('存储清理根目录必须是绝对路径', 'STORAGE_CLEAN_NOT_ALLOWED');
}

/**
 * 计算某类清理的允许目标。只返回固定根目录内的普通文件或目录条目；
 * 符号链接从不作为清理目标。`cache` 不包含 `sessions/`、凭据、受管
 * profile 或 `other` 数据；`sessions` 只返回 DSH Home `sessions/` 的子条目。
 * `otaStagingBusy` 为 true 时跳过整个 OTA 暂存目录，避免与活动下载争抢文件。
 */
export function storageCleanTargets(
  roots: StorageCleanRoots,
  kind: StorageCleanKind,
  otaStagingBusy = false,
): readonly string[] {
  assertAbsoluteRoots(roots);
  if (kind === 'sessions') {
    return Object.freeze(
      regularEntries(path.join(roots.dshHome, 'sessions'))
        .filter((name) => !isSymlinkEntry(path.join(roots.dshHome, 'sessions'), name))
        .map((name) => path.join(roots.dshHome, 'sessions', name))
        .filter((target) => isDescendant(path.join(roots.dshHome, 'sessions'), target)),
    );
  }
  if (kind === 'cache') return Object.freeze(cacheTargets(roots, otaStagingBusy));
  fail(`不支持清理 ${kind} 数据`, 'STORAGE_CLEAN_NOT_ALLOWED');
}

function cacheTargets(roots: StorageCleanRoots, otaStagingBusy: boolean): readonly string[] {
  const targets: string[] = [];
  const homeStorages = path.join(roots.dshHome, 'storages');
  for (const name of regularEntries(homeStorages)) {
    if (!isSessionProjectionCacheEntry(name)) continue;
    if (isSymlinkEntry(homeStorages, name)) continue;
    targets.push(path.join(homeStorages, name));
  }
  for (const name of regularEntries(roots.userData)) {
    if (!ELECTRON_CACHE_DIRECTORY_NAMES.includes(name as (typeof ELECTRON_CACHE_DIRECTORY_NAMES)[number])) continue;
    if (isSymlinkEntry(roots.userData, name)) continue;
    targets.push(path.join(roots.userData, name));
  }
  if (!otaStagingBusy) {
    const otaStaging = path.join(roots.userData, 'dsh-forge', 'ota');
    for (const name of regularEntries(otaStaging)) {
      if (!OTA_STAGED_PACKAGE_PATTERN.test(name) && !OTA_WINDOWS_RUNNER_PATTERN.test(name)) continue;
      if (isSymlinkEntry(otaStaging, name)) continue;
      targets.push(path.join(otaStaging, name));
    }
  }
  return targets.filter((target) => isDescendant(path.resolve(roots.dshHome), target)
    || isDescendant(path.resolve(roots.userData), target));
}
