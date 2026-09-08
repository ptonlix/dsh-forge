/* desktop layer 的固定 Remote 面；仅传输状态结果，不暴露安装包或路径事实。 */
import { STORAGE_TYPERT_REMOTE } from './storage-remote-contract.js';
import { TYPERT_REMOTE } from './upgrade-remote-contract.js';

export {
  STORAGE_TYPERT_REMOTE,
  storageSnapshotSchema,
} from './storage-remote-contract.js';
export type {
  StorageRemoteContribution,
  StorageRemoteDescriptor,
  StorageRemoteMethod,
  StorageSnapshot,
  StorageSnapshotPhase,
  StorageSnapshotSchema,
  StorageVolumeUsage,
} from './storage-remote-contract.js';

export {
  TYPERT_REMOTE,
  upgradeStatusSchema,
} from './upgrade-remote-contract.js';
export type {
  UpgradePhase,
  UpgradeRemoteContribution,
  UpgradeRemoteDescriptor,
  UpgradeRemoteMethod,
  UpgradeStatus,
  UpgradeStatusSchema,
  UpgradeSupport,
  UpgradeVersion,
} from './upgrade-remote-contract.js';

/**
 * Typert 以 package 名为 Remote 贡献身份，同一包只能 `$mount` 一次。
 * 升级与存储方法必须出现在这一份 descriptors 里，不能分成两次注册。
 */
export const DESKTOP_LAYER_TYPERT_REMOTE = Object.freeze({
  package: '@dsh-forge/desktop-layer' as const,
  descriptors: Object.freeze([
    ...TYPERT_REMOTE.descriptors,
    ...STORAGE_TYPERT_REMOTE.descriptors,
  ]),
});

export type DesktopLayerRemoteContribution = typeof DESKTOP_LAYER_TYPERT_REMOTE;

export default DESKTOP_LAYER_TYPERT_REMOTE;
