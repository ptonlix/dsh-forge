import * as fs from 'node:fs';
import * as path from 'node:path';
import type { StorageVolumeUsage } from '@dsh-forge/desktop-services-local/launcher';

/**
 * Electron 43 在 `userData` 下写入的稳定缓存目录。清理只允许按这些固定名字
 * 删除目录本体；其他 `userData` 内容一律归入 `other`，不作为可清理目标。
 */
export const ELECTRON_CACHE_DIRECTORY_NAMES = Object.freeze([
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
] as const);

/** `storages/` 下由启动器按身份字段隔离的投影缓存及不兼容残留前缀。 */
export function isSessionProjectionCacheEntry(name: string): boolean {
  return name === 'session_projcache' || name.startsWith('session_projcache.');
}

/**
 * 读取目录所在卷的容量事实；目录不存在或 `statfs` 不可用时返回 null。
 * 只取总数、可用数和由此推导的已用数，不暴露卷标识或挂载点。
 */
export function readVolumeUsage(directory: string): StorageVolumeUsage | null {
  try {
    const usage = fs.statfsSync(directory);
    const blockSize = usage.bsize > 0 ? usage.bsize : 512;
    const totalBytes = usage.blocks * blockSize;
    const freeBytes = usage.bavail * blockSize;
    const usedBytes = totalBytes - freeBytes;
    if (!Number.isSafeInteger(totalBytes) || !Number.isSafeInteger(freeBytes) || usedBytes < 0) return null;
    return Object.freeze({ totalBytes, usedBytes, freeBytes });
  } catch {
    return null;
  }
}

/**
 * 判断两个目录是否位于同一卷。POSIX 比较设备号；Windows 比较解析后的盘符根。
 * 无法判定时保守返回 true，避免把跨卷误报成同卷造成容量加总。
 */
export function directoriesShareVolume(left: string, right: string): boolean {
  const leftStat = statDevice(left);
  const rightStat = statDevice(right);
  if (leftStat !== null && rightStat !== null) {
    if (leftStat.device !== 0 && rightStat.device !== 0) return leftStat.device === rightStat.device;
  }
  if (process.platform === 'win32') {
    const leftRoot = path.parse(left).root.toLowerCase();
    const rightRoot = path.parse(right).root.toLowerCase();
    if (leftRoot && rightRoot) return leftRoot === rightRoot;
  }
  return true;
}

interface DeviceFact {
  readonly device: number;
}

function statDevice(directory: string): DeviceFact | null {
  try {
    const stat = fs.statSync(directory);
    return Object.freeze({ device: stat.dev });
  } catch {
    return null;
  }
}
