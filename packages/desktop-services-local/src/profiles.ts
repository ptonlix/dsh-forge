import {
  createDesktopProfileSnapshot,
  type DesktopProfileSelection,
  type DesktopProfileSummary,
  type DesktopProfiles,
} from '@dsh-forge/desktop-services';
import { fail } from './errors.ts';
import type { GenerationLike, ProfileManager } from './types.ts';

/** generation 绑定的 profile service；快照和列表不允许修改 launcher 内部状态。 */
export class DesktopProfilesProvider implements DesktopProfiles {
  readonly current: string | null;
  private readonly snapshots: readonly DesktopProfileSummary[];

  constructor(
    private readonly generation: GenerationLike,
    private readonly manager: ProfileManager,
    profiles: readonly DesktopProfileSummary[],
  ) {
    this.current = generation.profile || null;
    this.snapshots = profiles.map((profile) =>
      Object.freeze({ ...profile, bundles: Object.freeze([...profile.bundles]) }),
    );
  }

  snapshot() {
    this.assertOpen();
    return createDesktopProfileSnapshot(this.current, this.snapshots);
  }

  list(): readonly DesktopProfileSummary[] {
    this.assertOpen();
    return this.snapshots.map((profile) => Object.freeze({ ...profile, bundles: Object.freeze([...profile.bundles]) }));
  }

  async select(name: string): Promise<DesktopProfileSelection> {
    this.assertOpen();
    if (!/^[a-z][a-z0-9-]{1,63}$/.test(name)) fail(`profile 名称无效: ${name}`, 'SERVICE_ARGUMENT');
    const selected = await this.manager.select(name);
    return Object.freeze({
      id: selected.id,
      profile: selected.profile,
      stage: selected.stage,
      closed: selected.closed,
    });
  }

  private assertOpen(): void {
    if (this.generation.closed) fail('desktopProfiles generation 已关闭', 'GENERATION_CLOSED');
  }
}
