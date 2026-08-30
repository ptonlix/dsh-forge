import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import type { Context } from '@deepseek-ai/cordis';
import type { UpgradeManagerCapability } from './types.ts';

/**
 * desktop layer 唯一的升级 Remote。方法不接收 renderer 候选，所有安装事实仍由
 * 当前 generation 的 coordinator 和私有 provider 持有。
 */
export class UpgradeManagerGateway extends TypertRemoteService {
  static inject = ['dshForgeDesktopCapability'];

  constructor(ctx: Context) {
    super(ctx, 'upgradeManager');
  }

  @Remote('status')
  status(): ReturnType<UpgradeManagerCapability['status']> {
    return this.ctx.dshForgeDesktopCapability.upgradeManager.status();
  }

  @Remote('check')
  check(): ReturnType<UpgradeManagerCapability['check']> {
    return this.ctx.dshForgeDesktopCapability.upgradeManager.check();
  }

  @Remote('startUpgrade')
  startUpgrade(): ReturnType<UpgradeManagerCapability['startUpgrade']> {
    return this.ctx.dshForgeDesktopCapability.upgradeManager.startUpgrade();
  }
}

export default UpgradeManagerGateway;
