import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import type { IpcMain, Shell } from 'electron';
import { createSecureWindowFactory } from '../apps/desktop/platform/electron-window.ts';
import {
  decideWindowOpen,
  isAllowedLoopbackNavigation,
  loopbackAuthority,
} from '../apps/desktop/platform/navigation.ts';

describe('桌面 renderer 导航策略', () => {
  const authority = loopbackAuthority('http://127.0.0.1:39123/app');

  it('只允许当前 generation 的完整 loopback authority', () => {
    expect(isAllowedLoopbackNavigation('http://127.0.0.1:39123/other', authority)).toBe(true);
    expect(isAllowedLoopbackNavigation('http://127.0.0.1:39124/other', authority)).toBe(false);
    expect(isAllowedLoopbackNavigation('https://127.0.0.1:39123/other', authority)).toBe(false);
    expect(isAllowedLoopbackNavigation('http://localhost:39123/other', authority)).toBe(false);
  });

  it('外部 HTTP、HTTPS 和 mail 只交给系统处理程序', () => {
    expect(decideWindowOpen('https://example.com', authority)).toEqual({
      action: 'external',
      url: 'https://example.com',
    });
    expect(decideWindowOpen('mailto:user@example.com', authority)).toEqual({
      action: 'external',
      url: 'mailto:user@example.com',
    });
    expect(decideWindowOpen('file:///tmp/secret', authority)).toEqual({ action: 'deny' });
    expect(decideWindowOpen('http://127.0.0.1:39123/app', authority)).toEqual({ action: 'deny' });
  });

  it('真实窗口适配器固定安全偏好并拦截导航与新窗口', async () => {
    const opened: string[] = [];
    const ipc = new EventEmitter() as unknown as IpcMain;
    const shell = { openExternal: async (url: string) => opened.push(url) } as unknown as Shell;
    const windows: FakeWindow[] = [];
    const factory = createSecureWindowFactory({
      BrowserWindowConstructor: class extends FakeWindow {
        constructor(options: Record<string, unknown>) {
          super(options);
          windows.push(this);
        }
      } as unknown as typeof import('electron').BrowserWindow,
      ipcMain: ipc,
      shell,
      preload: '/tmp/preload.js',
      icon: '/tmp/dsh-forge-app-icon.png',
      deadlineMs: 100,
      onClose: (event) => event.preventDefault(),
    });
    await factory({
      url: 'http://127.0.0.1:39123/app',
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    });
    expect(windows[0]?.options.icon).toBe('/tmp/dsh-forge-app-icon.png');
    expect(windows[0]?.options.webPreferences).toEqual({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      preload: '/tmp/preload.js',
    });
    expect(windows[0]?.webContents.navigate('http://127.0.0.1:39124/blocked')).toBe(true);
    expect(windows[0]?.webContents.open('https://example.com')).toEqual({ action: 'deny' });
    await Promise.resolve();
    expect(opened).toEqual(['https://example.com']);
  });
});

class FakeWebContents {
  private navigation: ((event: { preventDefault(): void }, url: string) => void) | null = null;
  private windowOpen: ((details: { url: string }) => { action: 'deny' }) | null = null;

  on(event: 'will-navigate', listener: (event: { preventDefault(): void }, url: string) => void): void {
    if (event === 'will-navigate') this.navigation = listener;
  }

  once(): void {}

  setWindowOpenHandler(listener: (details: { url: string }) => { action: 'deny' }): void {
    this.windowOpen = listener;
  }

  navigate(url: string): boolean {
    let prevented = false;
    this.navigation?.({ preventDefault: () => (prevented = true) }, url);
    return prevented;
  }

  open(url: string): { action: 'deny' } | null {
    return this.windowOpen?.({ url }) || null;
  }
}

class FakeWindow extends EventEmitter {
  readonly webContents = new FakeWebContents();
  readonly options: Record<string, unknown>;

  constructor(options: Record<string, unknown>) {
    super();
    this.options = options;
  }

  async loadURL(): Promise<void> {}
  show(): void {}
  hide(): void {}
  isDestroyed(): boolean {
    return false;
  }
  destroy(): void {}
}
