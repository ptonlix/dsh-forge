/* desktop layer 的固定 Remote 面；仅传输状态结果，不暴露安装包事实。 */
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

export { TYPERT_REMOTE as default } from './upgrade-remote-contract.js';
