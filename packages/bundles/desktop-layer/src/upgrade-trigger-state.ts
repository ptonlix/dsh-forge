import type { UpgradeStatus } from './upgrade-remote-contract.js';

/** 只有带有完整候选版本的 available 快照才应显示入口提示。 */
export function shouldShowUpgradeBadge(snapshot: UpgradeStatus | null): boolean {
  return snapshot?.phase === 'available' && snapshot.available !== null;
}
