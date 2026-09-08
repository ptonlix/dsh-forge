import {
  DESKTOP_LAYER_TYPERT_REMOTE,
  type DesktopLayerRemoteContribution,
} from './typert.remote-client.js';
import {
  type UpgradeStatus,
  type UpgradeVersion,
} from './upgrade-remote-contract.js';
import {
  storageSnapshotSchema,
  type StorageSnapshot,
} from './storage-remote-contract.js';
import { shouldShowUpgradeBadge } from './upgrade-trigger-state.js';

interface ReactRuntime {
  readonly Fragment: unknown;
  createElement(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): unknown;
  useState<T>(initial: T): [T, (next: T | ((current: T) => T)) => void];
  useCallback<T>(callback: T, dependencies: readonly unknown[]): T;
  useEffect(effect: () => void | (() => void), dependencies: readonly unknown[]): void;
}

interface PrimitiveExports {
  readonly Button: unknown;
  readonly StateDot: unknown;
  readonly IconSettingsOutline14: unknown;
  readonly IconSettingsOutline16: unknown;
}

interface UpgradeManagerApi {
  status(): Promise<unknown>;
  check(): Promise<unknown>;
  startUpgrade(): Promise<unknown>;
}

interface StorageManagerApi {
  status(): Promise<unknown>;
  refresh(): Promise<unknown>;
  cleanCache(): Promise<unknown>;
  cleanSessions(): Promise<unknown>;
}

interface RemoteRegistry {
  $mount(contribution: DesktopLayerRemoteContribution): Promise<() => Promise<void>>;
  readonly upgradeManager?: UpgradeManagerApi;
  readonly storageManager?: StorageManagerApi;
}

interface SlotComponentProps {
  readonly api?: UpgradeManagerApi;
  readonly wide?: boolean;
  readonly t?: (key: string) => string;
}

interface SlotRegistrationOptions {
  readonly name: string;
  readonly id?: string;
  readonly order?: number;
  readonly priority?: number;
  readonly label?: () => string;
  readonly locale?: string;
  readonly inject?: () => { readonly api?: unknown };
}

interface DesktopLayerContext {
  get<T>(key: string): T;
  effect(register: () => () => void, label: string): void;
  readonly slots: {
    inject(name: string, factory: () => unknown): void;
    register(options: SlotRegistrationOptions, component: (props: SlotComponentProps) => unknown): unknown;
  };
}

interface UpgradeSectionProps {
  readonly api?: UpgradeManagerApi;
}

interface ModuleLoader {
  load(config: {
    readonly id: string;
    readonly factory: (require: (id: string) => unknown) => unknown;
  }): void;
}

interface StyleElement {
  readonly dataset: Record<string, string>;
  textContent: string;
}

interface DomElementLike {
  readonly textContent: string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

interface DocumentLike {
  querySelector(selector: string): StyleElement | null;
  querySelectorAll(selector: string): readonly DomElementLike[];
  createElement(tagName: string): StyleElement;
  readonly head: { appendChild(element: StyleElement): void };
  readonly body: DomElementLike;
}

interface MutationObserverOptionsLike {
  readonly childList: boolean;
  readonly subtree: boolean;
  readonly characterData: boolean;
}

interface MutationObserverLike {
  observe(target: DomElementLike, options: MutationObserverOptionsLike): void;
  disconnect(): void;
}

declare global {
  interface Window {
    readonly __ModuleLoader__: ModuleLoader;
  }
}

declare const window: Window;
declare const document: DocumentLike;
declare const MutationObserver: new (callback: () => void) => MutationObserverLike;

window.__ModuleLoader__.load({
  id: '@dsh-forge/desktop-layer',
  factory: (require) => {
    const module = { exports: {} };
    const React = require('react') as ReactRuntime;
    const {
      Button,
      StateDot,
      IconSettingsOutline14,
      IconSettingsOutline16,
    } = require('@deepseek-ai/dsh-client-ui-primitives') as PrimitiveExports;
    const UPGRADE_NAV_ICON_MASK = [
      'url("data:image/svg+xml,',
      "%3Csvg xmlns='http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg' width='16'",
      " height='16' viewBox='0 0 16 16' fill='none'%3E",
      "%3Cpath d='M8 2a6 6 0 1 1-4.24 1.76L2 5.5",
      "M2 2v3.5h3.5' fill='none' stroke='black' stroke-width='1.5'",
      " stroke-linecap='round' stroke-linejoin='round'/%3E",
      '%3C/svg%3E")',
    ].join('');
    // 复用现有 Settings Row 的 spacing 和 theme token，选择器限定在升级页内容区。
    const upgradeSettingsCss = `
      [data-upgrade-settings] {
        max-width: 720px;
        color: var(--dsw-alias-label-primary);
        flex-direction: column;
        gap: 12px;
        display: flex;
      }
      [data-upgrade-settings] h2 {
        color: var(--dsw-alias-label-primary);
        margin: 0;
        font-size: 18px;
        font-weight: 600;
        line-height: 24px;
      }
      [data-upgrade-settings] [data-upgrade-intro] {
        color: var(--dsw-alias-label-tertiary);
        margin: 0;
        font-size: 13px;
        line-height: 20px;
      }
      [data-upgrade-settings] [data-upgrade-rows] {
        flex-direction: column;
        display: flex;
      }
      [data-upgrade-settings] [data-upgrade-row] {
        border-bottom: 1px solid var(--dsw-alias-border-l2);
        align-items: center;
        gap: 8px;
        padding: 16px 0;
        display: flex;
      }
      [data-upgrade-settings] [data-upgrade-row]:last-child {
        border-bottom: none;
      }
      [data-upgrade-settings] [data-upgrade-row-text] {
        flex-direction: column;
        flex: 1;
        gap: 4px;
        min-width: 0;
        padding-right: 48px;
        display: flex;
      }
      [data-upgrade-settings] [data-upgrade-title] {
        color: var(--dsw-alias-label-primary);
        font-size: 14px;
        font-weight: 400;
        line-height: 22px;
      }
      [data-upgrade-settings] [data-upgrade-desc] {
        color: var(--dsw-alias-label-tertiary);
        font-size: 12px;
        font-weight: 400;
        line-height: 18px;
      }
      [data-upgrade-settings] [data-upgrade-value] {
        flex: none;
        max-width: 52%;
        color: var(--dsw-alias-label-primary);
        text-align: right;
        flex-direction: column;
        align-items: flex-end;
        gap: 2px;
        font-size: 14px;
        line-height: 22px;
        display: flex;
      }
      [data-upgrade-settings] [data-upgrade-status] {
        align-items: center;
        gap: 6px;
        display: inline-flex;
      }
      [data-upgrade-settings] [data-upgrade-code] {
        color: var(--dsw-alias-label-tertiary);
        font-size: 12px;
        line-height: 18px;
      }
      [data-upgrade-settings] [data-upgrade-progress] {
        align-items: center;
        gap: 8px;
        min-width: 180px;
        display: inline-flex;
      }
      [data-upgrade-settings] [data-upgrade-progress] progress {
        accent-color: var(--dsw-alias-state-brand-primary, #2563eb);
        height: 6px;
        width: 120px;
      }
      [data-upgrade-settings] [data-upgrade-progress-text] {
        color: var(--dsw-alias-label-tertiary);
        font-size: 12px;
        line-height: 18px;
        min-width: 36px;
      }
      [data-upgrade-settings] [data-upgrade-inline-error] {
        color: var(--dsw-alias-state-error-primary);
        margin: -4px 0 0;
        font-size: 12px;
        line-height: 18px;
      }
      [data-upgrade-settings] [data-upgrade-loading] {
        color: var(--dsw-alias-label-tertiary);
        margin: 0;
        font-size: 13px;
        line-height: 20px;
      }
      [data-upgrade-trigger] {
        align-items: center;
        display: inline-flex;
        gap: 6px;
        min-width: 0;
      }
      [data-upgrade-trigger-label] {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      [data-upgrade-trigger-badge] {
        align-items: center;
        display: inline-flex;
        flex: none;
      }
      [data-dsh-forge-upgrade-nav] {
        align-items: center;
        gap: 6px;
      }
      [data-dsh-forge-upgrade-nav] > svg:first-child {
        display: none;
      }
      [data-dsh-forge-upgrade-nav]::before {
        background: currentColor;
        content: '';
        flex: none;
        height: 16px;
        width: 16px;
        -webkit-mask: ${UPGRADE_NAV_ICON_MASK} center / contain no-repeat;
        mask: ${UPGRADE_NAV_ICON_MASK} center / contain no-repeat;
      }
      [data-dsh-forge-upgrade-nav-badge]::after {
        background: var(--dsw-alias-state-warning-primary, #f79009);
        border-radius: 50%;
        content: '';
        display: inline-block;
        flex: none;
        height: 6px;
        width: 6px;
      }
      @media (max-width: 560px) {
        [data-upgrade-settings] [data-upgrade-row] {
          align-items: flex-start;
          flex-direction: column;
          gap: 8px;
        }
        [data-upgrade-settings] [data-upgrade-row-text] {
          padding-right: 0;
        }
        [data-upgrade-settings] [data-upgrade-value] {
          max-width: 100%;
          align-self: flex-end;
        }
      }
    `;
    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="dsh-forge-upgrade-settings"]') === null) {
      const tag = document.createElement('style');
      tag.dataset.plugin = '@dsh-forge/desktop-layer';
      tag.dataset.pluginCss = 'dsh-forge-upgrade-settings';
      tag.textContent = upgradeSettingsCss;
      document.head.appendChild(tag);
    }
    const storageSettingsCss = `
      [data-storage-settings] {
        max-width: 720px;
        color: var(--dsw-alias-label-primary);
        flex-direction: column;
        gap: 12px;
        display: flex;
      }
      [data-storage-settings] h2 {
        color: var(--dsw-alias-label-primary);
        margin: 0;
        font-size: 18px;
        font-weight: 600;
        line-height: 24px;
      }
      [data-storage-settings] [data-storage-intro] {
        color: var(--dsw-alias-label-tertiary);
        margin: 0;
        font-size: 13px;
        line-height: 20px;
      }
      [data-storage-settings] [data-storage-rows] {
        flex-direction: column;
        display: flex;
      }
      [data-storage-settings] [data-storage-row] {
        border-bottom: 1px solid var(--dsw-alias-border-l2);
        align-items: center;
        gap: 8px;
        padding: 16px 0;
        display: flex;
      }
      [data-storage-settings] [data-storage-row]:last-child {
        border-bottom: none;
      }
      [data-storage-settings] [data-storage-row-text] {
        flex-direction: column;
        flex: 1;
        gap: 4px;
        min-width: 0;
        padding-right: 48px;
        display: flex;
      }
      [data-storage-settings] [data-storage-title] {
        color: var(--dsw-alias-label-primary);
        font-size: 14px;
        font-weight: 400;
        line-height: 22px;
      }
      [data-storage-settings] [data-storage-desc] {
        color: var(--dsw-alias-label-tertiary);
        font-size: 12px;
        font-weight: 400;
        line-height: 18px;
      }
      [data-storage-settings] [data-storage-value] {
        flex: none;
        max-width: 52%;
        color: var(--dsw-alias-label-primary);
        text-align: right;
        flex-direction: column;
        align-items: flex-end;
        gap: 2px;
        font-size: 14px;
        line-height: 22px;
        display: flex;
      }
      [data-storage-settings] [data-storage-total-block] {
        gap: 8px;
        flex-direction: column;
        display: flex;
      }
      [data-storage-settings] [data-storage-bar] {
        background: var(--dsw-alias-border-l2, rgba(120, 120, 128, 0.25));
        border-radius: 999px;
        height: 8px;
        overflow: hidden;
        width: 100%;
        display: flex;
      }
      [data-storage-settings] [data-storage-bar-app] {
        background: var(--dsw-alias-state-brand-primary, #2563eb);
        border-radius: 999px 0 0 999px;
        height: 8px;
        flex: none;
      }
      [data-storage-settings] [data-storage-bar-other-used] {
        background: var(--dsw-alias-label-tertiary, #98a2b3);
        height: 8px;
        flex: none;
      }
      [data-storage-settings] [data-storage-bar-caption] {
        color: var(--dsw-alias-label-tertiary);
        margin: 0;
        font-size: 12px;
        line-height: 18px;
      }
      [data-storage-settings] [data-storage-loading] {
        color: var(--dsw-alias-label-tertiary);
        margin: 0;
        font-size: 13px;
        line-height: 20px;
      }
      [data-storage-settings] [data-storage-inline-error] {
        color: var(--dsw-alias-state-error-primary);
        margin: -4px 0 0;
        font-size: 12px;
        line-height: 18px;
      }
      [data-storage-settings] [data-storage-note] {
        color: var(--dsw-alias-state-warning-primary, #f79009);
        margin: -4px 0 0;
        font-size: 12px;
        line-height: 18px;
      }
      @media (max-width: 560px) {
        [data-storage-settings] [data-storage-row] {
          align-items: flex-start;
          flex-direction: column;
          gap: 8px;
        }
        [data-storage-settings] [data-storage-row-text] {
          padding-right: 0;
        }
        [data-storage-settings] [data-storage-value] {
          max-width: 100%;
          align-self: flex-end;
        }
      }
    `;
    if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="dsh-forge-storage-settings"]') === null) {
      const tag = document.createElement('style');
      tag.dataset.plugin = '@dsh-forge/desktop-layer';
      tag.dataset.pluginCss = 'dsh-forge-storage-settings';
      tag.textContent = storageSettingsCss;
      document.head.appendChild(tag);
    }
    const remoteContribution = DESKTOP_LAYER_TYPERT_REMOTE;

    function readResult(result: unknown): UpgradeStatus {
      if (!isRecord(result) || result.ok !== true) {
        const error = isRecord(result) && isRecord(result.error)
          ? result.error
          : { code: 'REMOTE_FAILED', message: '升级服务不可用' };
        const code = typeof error.code === 'string' ? error.code : 'REMOTE_FAILED';
        const message = typeof error.message === 'string' ? error.message : '升级服务不可用';
        throw new Error(`${code}: ${message}`);
      }
      return result.value as unknown as UpgradeStatus;
    }

    function isRecord(value: unknown): value is Record<string, unknown> {
      return typeof value === 'object' && value !== null;
    }

    function errorCodeOf(error: unknown): string {
      const message = error instanceof Error ? error.message : String(error);
      const code = message.split(':', 1)[0]?.trim() ?? '';
      return /^[A-Z0-9_]+$/.test(code) ? code : 'OTA_CHECK_FAILED';
    }

    function formatLocalDate(value: string | null): string {
      if (!value) return '尚未检查';
      const date = new Date(value);
      if (Number.isNaN(date.valueOf())) return '尚未检查';
      const pad = (part: number) => String(part).padStart(2, '0');
      return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }

    function formatBytes(value: number): string {
      if (value < 1_024) return `${value} B`;
      if (value < 1_024 * 1_024) return `${(value / 1_024).toFixed(1)} KB`;
      return `${(value / (1_024 * 1_024)).toFixed(1)} MB`;
    }

    type Operation = 'status' | 'check' | 'startUpgrade';
    type StatusState = 'ongoing' | 'warning' | 'done' | 'error';

    function statusCopy(
      snapshot: UpgradeStatus | null,
      operation: Operation | null,
    ): { readonly label: string; readonly state: StatusState } {
      if (snapshot?.phase === 'downloading') return { label: '正在下载…', state: 'ongoing' };
      if (snapshot?.phase === 'preparing') return { label: '正在准备重启…', state: 'ongoing' };
      if (operation === 'check' || snapshot?.phase === 'checking') return { label: '正在检查…', state: 'ongoing' };
      if (operation === 'startUpgrade') return { label: '正在升级…', state: 'ongoing' };
      if (snapshot?.phase === 'available') return { label: '发现新版本', state: 'warning' };
      if (snapshot?.phase === 'current') return { label: '已是最新版本', state: 'done' };
      if (snapshot?.phase === 'unsupported') return { label: '不支持 OTA', state: 'warning' };
      if (snapshot?.phase === 'error') return { label: '检查更新失败', state: 'error' };
      return { label: '尚未检查', state: 'warning' };
    }

    const UPGRADE_TRIGGER_POLL_INTERVAL_MS = 30_000;
    const UPGRADE_OPERATION_POLL_INTERVAL_MS = 500;
    const UPGRADE_SETTINGS_LABEL = '升级管理';
    const UPGRADE_NAV_MARKER = 'data-dsh-forge-upgrade-nav';
    const UPGRADE_NAV_BADGE_MARKER = 'data-dsh-forge-upgrade-nav-badge';

    function syncUpgradeNavigationBadge(visible: boolean): void {
      if (typeof document === 'undefined') return;
      const buttons = document.querySelectorAll('[role="dialog"] nav button');
      for (const button of buttons) {
        const matches = button.textContent?.trim() === UPGRADE_SETTINGS_LABEL;
        if (!matches) {
          button.removeAttribute(UPGRADE_NAV_MARKER);
          button.removeAttribute(UPGRADE_NAV_BADGE_MARKER);
          continue;
        }
        button.setAttribute(UPGRADE_NAV_MARKER, '');
        if (visible) button.setAttribute(UPGRADE_NAV_BADGE_MARKER, '');
        else button.removeAttribute(UPGRADE_NAV_BADGE_MARKER);
      }
    }

    function clearUpgradeNavigationMarkers(): void {
      if (typeof document === 'undefined') return;
      const buttons = document.querySelectorAll('[role="dialog"] nav button');
      for (const button of buttons) {
        button.removeAttribute(UPGRADE_NAV_MARKER);
        button.removeAttribute(UPGRADE_NAV_BADGE_MARKER);
      }
    }

    function watchUpgradeNavigationBadge(visible: boolean): () => void {
      syncUpgradeNavigationBadge(visible);
      if (typeof document === 'undefined' || typeof MutationObserver === 'undefined')
        return clearUpgradeNavigationMarkers;
      const observer = new MutationObserver(() => syncUpgradeNavigationBadge(visible));
      observer.observe(document.body, { childList: true, subtree: true, characterData: false });
      return () => {
        observer.disconnect();
        clearUpgradeNavigationMarkers();
      };
    }

    /** 设置入口只投影 available 状态；升级动作仍由设置页按钮负责。 */
    function UpgradeSettingsTrigger(props: SlotComponentProps): unknown {
      const [snapshot, setSnapshot] = React.useState<UpgradeStatus | null>(null);
      const api = props.api;
      React.useEffect(() => {
        let active = true;
        const refresh = async (): Promise<void> => {
          if (!api) {
            if (active) setSnapshot(null);
            return;
          }
          try {
            const result = await api.status();
            if (active) setSnapshot(readResult(result));
          } catch {
            if (active) setSnapshot(null);
          }
        };
        void refresh();
        const timer = setInterval(() => void refresh(), UPGRADE_TRIGGER_POLL_INTERVAL_MS);
        return () => {
          active = false;
          clearInterval(timer);
        };
      }, [api]);
      const wide = props.wide === true;
      const label = props.t?.('trigger') ?? '设置';
      const available = shouldShowUpgradeBadge(snapshot);
      React.useEffect(() => watchUpgradeNavigationBadge(available), [available]);
      const Icon = wide ? IconSettingsOutline16 : IconSettingsOutline14;
      return React.createElement('span', { 'data-upgrade-trigger': true },
        React.createElement(Icon, { size: wide ? 16 : 18 }),
        wide ? React.createElement('span', { 'data-upgrade-trigger-label': true }, label) : null,
        available ? React.createElement('span', {
          'data-upgrade-trigger-badge': true,
          role: 'img',
          'aria-label': '发现新版本',
          title: '发现新版本',
        }, React.createElement(StateDot, { state: 'warning', size: 6 })) : null,
      );
    }

    function UpgradeSettingsSection({ api }: UpgradeSectionProps): unknown {
      const [snapshot, setSnapshot] = React.useState<UpgradeStatus | null>(null);
      const [busy, setBusy] = React.useState(false);
      const [operation, setOperation] = React.useState<Operation | null>(null);
      const refresh = React.useCallback(async (method: Operation): Promise<void> => {
        if (!api) return;
        setBusy(true);
        setOperation(method);
        try {
          const result = method === 'status' ? await api.status() : method === 'check' ? await api.check() : await api.startUpgrade();
          setSnapshot(readResult(result));
        }
        catch (error) {
          const errorCode = errorCodeOf(error);
          setSnapshot((current) => current ? { ...current, phase: 'error', errorCode } : {
            version: '未知', build: null, support: 'supported', phase: 'error', lastCheckedAt: null, available: null, download: null, errorCode,
          });
        }
        finally {
          setBusy(false);
          setOperation(null);
        }
      }, [api]);
      React.useEffect(() => { void refresh('status'); }, [refresh]);
      React.useEffect(() => {
        if (!api || operation !== 'startUpgrade') return;
        let active = true;
        const poll = async (): Promise<void> => {
          try {
            const result = await api.status();
            if (active) setSnapshot(readResult(result));
          } catch {
            // 升级结束时主进程会退出；轮询失败不覆盖已显示的下载事实。
          }
        };
        void poll();
        const timer = setInterval(() => void poll(), UPGRADE_OPERATION_POLL_INTERVAL_MS);
        return () => {
          active = false;
          clearInterval(timer);
        };
      }, [api, operation]);
      const loading = !snapshot || typeof snapshot.version !== 'string';
      const unsupported = snapshot?.support === 'unsupported' || snapshot?.phase === 'unsupported';
      const available: UpgradeVersion | null = snapshot?.phase === 'available' ? snapshot.available : null;
      const status = statusCopy(snapshot, operation);
      const checking = operation === 'check' || snapshot?.phase === 'checking';
      const upgrading = operation === 'startUpgrade' || snapshot?.phase === 'downloading' || snapshot?.phase === 'preparing';
      const actionLabel = checking ? '正在检查…' : upgrading ? '正在升级…' : available ? '立即升级' : '检查更新';
      const actionMethod = available ? 'startUpgrade' : 'check';
      const actionVariant = available ? 'primary' : 'outline';
      return React.createElement('section', { 'aria-busy': busy, 'data-upgrade-settings': true },
        React.createElement('h2', null, '升级管理'),
        React.createElement('p', { 'data-upgrade-intro': true }, '检查 DeepSeek Harness 更新并管理 OTA 升级。'),
        loading ? React.createElement('p', { 'data-upgrade-loading': true }, '正在读取升级状态…') : React.createElement('div', { 'data-upgrade-rows': true },
          React.createElement('div', { 'data-upgrade-row': true },
            React.createElement('div', { 'data-upgrade-row-text': true },
              React.createElement('div', { 'data-upgrade-title': true }, '当前版本'),
              React.createElement('div', { 'data-upgrade-desc': true }, '当前安装的 DeepSeek Harness 版本'),
            ),
            React.createElement('div', { 'data-upgrade-value': true }, `${snapshot.version} (build ${snapshot.build ?? '未知'})`),
          ),
          React.createElement('div', { 'data-upgrade-row': true },
            React.createElement('div', { 'data-upgrade-row-text': true },
              React.createElement('div', { 'data-upgrade-title': true }, '更新状态'),
              React.createElement('div', { 'data-upgrade-desc': true }, '检查 DeepSeek Harness 更新状态'),
            ),
            React.createElement('div', { 'data-upgrade-value': true },
              React.createElement('span', { 'data-upgrade-status': true }, React.createElement(StateDot, { state: status.state, size: 8 }), status.label),
              snapshot.download ? React.createElement('span', { 'data-upgrade-progress': true },
                React.createElement('progress', {
                  'aria-label': '下载进度',
                  max: 100,
                  value: snapshot.download.percent === null ? undefined : snapshot.download.percent,
                }),
                React.createElement('span', { 'data-upgrade-progress-text': true },
                  snapshot.download.percent === null
                    ? `${formatBytes(snapshot.download.receivedBytes)} 已下载`
                    : `${snapshot.download.percent}%`,
                ),
              ) : null,
              snapshot.errorCode ? React.createElement('span', { 'data-upgrade-code': true }, `错误代码：${snapshot.errorCode}`) : null,
            ),
          ),
          React.createElement('div', { 'data-upgrade-row': true },
            React.createElement('div', { 'data-upgrade-row-text': true },
              React.createElement('div', { 'data-upgrade-title': true }, 'OTA 更新'),
              React.createElement('div', { 'data-upgrade-desc': true }, unsupported ? '当前安装方式不支持 OTA' : '此版本支持在线更新'),
            ),
            React.createElement('div', { 'data-upgrade-value': true }, snapshot.support === 'supported' ? '支持' : '不支持'),
          ),
          React.createElement('div', { 'data-upgrade-row': true },
            React.createElement('div', { 'data-upgrade-row-text': true },
              React.createElement('div', { 'data-upgrade-title': true }, '上次检查'),
              React.createElement('div', { 'data-upgrade-desc': true }, '最近一次向更新服务发起检查的时间'),
            ),
            React.createElement('div', { 'data-upgrade-value': true }, formatLocalDate(snapshot.lastCheckedAt)),
          ),
          available ? React.createElement('div', { 'data-upgrade-row': true },
            React.createElement('div', { 'data-upgrade-row-text': true },
              React.createElement('div', { 'data-upgrade-title': true }, '可用版本'),
              React.createElement('div', { 'data-upgrade-desc': true }, '发现可安装的 DeepSeek Harness 更新'),
            ),
            React.createElement('div', { 'data-upgrade-value': true }, `${available.version} (build ${available.build})`),
          ) : null,
          React.createElement('div', { 'data-upgrade-row': true },
            React.createElement('div', { 'data-upgrade-row-text': true },
              React.createElement('div', { 'data-upgrade-title': true }, '软件更新'),
              React.createElement('div', { 'data-upgrade-desc': true }, '检查是否有新的 DeepSeek Harness 版本。'),
            ),
            React.createElement('div', { 'data-upgrade-value': true }, React.createElement(Button, {
              variant: actionVariant,
              size: 'sm',
              disabled: loading || unsupported || busy,
              onClick: () => void refresh(actionMethod),
            }, actionLabel)),
          ),
        ),
        snapshot?.phase === 'error' ? React.createElement('p', { 'data-upgrade-inline-error': true, role: 'alert' }, '检查更新失败，请稍后重试。') : null,
      );
    }

    type StorageOperation = 'refresh' | 'cleanCache' | 'cleanSessions';

    function readStorageResult(result: unknown): StorageSnapshot {
      if (!isRecord(result) || result.ok !== true) {
        const error = isRecord(result) && isRecord(result.error)
          ? result.error
          : { code: 'REMOTE_FAILED', message: '存储服务不可用' };
        const code = typeof error.code === 'string' ? error.code : 'REMOTE_FAILED';
        const message = typeof error.message === 'string' ? error.message : '存储服务不可用';
        throw new Error(`${code}: ${message}`);
      }
      return storageSnapshotSchema.parse(result.value);
    }

    function formatStorageBytes(value: number): string {
      if (value < 1_024) return `${value} B`;
      const units = ['KB', 'MB', 'GB', 'TB'];
      let scaled = value;
      let unit = '';
      for (const candidate of units) {
        if (scaled < 1_024) break;
        scaled /= 1_024;
        unit = candidate;
      }
      return `${scaled >= 100 ? scaled.toFixed(0) : scaled.toFixed(1)} ${unit}`;
    }

    function storageErrorText(code: string): string {
      if (code === 'STORAGE_BUSY') return '已有扫描或清理正在进行，请稍后重试。';
      if (code === 'STORAGE_SCAN_INCOMPLETE') return '部分目录暂时无法读取，显示结果可能不完整。';
      if (code === 'STORAGE_CLEAN_INCOMPLETE') return '部分数据未能删除，可稍后重试。';
      if (code === 'STORAGE_CANCELLED') return '操作已取消。';
      if (code === 'STORAGE_UNAVAILABLE') return '当前安装不提供存储空间信息。';
      return '存储空间信息不可用，请稍后重试。';
    }

    function storagePercent(snapshot: StorageSnapshot): number | null {
      const total = snapshot.volume?.totalBytes ?? 0;
      if (total <= 0) return null;
      return Math.min(100, (snapshot.appUsedBytes / total) * 100);
    }

    /** 对比条三段比例：本应用、磁盘其他已用、剩余可用；无卷容量时不渲染。 */
    function storageBarSegments(snapshot: StorageSnapshot):
      { readonly appPercent: number; readonly otherUsedPercent: number } | null {
      const volume = snapshot.volume;
      if (!volume || volume.totalBytes <= 0) return null;
      const total = volume.totalBytes;
      const used = Math.min(total, volume.usedBytes);
      const app = Math.min(used, snapshot.appUsedBytes);
      return { appPercent: (app / total) * 100, otherUsedPercent: ((used - app) / total) * 100 };
    }

    interface StorageLifecycle {
      mounted: boolean;
      busy: boolean;
    }

    function StorageSettingsSection(props: { readonly api?: StorageManagerApi }): unknown {
      const api = props.api;
      const lifecycleState = React.useState<StorageLifecycle>({ mounted: true, busy: false });
      const lifecycle = lifecycleState[0];
      const [snapshot, setSnapshot] = React.useState<StorageSnapshot | null>(null);
      const [errorText, setErrorText] = React.useState<string | null>(null);
      const [busy, setBusyState] = React.useState(false);
      const [operation, setOperation] = React.useState<StorageOperation | null>(null);
      React.useEffect(() => {
        lifecycle.mounted = true;
        return () => {
          lifecycle.mounted = false;
        };
      }, [lifecycle]);
      const run = React.useCallback(async (method: StorageOperation): Promise<void> => {
        if (!api) {
          setErrorText('存储服务不可用');
          return;
        }
        if (lifecycle.busy) {
          setErrorText('已有扫描或清理正在进行，请稍后重试。');
          return;
        }
        lifecycle.busy = true;
        setBusyState(true);
        setOperation(method);
        setErrorText(null);
        try {
          const call = method === 'refresh' ? api.refresh() : method === 'cleanCache' ? api.cleanCache() : api.cleanSessions();
          const result = await call;
          if (!lifecycle.mounted) return;
          setSnapshot(readStorageResult(result));
          setErrorText(null);
        } catch (error) {
          if (!lifecycle.mounted) return;
          const message = error instanceof Error ? error.message : String(error);
          const code = message.split(':', 1)[0]?.trim() ?? '';
          setErrorText(/^[A-Z0-9_]+$/.test(code) ? storageErrorText(code) : '存储空间信息不可用，请稍后重试。');
        } finally {
          // lease 必须释放，否则 React 开发态假卸载会把页面钉死在「正在扫描…」。
          lifecycle.busy = false;
          setBusyState(false);
          setOperation(null);
        }
      }, [api, lifecycle]);
      React.useEffect(() => {
        if (lifecycle.busy) return;
        void run('refresh');
      }, [run, lifecycle]);
      const current = snapshot;
      const scanning = current === null && busy && operation === 'refresh' && errorText === null;
      const error = errorText;
      const failed = current !== null && current.phase === 'error';
      const shownError = failed ? (error || storageErrorText(current?.errorCode || 'STORAGE_UNAVAILABLE')) : error;
      const volume = current?.volume ?? null;
      const percent = current ? storagePercent(current) : null;
      const bar = current ? storageBarSegments(current) : null;
      const refreshing = current !== null && busy && operation === 'refresh';
      const cleaning = busy && (operation === 'cleanCache' || operation === 'cleanSessions');
      const disabled = cleaning || refreshing || scanning;
      const totalText = current ? `${formatStorageBytes(current.appUsedBytes)}${percent === null ? '' : `（占磁盘 ${percent.toFixed(1)}%）`}` : '—';
      return React.createElement('section', { 'aria-busy': busy, 'data-storage-settings': true },
        React.createElement('h2', null, '存储空间'),
        React.createElement('p', { 'data-storage-intro': true }, '查看本应用在磁盘上占用的空间，并清理可重建的缓存或会话数据。'),
        scanning ? React.createElement('p', { 'data-storage-loading': true }, '正在扫描…') : null,
        shownError ? React.createElement('p', { 'data-storage-inline-error': true, role: 'alert' }, shownError) : null,
        current && current.phase !== 'error' ? React.createElement('div', { 'data-storage-rows': true },
          React.createElement('div', { 'data-storage-row': true, 'data-storage-total': true },
            React.createElement('div', { 'data-storage-row-text': true },
              React.createElement('div', { 'data-storage-title': true }, '应用已用空间'),
              React.createElement('div', { 'data-storage-desc': true }, '本应用在 DSH Home 与用户数据目录中占用的空间'),
            ),
            React.createElement('div', { 'data-storage-value': true }, totalText),
          ),
          bar && volume ? React.createElement('div', { 'data-storage-row': true, 'data-storage-bar-row': true },
            React.createElement('div', { 'data-storage-total-block': true },
              React.createElement('div', { 'data-storage-bar': true, 'aria-label': '磁盘占用对比条' },
                React.createElement('span', { 'data-storage-bar-app': true, style: { width: `${bar.appPercent}%` } }),
                React.createElement('span', { 'data-storage-bar-other-used': true, style: { width: `${bar.otherUsedPercent}%` } }),
              ),
              React.createElement('p', { 'data-storage-bar-caption': true },
                current.userDataOnDifferentVolume
                  ? `磁盘共 ${formatStorageBytes(volume.totalBytes)}，已用 ${formatStorageBytes(volume.usedBytes)}，可用 ${formatStorageBytes(volume.freeBytes)}。会话与应用数据位于不同磁盘，对比条只统计 DSH Home 所在磁盘。`
                  : `磁盘共 ${formatStorageBytes(volume.totalBytes)}，已用 ${formatStorageBytes(volume.usedBytes)}，可用 ${formatStorageBytes(volume.freeBytes)}。`,
              ),
            ),
          ) : null,
          current.errorCode ? React.createElement('p', { 'data-storage-inline-error': true, role: 'alert' }, storageErrorText(current.errorCode)) : null,
          React.createElement('div', { 'data-storage-row': true, 'data-storage-cache': true },
            React.createElement('div', { 'data-storage-row-text': true },
              React.createElement('div', { 'data-storage-title': true }, '缓存数据'),
              React.createElement('div', { 'data-storage-desc': true }, '使用过程中产生的可重建临时数据，清理不影响会话正文。'),
            ),
            React.createElement('div', { 'data-storage-value': true },
              formatStorageBytes(current.cacheBytes),
              React.createElement(Button, {
                variant: 'outline',
                size: 'sm',
                disabled: disabled,
                onClick: () => void run('cleanCache'),
              }, '前往清理'),
            ),
          ),
          React.createElement('div', { 'data-storage-row': true, 'data-storage-sessions': true },
            React.createElement('div', { 'data-storage-row-text': true },
              React.createElement('div', { 'data-storage-title': true }, '会话数据'),
              React.createElement('div', { 'data-storage-desc': true }, '会话记录等正文；清理会作用于共享 DSH Home。'),
            ),
            React.createElement('div', { 'data-storage-value': true },
              formatStorageBytes(current.sessionsBytes),
              React.createElement(Button, {
                variant: 'outline',
                size: 'sm',
                disabled: disabled,
                onClick: () => void run('cleanSessions'),
              }, '前往清理会话'),
            ),
          ),
          React.createElement('div', { 'data-storage-row': true, 'data-storage-other': true },
            React.createElement('div', { 'data-storage-row-text': true },
              React.createElement('div', { 'data-storage-title': true }, '其他数据'),
              React.createElement('div', { 'data-storage-desc': true }, '运行所需文件、凭据、当前受管 profile 及未分类剩余，本页不能删除。'),
            ),
            React.createElement('div', { 'data-storage-value': true, 'data-storage-other-bytes': true }, formatStorageBytes(current.otherBytes)),
          ),
          React.createElement('div', { 'data-storage-row': true, 'data-storage-refresh-row': true },
            React.createElement('div', { 'data-storage-row-text': true },
              React.createElement('div', { 'data-storage-title': true }, '统计刷新'),
              React.createElement('div', { 'data-storage-desc': true }, refreshing ? '正在重新扫描…' : '重新统计磁盘占用'),
            ),
            React.createElement('div', { 'data-storage-value': true },
              React.createElement(Button, {
                variant: 'outline',
                size: 'sm',
                disabled: disabled,
                onClick: () => void run('refresh'),
              }, refreshing ? '正在扫描…' : '重新扫描'),
            ),
          ),
        ) : null,
      );
    }

    async function apply(ctx: DesktopLayerContext): Promise<void> {
      const remote = ctx.get<RemoteRegistry>('remote');
      // Typert 按 package 名只允许一份贡献；升级与存储 descriptors 必须同一次挂载。
      const disposeRemote = await remote.$mount(remoteContribution);
      ctx.effect(() => () => {
        void disposeRemote();
      }, 'dsh-forge-desktop-layer: desktop remotes');
      const api = ctx.get<UpgradeManagerApi | undefined>('remote.upgradeManager');
      const storageApi = ctx.get<StorageManagerApi | undefined>('remote.storageManager');
      const section = (props: UpgradeSectionProps): unknown => React.createElement(
        UpgradeSettingsSection,
        { ...props, api },
      );
      const trigger = (props: SlotComponentProps): unknown => React.createElement(
        UpgradeSettingsTrigger,
        { ...props, api },
      );
      const storageSection = (props: SlotComponentProps): unknown => React.createElement(
        StorageSettingsSection,
        { ...props, api: storageApi },
      );
      ctx.slots.inject('settings.trigger', () => ctx.slots.register({
        name: 'settings.trigger',
        priority: -10,
        locale: 'settings',
        inject: () => ({ api }),
      }, trigger));
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section', id: 'dsh-forge-upgrade', order: 80,
        label: () => '升级管理',
        inject: () => ({ api }),
      }, section));
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section', id: 'dsh-forge-storage', order: 90,
        label: () => '存储空间',
        inject: () => ({ api: storageApi }),
      }, storageSection));
    }

    module.exports = { apply, inject: ['slots', 'locale', 'remote'] };
    return module.exports;
  },
});
