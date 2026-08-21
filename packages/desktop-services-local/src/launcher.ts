import type { DesktopProfileSummary } from '@dsh-forge/desktop-services';
import type { CatalogEntry } from '@dsh-forge/profile-toolchain/schema';
import type { DesktopHostCapability, GenerationLike, ProfileManager, ProfileMutationHooks, SpawnFunction } from './types.ts';

export type { DesktopHostCapability } from './types.ts';

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
}

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
    reconcile: options.reconcile,
    verifyNextGeneration: options.verifyNextGeneration,
  });
}
