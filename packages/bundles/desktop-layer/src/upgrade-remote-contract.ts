/** 升级管理 Remote 的共享运行时契约。Host 与 Client 产物都从这里生成。 */

export type UpgradeSupport = 'supported' | 'unsupported';

export type UpgradePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'current'
  | 'downloading'
  | 'preparing'
  | 'error'
  | 'unsupported';

export interface UpgradeVersion {
  readonly version: string;
  readonly build: number;
}

export interface UpgradeDownloadProgress {
  readonly receivedBytes: number;
  readonly totalBytes: number | null;
  readonly percent: number | null;
}

export interface UpgradeStatus {
  readonly version: string;
  readonly build: number | null;
  readonly support: UpgradeSupport;
  readonly phase: UpgradePhase;
  readonly lastCheckedAt: string | null;
  readonly available: UpgradeVersion | null;
  readonly download: UpgradeDownloadProgress | null;
  readonly errorCode: string | null;
}

export interface UpgradeStatusSchema {
  readonly parse: (value: unknown) => UpgradeStatus;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isUpgradePhase(value: unknown): value is UpgradePhase {
  return value === 'idle'
    || value === 'checking'
    || value === 'available'
    || value === 'current'
    || value === 'downloading'
    || value === 'preparing'
    || value === 'error'
    || value === 'unsupported';
}

function isUpgradeVersion(value: unknown): value is UpgradeVersion {
  return isRecord(value)
    && typeof value.version === 'string'
    && typeof value.build === 'number';
}

function isDownloadProgress(value: unknown): value is UpgradeDownloadProgress {
  return isRecord(value)
    && typeof value.receivedBytes === 'number'
    && Number.isSafeInteger(value.receivedBytes)
    && value.receivedBytes >= 0
    && (value.totalBytes === null || (typeof value.totalBytes === 'number'
      && Number.isSafeInteger(value.totalBytes)
      && value.totalBytes > 0))
    && (value.percent === null || (typeof value.percent === 'number'
      && Number.isSafeInteger(value.percent)
      && value.percent >= 0
      && value.percent <= 100));
}

/** Remote 边界的轻量运行时校验，避免把安装路径或 Electron 对象带入 Client。 */
export const upgradeStatusSchema: UpgradeStatusSchema = Object.freeze({
  parse(value: unknown): UpgradeStatus {
    if (!isRecord(value)) throw new Error('升级状态不是对象');
    if (typeof value.version !== 'string' || (value.build !== null && typeof value.build !== 'number')) {
      throw new Error('升级状态版本字段无效');
    }
    if (value.support !== 'supported' && value.support !== 'unsupported') {
      throw new Error('升级状态支持字段无效');
    }
    if (!isUpgradePhase(value.phase)) throw new Error('升级状态阶段无效');
    if (value.lastCheckedAt !== null && typeof value.lastCheckedAt !== 'string') {
      throw new Error('升级状态检查时间无效');
    }
    if (value.available !== null && !isUpgradeVersion(value.available)) {
      throw new Error('升级状态候选版本无效');
    }
    if (value.download !== null && !isDownloadProgress(value.download)) {
      throw new Error('升级下载进度无效');
    }
    if (value.errorCode !== null && typeof value.errorCode !== 'string') {
      throw new Error('升级状态错误代码无效');
    }
    return value as unknown as UpgradeStatus;
  },
});

export type UpgradeRemoteMethod = 'status' | 'check' | 'startUpgrade';

export interface UpgradeRemoteDescriptor {
  readonly id: `@dsh-forge/desktop-layer#upgradeManager/${UpgradeRemoteMethod}`;
  readonly service: 'upgradeManager';
  readonly namespace: 'upgradeManager';
  readonly method: UpgradeRemoteMethod;
  readonly invocation: { readonly kind: 'direct' };
  readonly parameters: readonly [];
  readonly cancellation?: never;
  readonly result: {
    readonly mode: 'strict';
    readonly typeSymbol: '@dsh-forge/desktop-layer#UpgradeManagerStatus';
    readonly schema: UpgradeStatusSchema;
  };
}

const descriptor = (method: UpgradeRemoteMethod): UpgradeRemoteDescriptor => Object.freeze({
  id: `@dsh-forge/desktop-layer#upgradeManager/${method}` as UpgradeRemoteDescriptor['id'],
  service: 'upgradeManager',
  namespace: 'upgradeManager',
  method,
  invocation: Object.freeze({ kind: 'direct' as const }),
  parameters: Object.freeze([]) as readonly [],
  result: Object.freeze({
    mode: 'strict' as const,
    typeSymbol: '@dsh-forge/desktop-layer#UpgradeManagerStatus' as const,
    schema: upgradeStatusSchema,
  }),
});

export const TYPERT_REMOTE = Object.freeze({
  package: '@dsh-forge/desktop-layer' as const,
  descriptors: Object.freeze([
    descriptor('status'),
    descriptor('check'),
    descriptor('startUpgrade'),
  ]) as readonly UpgradeRemoteDescriptor[],
});

export type UpgradeRemoteContribution = typeof TYPERT_REMOTE;
