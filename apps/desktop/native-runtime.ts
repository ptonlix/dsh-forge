import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { createSecureWindowFactory } from './platform/electron-window.ts';

/** Electron 对 DSH launcher 提供的内部能力；不从公开 desktop-services exports 暴露。 */
export interface DesktopRuntime {
  readonly acquired: boolean;
  readonly userDataPath: string;
  setSecondInstanceHandler(handler: () => void): void;
  createWindowFactory(options: {
    readonly preload: string;
    readonly icon: string;
    readonly deadlineMs: number;
    readonly onClose: (event: { preventDefault(): void }, window: BrowserWindow) => void;
  }): ReturnType<typeof createSecureWindowFactory>;
  confirmFullPackageUpgrade(update: { readonly version: string; readonly build: number }): Promise<boolean>;
  confirmStorageCacheClean(): Promise<boolean>;
  confirmStorageSessionsClean(): Promise<boolean>;
  openExternal(url: string): Promise<void>;
  exit(code: number): void;
}

/** 创建 Electron adapter；必须在 Host generation 启动前申请单实例锁。 */
export function createElectronRuntime(): DesktopRuntime {
  const acquired = app.requestSingleInstanceLock();
  let secondInstanceHandler = (): void => {};
  if (acquired) app.on('second-instance', () => secondInstanceHandler());
  return Object.freeze({
    acquired,
    userDataPath: app.getPath('userData'),
    setSecondInstanceHandler(handler: () => void): void {
      secondInstanceHandler = handler;
    },
    createWindowFactory: (options: {
      readonly preload: string;
      readonly icon: string;
      readonly deadlineMs: number;
      readonly onClose: (event: { preventDefault(): void }, window: BrowserWindow) => void;
    }) => createSecureWindowFactory({ ...options, ipcMain, shell }),
    async confirmFullPackageUpgrade(update: { readonly version: string; readonly build: number }): Promise<boolean> {
      const result = await dialog.showMessageBox({
        type: 'info',
        buttons: ['立即升级', '暂不升级'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
        title: '发现新版本',
        message: `可升级到 ${update.version}（build ${update.build}）`,
      });
      return result.response === 0;
    },
    async confirmStorageCacheClean(): Promise<boolean> {
      const result = await dialog.showMessageBox({
        type: 'warning',
        buttons: ['清理缓存', '暂不清理'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
        title: '清理缓存',
        message: '将删除可重建的投影缓存、Electron 缓存和 OTA 暂存残留。',
        detail: '清理不影响会话正文、凭据或当前受管 profile。',
      });
      return result.response === 0;
    },
    async confirmStorageSessionsClean(): Promise<boolean> {
      const result = await dialog.showMessageBox({
        type: 'warning',
        buttons: ['删除会话数据', '暂不删除'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
        title: '删除会话数据',
        message: '将删除 DSH Home 中的会话记录正文。',
        detail: 'DSH Home 可能与 CLI 或其他 DSH 进程共享，删除后无法从本页恢复；凭据和当前受管 profile 不受影响。',
      });
      return result.response === 0;
    },
    openExternal: (url: string) => shell.openExternal(url),
    exit: (code: number) => app.exit(code),
  });
}
