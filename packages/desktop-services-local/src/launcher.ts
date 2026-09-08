import type { DesktopProfileSummary } from '@dsh-forge/desktop-services';
import type { CatalogEntry } from '@dsh-forge/profile-toolchain/schema';
import type {
  DesktopHostCapability,
  GenerationLike,
  ProfileManager,
  ProfileMutationHooks,
  SpawnFunction,
  StorageManagerCapability,
  StorageSnapshot,
  UpgradeManagerCapability,
} from './types.ts';

export {
  createFullPackageUpdater,
  FULL_PACKAGE_UPDATE_MANIFEST_URL,
  parseFullPackageVersionManifest,
  readDshForgeBuild,
  type FullPackageUpdate,
  type FullPackageUpdateCheck,
  type FullPackageDownloadOptions,
  type FullPackageDownloadProgress,
  type FullPackageUpdatePlatform,
  type FullPackageUpdater,
  type FullPackageUpdaterOptions,
} from './full-package-ota.ts';

export type {
  DesktopHostCapability,
  StorageManagerCapability,
  StorageSnapshot,
  StorageSnapshotPhase,
  StorageVolumeUsage,
  UpgradeDownloadProgress,
  UpgradeManagerCapability,
  UpgradeManagerStatus,
} from './types.ts';

export interface DesktopHostCapabilityOptions extends ProfileMutationHooks {
  readonly generation: GenerationLike;
  readonly profileDir: string;
  readonly profiles: readonly DesktopProfileSummary[];
  readonly manager: ProfileManager;
  readonly catalog: readonly CatalogEntry[];
  readonly pnpm?: string;
  readonly pnpmArgs?: readonly string[];
  readonly pnpmEnv?: NodeJS.ProcessEnv;
  readonly transactionDir?: string;
  readonly spawn?: SpawnFunction;
  readonly initializeProfile?: (profileDir: string) => void;
  /** 未配置时使用不可用快照；真实 launcher 会注入 generation-owned coordinator。 */
  readonly upgradeManager?: UpgradeManagerCapability;
  /** 未配置时使用不扫描、不可清理的安全快照；真实 launcher 会注入 storage coordinator。 */
  readonly storageManager?: StorageManagerCapability;
}

const unavailableUpgradeManager: UpgradeManagerCapability = Object.freeze({
  status: () =>
    Object.freeze({
      version: '0.0.0',
      build: null,
      support: 'unsupported',
      phase: 'unsupported',
      lastCheckedAt: null,
      available: null,
      download: null,
      errorCode: 'OTA_UNSUPPORTED',
    }),
  check: async () => unavailableUpgradeManager.status(),
  startUpgrade: async () => unavailableUpgradeManager.status(),
});

const unavailableStorageSnapshot: StorageSnapshot = Object.freeze({
  phase: 'error',
  cacheBytes: 0,
  sessionsBytes: 0,
  otherBytes: 0,
  appUsedBytes: 0,
  volume: null,
  userDataOnDifferentVolume: false,
  scannedAt: null,
  errorCode: 'STORAGE_UNAVAILABLE',
});

/**
 * 缺省存储能力：不扫描任何目录，也不清理任何文件；真实 launcher 总是注入
 * generation-owned StorageCoordinator，此缺省只服务测试与未接线的主机。
 */
const unavailableStorageManager: StorageManagerCapability = Object.freeze({
  status: () => unavailableStorageSnapshot,
  refresh: async () => unavailableStorageSnapshot,
  cleanCache: async () => unavailableStorageSnapshot,
  cleanSessions: async () => unavailableStorageSnapshot,
});

/**
 * 仅 launcher 使用的 capability factory。它保存 Host 已验证事实，不能由 Cordis
 * consumer 或第三方插件导入；provider 负责把这些事实转换为公开 service。
 */
export function createDesktopHostCapability(options: DesktopHostCapabilityOptions): DesktopHostCapability {
  return Object.freeze({
    generation: options.generation,
    profileDir: options.profileDir,
    profiles: options.profiles.map((profile) =>
      Object.freeze({ ...profile, bundles: Object.freeze([...profile.bundles]) }),
    ),
    manager: options.manager,
    catalog: options.catalog.map((entry) => Object.freeze(JSON.parse(JSON.stringify(entry)) as CatalogEntry)),
    pnpm: options.pnpm || 'pnpm',
    pnpmArgs: Object.freeze([...(options.pnpmArgs || [])]),
    pnpmEnv: Object.freeze({ ...options.pnpmEnv }),
    transactionDir: options.transactionDir,
    spawn: options.spawn,
    initializeProfile: options.initializeProfile,
    upgradeManager: options.upgradeManager || unavailableUpgradeManager,
    storageManager: options.storageManager || unavailableStorageManager,
    reconcile: options.reconcile,
    verifyNextGeneration: options.verifyNextGeneration,
  });
}
