import { BrowserWindow as ElectronBrowserWindow, type BrowserWindow, type IpcMain, type Shell } from 'electron';
import { decideWindowOpen, isAllowedLoopbackNavigation, loopbackAuthority } from './navigation.ts';

interface RendererWindow {
  readonly sandbox: boolean;
  readonly contextIsolation: boolean;
  readonly nodeIntegration: boolean;
  waitForBootReport(): Promise<void>;
  show(): void;
  hide(): void;
  destroy(): void;
}

interface WindowFactoryOptions {
  readonly url: string;
  readonly sandbox: boolean;
  readonly contextIsolation: boolean;
  readonly nodeIntegration: boolean;
}

export interface SecureWindowFactoryOptions {
  readonly BrowserWindowConstructor?: typeof ElectronBrowserWindow;
  readonly ipcMain: IpcMain;
  readonly shell: Shell;
  readonly preload: string;
  readonly deadlineMs: number;
  readonly onClose: (event: { preventDefault(): void }, window: BrowserWindow) => void;
}

function rendererReport(window: BrowserWindow, ipcMain: IpcMain, deadlineMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish =
      (callback: (value?: unknown) => void) =>
        (value?: unknown): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          ipcMain.removeListener('dsh-forge:renderer-boot', listener);
          callback(value);
        };
    const timer = setTimeout(() => finish(reject)(new Error('renderer boot report 超时')), deadlineMs);
    const listener = (event: Electron.IpcMainEvent, report: unknown): void => {
      if (event.sender !== window.webContents) return;
      const record = typeof report === 'object' && report !== null ? (report as Record<string, unknown>) : {};
      if (record.status !== 'healthy')
        finish(reject)(new Error(typeof record.error === 'string' ? record.error : 'renderer boot report 失败'));
      else finish(() => resolve())();
    };
    ipcMain.on('dsh-forge:renderer-boot', listener);
    window.webContents.once('did-fail-load', (_event, code, description) =>
      finish(reject)(new Error(`renderer 加载失败: ${code} ${description}`)),
    );
  });
}

/** 创建带 sandbox、导航白名单和外部链接处理的 BrowserWindow 工厂。 */
export function createSecureWindowFactory({
  BrowserWindowConstructor,
  ipcMain,
  shell,
  preload,
  deadlineMs,
  onClose,
}: SecureWindowFactoryOptions): (options: WindowFactoryOptions) => Promise<RendererWindow> {
  const WindowConstructor = BrowserWindowConstructor || ElectronBrowserWindow;
  return async ({ url, sandbox, contextIsolation, nodeIntegration }) => {
    const authority = loopbackAuthority(url);
    const window = new WindowConstructor({
      width: 1280,
      height: 860,
      show: false,
      webPreferences: { sandbox, contextIsolation, nodeIntegration, preload },
    });
    window.webContents.on('will-navigate', (event, target) => {
      if (!isAllowedLoopbackNavigation(target, authority)) event.preventDefault();
    });
    window.webContents.setWindowOpenHandler(({ url: target }) => {
      const decision = decideWindowOpen(target, authority);
      if (decision.action === 'external' && decision.url) void shell.openExternal(decision.url);
      return { action: 'deny' };
    });
    window.on('closed', () => ipcMain.removeAllListeners('dsh-forge:renderer-boot'));
    window.on('close', (event) => onClose(event, window));
    // 必须在 loadURL 前注册监听；DOMContentLoaded 可能在 loadURL 返回前触发，
    // 延迟创建 Promise 会丢失 renderer 的唯一健康报告。
    const bootReport = rendererReport(window, ipcMain, deadlineMs);
    await window.loadURL(url);
    return Object.freeze({
      sandbox,
      contextIsolation,
      nodeIntegration,
      waitForBootReport: () => bootReport,
      show: () => window.show(),
      hide: () => window.hide(),
      destroy: () => {
        if (!window.isDestroyed()) window.destroy();
      },
    });
  };
}
