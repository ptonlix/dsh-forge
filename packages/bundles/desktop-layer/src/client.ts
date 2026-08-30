import {
  TYPERT_REMOTE,
  type UpgradeRemoteContribution,
  type UpgradeStatus,
  type UpgradeVersion,
} from './upgrade-remote-contract.js';

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
}

interface UpgradeManagerApi {
  status(): Promise<unknown>;
  check(): Promise<unknown>;
  startUpgrade(): Promise<unknown>;
}

interface RemoteRegistry {
  $mount(contribution: UpgradeRemoteContribution): Promise<() => Promise<void>>;
  readonly upgradeManager?: UpgradeManagerApi;
}

interface DesktopLayerContext {
  get<T>(key: string): T;
  effect(register: () => () => void, label: string): void;
  readonly slots: {
    inject(name: string, factory: () => unknown): void;
    register(
      options: {
        readonly name: string;
        readonly id: string;
        readonly order: number;
        readonly label: () => string;
        readonly inject: () => { readonly api?: UpgradeManagerApi };
      },
      section: (props: UpgradeSectionProps) => unknown,
    ): unknown;
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

interface DocumentLike {
  querySelector(selector: string): StyleElement | null;
  createElement(tagName: string): StyleElement;
  readonly head: { appendChild(element: StyleElement): void };
}

declare global {
  interface Window {
    readonly __ModuleLoader__: ModuleLoader;
  }
}

declare const window: Window;
declare const document: DocumentLike;

window.__ModuleLoader__.load({
  id: '@dsh-forge/desktop-layer',
  factory: (require) => {
    const module = { exports: {} };
    const React = require('react') as ReactRuntime;
    const { Button, StateDot } = require('@deepseek-ai/dsh-client-ui-primitives') as PrimitiveExports;
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
    const remoteContribution = TYPERT_REMOTE;

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

    type Operation = 'status' | 'check' | 'startUpgrade';
    type StatusState = 'ongoing' | 'warning' | 'done' | 'error';

    function statusCopy(
      snapshot: UpgradeStatus | null,
      operation: Operation | null,
    ): { readonly label: string; readonly state: StatusState } {
      if (operation === 'check' || snapshot?.phase === 'checking') return { label: '正在检查…', state: 'ongoing' };
      if (operation === 'startUpgrade' || snapshot?.phase === 'preparing') return { label: '正在升级…', state: 'ongoing' };
      if (snapshot?.phase === 'available') return { label: '发现新版本', state: 'warning' };
      if (snapshot?.phase === 'current') return { label: '已是最新版本', state: 'done' };
      if (snapshot?.phase === 'unsupported') return { label: '不支持 OTA', state: 'warning' };
      if (snapshot?.phase === 'error') return { label: '检查更新失败', state: 'error' };
      return { label: '尚未检查', state: 'warning' };
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
            version: '未知', build: null, support: 'supported', phase: 'error', lastCheckedAt: null, available: null, errorCode,
          });
        }
        finally {
          setBusy(false);
          setOperation(null);
        }
      }, [api]);
      React.useEffect(() => { void refresh('status'); }, [refresh]);
      const loading = !snapshot || typeof snapshot.version !== 'string';
      const unsupported = snapshot?.support === 'unsupported' || snapshot?.phase === 'unsupported';
      const available: UpgradeVersion | null = snapshot?.phase === 'available' ? snapshot.available : null;
      const status = statusCopy(snapshot, operation);
      const checking = operation === 'check' || snapshot?.phase === 'checking';
      const upgrading = operation === 'startUpgrade' || snapshot?.phase === 'preparing';
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

    async function apply(ctx: DesktopLayerContext): Promise<void> {
      const remote = ctx.get<RemoteRegistry>('remote');
      const disposeRemote = await remote.$mount(remoteContribution);
      ctx.effect(() => () => {
        void disposeRemote();
      }, 'dsh-forge-desktop-layer: upgrade remote');
      const api = ctx.get<UpgradeManagerApi | undefined>('remote.upgradeManager');
      const section = (props: UpgradeSectionProps): unknown => React.createElement(
        UpgradeSettingsSection,
        { ...props, api },
      );
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section', id: 'dsh-forge-upgrade', order: 80,
        label: () => '升级管理',
        inject: () => ({ api }),
      }, section));
    }

    module.exports = { apply, inject: ['slots', 'locale', 'remote'] };
    return module.exports;
  },
});
