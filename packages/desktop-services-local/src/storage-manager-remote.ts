import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import type { Context } from '@deepseek-ai/cordis';
import type { StorageManagerCapability } from './types.ts';

/**
 * desktop layer 唯一的存储 Remote。方法不接收路径、文件名或目录候选，
 * 所有扫描与删除事实仍由当前 generation 的 storage coordinator 持有。
 */
export class StorageManagerGateway extends TypertRemoteService {
  static inject = ['dshForgeDesktopCapability'];

  constructor(ctx: Context) {
    super(ctx, 'storageManager');
  }

  @Remote('status')
  status(): ReturnType<StorageManagerCapability['status']> {
    return this.ctx.dshForgeDesktopCapability.storageManager.status();
  }

  @Remote('refresh')
  refresh(): ReturnType<StorageManagerCapability['refresh']> {
    return this.ctx.dshForgeDesktopCapability.storageManager.refresh();
  }

  @Remote('cleanCache')
  cleanCache(): ReturnType<StorageManagerCapability['cleanCache']> {
    return this.ctx.dshForgeDesktopCapability.storageManager.cleanCache();
  }

  @Remote('cleanSessions')
  cleanSessions(): ReturnType<StorageManagerCapability['cleanSessions']> {
    return this.ctx.dshForgeDesktopCapability.storageManager.cleanSessions();
  }
}

export default StorageManagerGateway;
