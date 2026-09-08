import type { DesktopProfileSummary, DesktopPnpmResult } from '@dsh-forge/desktop-services';
import type { CatalogEntry } from '@dsh-forge/profile-toolchain/schema';
import type { Readable } from 'node:stream';

/** launcher generation 只暴露 provider 必需的生命周期事实。 */
export interface GenerationLike {
  readonly id: string;
  readonly profile: string;
  readonly stage: string;
  readonly closed: boolean;
}

/** 升级管理页可读取的下载进度；不包含下载地址或暂存文件位置。 */
export interface UpgradeDownloadProgress {
  readonly receivedBytes: number;
  readonly totalBytes: number | null;
  readonly percent: number | null;
}

/** 升级管理页可读取的主进程快照；绝不向 Host 或 renderer 泄露安装包位置。 */
export interface UpgradeManagerStatus {
  readonly version: string;
  readonly build: number | null;
  readonly support: 'supported' | 'unsupported';
  readonly phase: 'idle' | 'checking' | 'available' | 'current' | 'downloading' | 'preparing' | 'error' | 'unsupported';
  readonly lastCheckedAt: string | null;
  readonly available: Readonly<{ readonly version: string; readonly build: number }> | null;
  readonly download: UpgradeDownloadProgress | null;
  readonly errorCode: string | null;
}

/** 仅 desktop layer 的 Remote gateway 使用的私有主进程能力。 */
export interface UpgradeManagerCapability {
  status(): UpgradeManagerStatus;
  check(): Promise<UpgradeManagerStatus>;
  startUpgrade(): Promise<UpgradeManagerStatus>;
}

/**
 * 存储快照阶段：`idle` 表示尚未扫描，`scanning` 表示扫描或清理进行中，
 * `ready` 表示快照可展示，`error` 表示快照不可信。
 */
export type StorageSnapshotPhase = 'idle' | 'scanning' | 'ready' | 'error';

/** DSH Home 所在卷的只读容量事实；不暴露卷标识、挂载点或设备号。 */
export interface StorageVolumeUsage {
  readonly totalBytes: number;
  readonly usedBytes: number;
  readonly freeBytes: number;
}

/**
 * 设置页「存储空间」可读取的主进程快照。只含字节与卷容量事实，
 * 绝不包含绝对路径、文件名列表、目录候选或 Electron 对象。
 */
export interface StorageSnapshot {
  readonly phase: StorageSnapshotPhase;
  /** 可从日志或其他权威数据重建的投影缓存、Electron 缓存与 OTA 暂存残留。 */
  readonly cacheBytes: number;
  /** DSH Home `sessions/` 下的会话正文。 */
  readonly sessionsBytes: number;
  /** 同一 DSH Home 与 `userData` 中的其余本应用管理数据。 */
  readonly otherBytes: number;
  /** 应用已用字节，恒等于三类字节之和。 */
  readonly appUsedBytes: number;
  /** DSH Home 所在卷容量；读取失败或不可用时为 null。 */
  readonly volume: StorageVolumeUsage | null;
  /** `userData` 与 DSH Home 不在同一卷时为 true；占比仍以 DSH Home 所在卷为准。 */
  readonly userDataOnDifferentVolume: boolean;
  readonly scannedAt: string | null;
  readonly errorCode: string | null;
}

/** 仅 desktop layer 的 Remote gateway 使用的私有主进程能力。 */
export interface StorageManagerCapability {
  /** 返回最近一次快照；不会因此触发磁盘遍历。 */
  status(): StorageSnapshot;
  /** 按需重新扫描固定根目录；同一 generation 同时最多一项扫描或清理。 */
  refresh(): Promise<StorageSnapshot>;
  /** 原生确认后清理允许清单内的缓存与 OTA 暂存残留，返回新快照。 */
  cleanCache(): Promise<StorageSnapshot>;
  /** 原生确认后清理 DSH Home 会话正文，返回新快照。 */
  cleanSessions(): Promise<StorageSnapshot>;
}

/** provider 用于持久化 profile 选择的最小 launcher 接口。 */
export interface ProfileManager {
  select(profile: string): Promise<GenerationLike>;
}

export interface ProcessOperation {
  readonly stdout: Readable;
  readonly stderr: Readable;
  readonly done: Promise<Readonly<DesktopPnpmResult>>;
  cancel(): Promise<void>;
}

export interface SpawnOptions {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly signal?: AbortSignal;
}

export type SpawnFunction = (command: string, args: readonly string[], options: SpawnOptions) => ProcessOperation;

export interface ProfileMutationHooks {
  /** pnpm 成功后让 launcher 刷新受管 profile 的解析事实。 */
  reconcile(): void | Promise<void>;
  /** 在 receipt 提交前验证下一 generation 能以新 profile 成功启动。 */
  verifyNextGeneration(): boolean | Promise<boolean>;
}

export interface DesktopHostCapability extends ProfileMutationHooks {
  readonly generation: GenerationLike;
  readonly profileDir: string;
  readonly profiles: readonly DesktopProfileSummary[];
  readonly manager: ProfileManager;
  readonly catalog: readonly CatalogEntry[];
  readonly pnpm: string;
  readonly pnpmArgs: readonly string[];
  readonly pnpmEnv: NodeJS.ProcessEnv;
  readonly transactionDir?: string;
  readonly spawn?: SpawnFunction;
  readonly initializeProfile?: (profileDir: string) => void;
  readonly upgradeManager: UpgradeManagerCapability;
  readonly storageManager: StorageManagerCapability;
}

export interface ProtectedProfileSnapshot {
  readonly 'package.json': string | null;
  readonly 'pnpm-lock.yaml': string | null;
  readonly 'pnpm-workspace.yaml': string | null;
}

export interface RecoveryFact {
  readonly recovered: boolean;
  readonly manualRecovery: boolean;
  readonly reason: string | null;
}

export interface ResolvedInstallFact {
  readonly packageName: string;
  readonly version: string;
  readonly source: Readonly<Record<string, unknown>>;
  readonly integrity?: string;
}
