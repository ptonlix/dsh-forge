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

interface RendererBootReport {
  readonly promise: Promise<void>;
  readonly reject: (error: Error) => void;
}

export interface SecureWindowFactoryOptions {
  readonly BrowserWindowConstructor?: typeof ElectronBrowserWindow;
  readonly ipcMain: IpcMain;
  readonly shell: Shell;
  readonly preload: string;
  readonly icon: string;
  readonly deadlineMs: number;
  readonly onClose: (event: { preventDefault(): void }, window: BrowserWindow) => void;
}

function rendererReport(window: BrowserWindow, ipcMain: IpcMain, deadlineMs: number): RendererBootReport {
  let rejectReport: ((error: Error) => void) | null = null;
  const promise = new Promise<void>((resolve, reject) => {
    let settled = false;
    let didFinishLoad = false;
    const consoleMessages: string[] = [];
    const rememberConsoleMessage = (message: string): void => {
      if (consoleMessages.length >= 12 || consoleMessages.includes(message)) return;
      consoleMessages.push(message);
    };
    const diagnostic = (reason: string): Error => {
      const details = [`${reason}; did-finish-load=${didFinishLoad}`];
      if (consoleMessages.length) details.push(`console=${consoleMessages.join(' | ')}`);
      return new Error(details.join('; '));
    };
    const removeListeners = (): void => {
      ipcMain.removeListener('dsh-forge:renderer-boot', listener);
      window.webContents.removeListener('did-fail-load', didFailLoad);
      window.webContents.removeListener('preload-error', preloadError);
      window.webContents.removeListener('render-process-gone', renderProcessGone);
      window.webContents.removeListener('did-finish-load', didFinishLoadEvent);
      window.webContents.removeListener('console-message', consoleMessage);
      window.removeListener('closed', closed);
    };
    const finish =
      (callback: (value?: unknown) => void) =>
        (value?: unknown): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          removeListeners();
          callback(value);
        };
    const timer = setTimeout(
      () => finish(reject)(diagnostic('renderer boot report 超时')),
      deadlineMs,
    );
    const listener = (event: Electron.IpcMainEvent, report: unknown): void => {
      if (event.sender !== window.webContents) return;
      const record = typeof report === 'object' && report !== null ? (report as Record<string, unknown>) : {};
      if (record.status !== 'healthy')
        finish(reject)(diagnostic(typeof record.error === 'string' ? record.error : 'renderer boot report 失败'));
      else finish(() => resolve())();
    };
    const didFailLoad = (_event: Electron.Event, code: number, description: string): void => {
      finish(reject)(diagnostic(`renderer 加载失败: ${code} ${description}`));
    };
    const preloadError = (_event: Electron.Event, preloadPath: string, error: Error): void => {
      finish(reject)(diagnostic(`preload 加载失败: ${preloadPath}: ${error.message}`));
    };
    const renderProcessGone = (
      _event: Electron.Event,
      details: { readonly reason: string; readonly exitCode: number },
    ): void => {
      finish(reject)(diagnostic(`renderer 进程退出: reason=${details.reason} exitCode=${details.exitCode}`));
    };
    const didFinishLoadEvent = (): void => {
      didFinishLoad = true;
    };
    const consoleMessage = (
      _event: Electron.Event,
      level: number,
      message: string,
      line: number,
      sourceId: string,
    ): void => {
      if (level < 2) return;
      rememberConsoleMessage(`${sourceId}:${line}: ${message}`);
    };
    const closed = (): void => {
      finish(reject)(diagnostic('BrowserWindow 在 renderer boot report 前关闭'));
    };
    rejectReport = (error: Error): void => finish(reject)(error);
    ipcMain.on('dsh-forge:renderer-boot', listener);
    window.webContents.once('did-fail-load', didFailLoad);
    window.webContents.once('preload-error', preloadError);
    window.webContents.once('render-process-gone', renderProcessGone);
    window.webContents.on('did-finish-load', didFinishLoadEvent);
    window.webContents.on('console-message', consoleMessage);
    window.once('closed', closed);
  });
  return {
    promise,
    reject: (error) => rejectReport?.(error),
  };
}

/** 创建带 sandbox、导航白名单和外部链接处理的 BrowserWindow 工厂。 */
export function createSecureWindowFactory({
  BrowserWindowConstructor,
  ipcMain,
  shell,
  preload,
  icon,
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
      icon,
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
    window.on('close', (event) => onClose(event, window));
    // 必须在 loadURL 前注册监听；DOMContentLoaded 可能在 loadURL 返回前触发，
    // 延迟创建 Promise 会丢失 renderer 的唯一健康报告。
    const bootReport = rendererReport(window, ipcMain, deadlineMs);
    try {
      await window.loadURL(url);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      bootReport.reject(new Error(`renderer loadURL 失败: ${message}`));
      if (!window.isDestroyed()) window.destroy();
      await bootReport.promise.catch(() => undefined);
      throw error;
    }
    return Object.freeze({
      sandbox,
      contextIsolation,
      nodeIntegration,
      waitForBootReport: () => bootReport.promise,
      show: () => window.show(),
      hide: () => window.hide(),
      destroy: () => {
        if (!window.isDestroyed()) window.destroy();
      },
    });
  };
}
