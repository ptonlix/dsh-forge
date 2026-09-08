/** 存储空间 Remote 的共享运行时契约。Host 与 Client 产物都从这里生成。 */

export type StorageSnapshotPhase = 'idle' | 'scanning' | 'ready' | 'error';

export interface StorageVolumeUsage {
  readonly totalBytes: number;
  readonly usedBytes: number;
  readonly freeBytes: number;
}

/**
 * 设置页「存储空间」可展示的快照。只有字节、卷容量和阶段事实；
 * 任何绝对路径、文件名列表、目录候选或 Electron 对象都不属于该形状。
 */
export interface StorageSnapshot {
  readonly phase: StorageSnapshotPhase;
  readonly cacheBytes: number;
  readonly sessionsBytes: number;
  readonly otherBytes: number;
  readonly appUsedBytes: number;
  readonly volume: StorageVolumeUsage | null;
  readonly userDataOnDifferentVolume: boolean;
  readonly scannedAt: string | null;
  readonly errorCode: string | null;
}

export interface StorageSnapshotSchema {
  readonly parse: (value: unknown) => StorageSnapshot;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isSafeByteCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isStoragePhase(value: unknown): value is StorageSnapshotPhase {
  return value === 'idle' || value === 'scanning' || value === 'ready' || value === 'error';
}

const SNAPSHOT_KEYS = Object.freeze([
  'phase',
  'cacheBytes',
  'sessionsBytes',
  'otherBytes',
  'appUsedBytes',
  'volume',
  'userDataOnDifferentVolume',
  'scannedAt',
  'errorCode',
] as const);

const VOLUME_KEYS = Object.freeze(['totalBytes', 'usedBytes', 'freeBytes'] as const);

function assertOnlyKeys(value: Record<string, unknown>, keys: readonly string[], subject: string): void {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw new Error(`${subject}包含未知字段: ${key}`);
  }
}

function parseVolume(value: unknown): StorageVolumeUsage | null {
  if (value === null) return null;
  if (!isRecord(value)) throw new Error('存储卷容量不是对象');
  assertOnlyKeys(value, VOLUME_KEYS, '存储卷容量');
  for (const key of VOLUME_KEYS) {
    if (!isSafeByteCount(value[key])) throw new Error('存储卷容量字节无效');
  }
  return value as unknown as StorageVolumeUsage;
}

/** Remote 边界的轻量运行时校验，拒绝路径、文件名和 Electron 对象混入快照。 */
export const storageSnapshotSchema: StorageSnapshotSchema = Object.freeze({
  parse(value: unknown): StorageSnapshot {
    if (!isRecord(value)) throw new Error('存储快照不是对象');
    assertOnlyKeys(value, SNAPSHOT_KEYS, '存储快照');
    if (!isStoragePhase(value.phase)) throw new Error('存储快照阶段无效');
    for (const key of ['cacheBytes', 'sessionsBytes', 'otherBytes', 'appUsedBytes'] as const) {
      if (!isSafeByteCount(value[key])) throw new Error('存储快照字节无效');
    }
    if (typeof value.userDataOnDifferentVolume !== 'boolean') throw new Error('存储快照跨卷标记无效');
    if (value.scannedAt !== null && typeof value.scannedAt !== 'string') throw new Error('存储快照扫描时间无效');
    if (value.errorCode !== null && typeof value.errorCode !== 'string') throw new Error('存储快照错误代码无效');
    const volume = parseVolume(value.volume);
    const snapshot = {
      phase: value.phase as StorageSnapshotPhase,
      cacheBytes: value.cacheBytes as number,
      sessionsBytes: value.sessionsBytes as number,
      otherBytes: value.otherBytes as number,
      appUsedBytes: value.appUsedBytes as number,
      volume,
      userDataOnDifferentVolume: value.userDataOnDifferentVolume as boolean,
      scannedAt: value.scannedAt as string | null,
      errorCode: value.errorCode as string | null,
    };
    // 应用已用必须等于三类之和，防止任何单侧漂移投影出误导数字。
    if (snapshot.appUsedBytes !== snapshot.cacheBytes + snapshot.sessionsBytes + snapshot.otherBytes)
      throw new Error('存储快照分类之和与总量不一致');
    return Object.freeze(snapshot);
  },
});

export type StorageRemoteMethod = 'status' | 'refresh' | 'cleanCache' | 'cleanSessions';

export interface StorageRemoteDescriptor {
  readonly id: `@dsh-forge/desktop-layer#storageManager/${StorageRemoteMethod}`;
  readonly service: 'storageManager';
  readonly namespace: 'storageManager';
  readonly method: StorageRemoteMethod;
  readonly invocation: { readonly kind: 'direct' };
  readonly parameters: readonly [];
  readonly cancellation?: never;
  readonly result: {
    readonly mode: 'strict';
    readonly typeSymbol: '@dsh-forge/desktop-layer#StorageSnapshot';
    readonly schema: StorageSnapshotSchema;
  };
}

const descriptor = (method: StorageRemoteMethod): StorageRemoteDescriptor => Object.freeze({
  id: `@dsh-forge/desktop-layer#storageManager/${method}` as StorageRemoteDescriptor['id'],
  service: 'storageManager',
  namespace: 'storageManager',
  method,
  invocation: Object.freeze({ kind: 'direct' as const }),
  parameters: Object.freeze([]) as readonly [],
  result: Object.freeze({
    mode: 'strict' as const,
    typeSymbol: '@dsh-forge/desktop-layer#StorageSnapshot' as const,
    schema: storageSnapshotSchema,
  }),
});

export const STORAGE_TYPERT_REMOTE = Object.freeze({
  package: '@dsh-forge/desktop-layer' as const,
  descriptors: Object.freeze([
    descriptor('status'),
    descriptor('refresh'),
    descriptor('cleanCache'),
    descriptor('cleanSessions'),
  ]) as readonly StorageRemoteDescriptor[],
});

export type StorageRemoteContribution = typeof STORAGE_TYPERT_REMOTE;
