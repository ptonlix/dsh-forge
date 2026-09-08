import * as fs from 'node:fs';
import * as path from 'node:path';
import type {
  StorageManagerCapability,
  StorageSnapshot,
  StorageSnapshotPhase,
  StorageVolumeUsage,
} from '@dsh-forge/desktop-services-local/launcher';
import { fail } from '../runtime/errors.ts';
import { storageCleanTargets, type StorageCleanKind, type StorageCleanRoots } from './storage-clean.ts';
import {
  ELECTRON_CACHE_DIRECTORY_NAMES,
  directoriesShareVolume,
  isSessionProjectionCacheEntry,
  readVolumeUsage,
} from './storage-volume.ts';

/** 与 launcher 的 GenerationLike 同形的只读最小面；协调器只观察关闭状态。 */
export interface StorageGenerationLike {
  readonly id: string;
  readonly profile: string;
  readonly stage: string;
  readonly closed: boolean;
}

export interface StorageCoordinatorOptions {
  /** 当前 generation；关闭或释放时停止遍历与删除。 */
  readonly generation: StorageGenerationLike;
  /** 启动器已解析的 DSH Home；磁盘占比基准。 */
  readonly dshHome: string;
  /** Electron `userData`；缓存目录与 OTA 暂存都位于其下。 */
  readonly userData: string;
  /** 清理缓存前的原生确认；拒绝时不得改动磁盘。 */
  readonly confirmCacheClean: () => Promise<boolean>;
  /** 清理会话前的原生确认；文案必须包含共享 DSH Home 警告。 */
  readonly confirmSessionsClean: () => Promise<boolean>;
  /** OTA 正在下载或准备时返回 true，缓存清理跳过暂存目录。 */
  readonly otaStagingBusy?: () => boolean;
  /** 测试注入的卷容量事实；缺省读取 DSH Home 所在卷。 */
  readonly volumeFacts?: (directory: string) => StorageVolumeUsage | null;
  /** 测试注入的同卷判定；缺省比较设备号或盘符根。 */
  readonly sameVolume?: (left: string, right: string) => boolean;
}

interface ScanCounts {
  cacheBytes: number;
  sessionsBytes: number;
  otherBytes: number;
  incomplete: boolean;
}

const EMPTY_COUNTS: ScanCounts = Object.freeze({ cacheBytes: 0, sessionsBytes: 0, otherBytes: 0, incomplete: false });

/**
 * generation 所有的存储协调器：按固定根目录扫描、分类并执行允许清单内的
 * 清理。扫描与清理共享同一 lease，重复请求以 `STORAGE_BUSY` 失败；generation
 * 关闭或 dispose 会中止遍历与删除，迟到结果不得写回。
 */
export class StorageCoordinator implements StorageManagerCapability {
  private snapshot: StorageSnapshot;
  private busy: AbortController | null = null;
  private disposed = false;
  private readonly roots: StorageCleanRoots;
  private readonly volumeFacts: (directory: string) => StorageVolumeUsage | null;
  private readonly sameVolume: (left: string, right: string) => boolean;

  constructor(private readonly options: StorageCoordinatorOptions) {
    const dshHome = path.resolve(options.dshHome);
    const userData = path.resolve(options.userData);
    this.roots = Object.freeze({ dshHome, userData });
    this.volumeFacts = options.volumeFacts || readVolumeUsage;
    this.sameVolume = options.sameVolume || directoriesShareVolume;
    this.snapshot = this.buildSnapshot('idle', EMPTY_COUNTS, null, false, null, null);
  }

  status(): StorageSnapshot {
    return this.snapshot;
  }

  async refresh(): Promise<StorageSnapshot> {
    this.assertOpen();
    return this.withLease((signal) => this.scanIntoSnapshot(signal));
  }

  async cleanCache(): Promise<StorageSnapshot> {
    return this.clean('cache', this.options.confirmCacheClean);
  }

  async cleanSessions(): Promise<StorageSnapshot> {
    return this.clean('sessions', this.options.confirmSessionsClean);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.busy?.abort();
  }

  private clean(kind: StorageCleanKind, confirm: () => Promise<boolean>): Promise<StorageSnapshot> {
    this.assertOpen();
    return this.withLease(async (signal) => {
      const accepted = await confirm();
      this.assertNotAborted(signal);
      if (!accepted) return this.snapshot;
      const otaBusy = this.options.otaStagingBusy?.() === true;
      const targets = storageCleanTargets(this.roots, kind, otaBusy);
      let failed = 0;
      for (const target of targets) {
        this.assertNotAborted(signal);
        try {
          await fs.promises.rm(target, { recursive: true, force: true });
        } catch {
          failed += 1;
        }
      }
      const scanned = await this.scan(signal);
      const errorCode = failed > 0 ? 'STORAGE_CLEAN_INCOMPLETE' : scanned.errorCode;
      this.write({ ...scanned.snapshot, errorCode });
      return this.snapshot;
    });
  }

  /** 扫描并写回快照；中途取消或关闭时不产生新快照。 */
  private async scanIntoSnapshot(signal: AbortSignal): Promise<StorageSnapshot> {
    this.write({ ...this.snapshot, phase: 'scanning', errorCode: null });
    const outcome = await this.scan(signal);
    this.write(outcome.snapshot);
    return this.snapshot;
  }

  /** 固定根目录遍历与卷事实读取；只累加普通文件字节，符号链接不跟随。 */
  private async scan(signal: AbortSignal): Promise<{
    readonly snapshot: StorageSnapshot;
    readonly errorCode: string | null;
  }> {
    const counts: ScanCounts = { cacheBytes: 0, sessionsBytes: 0, otherBytes: 0, incomplete: false };
    await this.walkHome(counts, signal);
    await this.walkUserData(counts, signal);
    const volume = this.volumeFacts(this.roots.dshHome);
    const userDataOnDifferentVolume = !this.sameVolume(this.roots.dshHome, this.roots.userData);
    const errorCode = counts.incomplete ? 'STORAGE_SCAN_INCOMPLETE' : null;
    const snapshot = this.buildSnapshot(
      'ready',
      counts,
      volume,
      userDataOnDifferentVolume,
      this.options.generation.closed ? null : new Date().toISOString(),
      errorCode,
    );
    return { snapshot, errorCode };
  }

  /** 归类并遍历 DSH Home：`sessions/`、`storages/` 下的投影缓存及其余数据。 */
  private async walkHome(counts: ScanCounts, signal: AbortSignal): Promise<void> {
    const names = await this.list(this.roots.dshHome, counts);
    for (const name of names) {
      this.assertNotAborted(signal);
      const target = path.join(this.roots.dshHome, name);
      if (name === 'sessions') {
        await this.walkTree(target, counts, 'sessions', signal);
        continue;
      }
      if (name === 'storages') {
        await this.walkStorages(target, counts, signal);
        continue;
      }
      await this.walkTree(target, counts, 'other', signal);
    }
  }

  /** `storages/` 的子项按投影缓存名归类，其余域名存储归入 `other`。 */
  private async walkStorages(storages: string, counts: ScanCounts, signal: AbortSignal): Promise<void> {
    const names = await this.list(storages, counts);
    for (const name of names) {
      this.assertNotAborted(signal);
      const kind = isSessionProjectionCacheEntry(name) ? 'cache' : 'other';
      await this.walkTree(path.join(storages, name), counts, kind, signal);
    }
  }

  /** 归类并遍历 Electron `userData`：固定缓存目录、`dsh-forge/ota` 及其余数据。 */
  private async walkUserData(counts: ScanCounts, signal: AbortSignal): Promise<void> {
    const names = await this.list(this.roots.userData, counts);
    for (const name of names) {
      this.assertNotAborted(signal);
      const target = path.join(this.roots.userData, name);
      if (ELECTRON_CACHE_DIRECTORY_NAMES.includes(name as (typeof ELECTRON_CACHE_DIRECTORY_NAMES)[number])) {
        await this.walkTree(target, counts, 'cache', signal);
        continue;
      }
      if (name === 'dsh-forge') {
        await this.walkForgeState(target, counts, signal);
        continue;
      }
      await this.walkTree(target, counts, 'other', signal);
    }
  }

  /** `userData/dsh-forge` 下只有 `ota` 属于缓存，状态文件归入 `other`。 */
  private async walkForgeState(forge: string, counts: ScanCounts, signal: AbortSignal): Promise<void> {
    const names = await this.list(forge, counts);
    for (const name of names) {
      this.assertNotAborted(signal);
      const target = path.join(forge, name);
      const kind = name === 'ota' ? 'cache' : 'other';
      await this.walkTree(target, counts, kind, signal);
    }
  }

  /** 递归累加普通文件字节；不跟随符号链接；不可读子树跳过并标记不完整。 */
  private async walkTree(
    directory: string,
    counts: ScanCounts,
    kind: 'cache' | 'sessions' | 'other',
    signal: AbortSignal,
  ): Promise<void> {
    let stat: fs.Stats;
    try {
      stat = await fs.promises.lstat(directory);
    } catch {
      counts.incomplete = true;
      return;
    }
    if (stat.isSymbolicLink()) return;
    if (!stat.isDirectory()) {
      if (stat.isFile()) counts[kind === 'cache' ? 'cacheBytes' : kind === 'sessions' ? 'sessionsBytes' : 'otherBytes'] += stat.size;
      return;
    }
    const names = await this.list(directory, counts);
    for (const name of names) {
      this.assertNotAborted(signal);
      await this.walkTree(path.join(directory, name), counts, kind, signal);
    }
  }

  private async list(directory: string, counts: ScanCounts): Promise<readonly string[]> {
    try {
      return await fs.promises.readdir(directory);
    } catch {
      counts.incomplete = true;
      return [];
    }
  }

  private async withLease(operation: (signal: AbortSignal) => Promise<StorageSnapshot>): Promise<StorageSnapshot> {
    this.assertOpen();
    if (this.busy) fail('已有存储扫描或清理正在进行', 'STORAGE_BUSY');
    const controller = new AbortController();
    this.busy = controller;
    try {
      return await operation(controller.signal);
    } finally {
      if (this.busy === controller) this.busy = null;
    }
  }

  private assertOpen(): void {
    if (this.disposed || this.options.generation.closed)
      fail('generation 已关闭，不能扫描或清理存储', 'GENERATION_CLOSED');
  }

  private assertNotAborted(signal: AbortSignal): void {
    if (signal.aborted) fail('存储操作已取消', 'STORAGE_CANCELLED');
    if (this.disposed || this.options.generation.closed) {
      fail('generation 已关闭，存储操作已停止', 'GENERATION_CLOSED');
    }
  }

  /** 只写当前 generation 的快照；关闭后的迟到结果直接丢弃。 */
  private write(snapshot: StorageSnapshot): void {
    if (this.disposed || this.options.generation.closed) return;
    this.snapshot = snapshot;
  }

  private buildSnapshot(
    phase: StorageSnapshotPhase,
    counts: ScanCounts,
    volume: StorageVolumeUsage | null,
    userDataOnDifferentVolume: boolean,
    scannedAt: string | null,
    errorCode: string | null,
  ): StorageSnapshot {
    const appUsedBytes = counts.cacheBytes + counts.sessionsBytes + counts.otherBytes;
    return Object.freeze({
      phase,
      cacheBytes: counts.cacheBytes,
      sessionsBytes: counts.sessionsBytes,
      otherBytes: counts.otherBytes,
      appUsedBytes,
      volume,
      userDataOnDifferentVolume,
      scannedAt,
      errorCode,
    });
  }
}
