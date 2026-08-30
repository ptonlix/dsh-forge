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

/** 升级管理页可读取的主进程快照；绝不向 Host 或 renderer 泄露安装包位置。 */
export interface UpgradeManagerStatus {
  readonly version: string;
  readonly build: number | null;
  readonly support: 'supported' | 'unsupported';
  readonly phase: 'idle' | 'checking' | 'available' | 'current' | 'preparing' | 'error' | 'unsupported';
  readonly lastCheckedAt: string | null;
  readonly available: Readonly<{ readonly version: string; readonly build: number }> | null;
  readonly errorCode: string | null;
}

/** 仅 desktop layer 的 Remote gateway 使用的私有主进程能力。 */
export interface UpgradeManagerCapability {
  status(): UpgradeManagerStatus;
  check(): Promise<UpgradeManagerStatus>;
  startUpgrade(): Promise<UpgradeManagerStatus>;
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
