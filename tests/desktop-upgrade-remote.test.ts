/** 升级 Remote 的固定面测试：只允许三个无参数方法。 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { TYPERT_REMOTE } from '@dsh-forge/desktop-layer/remote';

interface RenderedElement {
  readonly type: unknown;
  readonly props: Record<string, unknown> | null;
  readonly children: readonly unknown[];
}

function isRenderedElement(value: unknown): value is RenderedElement {
  return typeof value === 'object'
    && value !== null
    && 'children' in value
    && Array.isArray((value as { readonly children?: unknown }).children);
}

function containsUpgradeBadge(value: unknown): boolean {
  if (!isRenderedElement(value)) return false;
  if (value.props?.['data-upgrade-trigger-badge'] === true) return true;
  return value.children.some(containsUpgradeBadge);
}

function renderFunctionComponents(value: unknown): unknown {
  let current = value;
  while (isRenderedElement(current) && typeof current.type === 'function') {
    current = (current.type as (props: Record<string, unknown>) => unknown)(current.props ?? {});
  }
  return current;
}

test('Host gateway 与 Client descriptor 暴露同一组无参数方法', () => {
  assert.deepEqual(
    TYPERT_REMOTE.descriptors.map((entry) => entry.method),
    ['status', 'check', 'startUpgrade'],
  );
  for (const descriptor of TYPERT_REMOTE.descriptors) {
    assert.equal(descriptor.service, 'upgradeManager');
    assert.deepEqual(descriptor.parameters, []);
    assert.equal(descriptor.cancellation, undefined);
    assert.equal(descriptor.result.mode, 'strict');
    assert.equal(descriptor.result.typeSymbol, '@dsh-forge/desktop-layer#UpgradeManagerStatus');
    assert.equal(typeof descriptor.result.schema?.parse, 'function');
  }
});

test('设置页通过 Remote 注册且不携带 Electron 或安装路径能力', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'packages/bundles/desktop-layer/lib/client.js'), 'utf8');
  assert.match(source, /settings\.section/);
  assert.match(source, /settings\.trigger/);
  assert.match(source, /priority: -10/);
  assert.match(source, /data-upgrade-trigger-badge/);
  assert.match(source, /data-dsh-forge-upgrade-nav/);
  assert.match(source, /data-dsh-forge-upgrade-nav-badge/);
  assert.match(source, /\[role="dialog"\] nav button/);
  assert.match(source, /MutationObserver/);
  assert.match(source, /UPGRADE_NAV_ICON_MASK/);
  assert.match(source, /data-dsh-forge-upgrade-nav\] > svg:first-child/);
  assert.match(source, /data-dsh-forge-upgrade-nav-badge\]::after/);
  assert.match(source, /-webkit-mask:/);
  assert.match(source, /state-warning-primary/);
  assert.match(source, /UPGRADE_TRIGGER_POLL_INTERVAL_MS = (30_000|3e4)/);
  assert.match(source, /clearInterval/);
  assert.match(source, /当前安装方式不支持 OTA/);
  assert.match(source, /remote\.\$mount/);
  assert.match(source, /remote\.upgradeManager/);
  assert.doesNotMatch(source, /ipcRenderer|http:\/\/|https:\/\/|stagedPackage|executablePath|shell/);
});

test('入口提示轮询在卸载后清理', async () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'packages/bundles/desktop-layer/lib/client.js'), 'utf8');
  let registration: {
    readonly factory: (require: (id: string) => unknown) => unknown;
  } | undefined;
  let intervalCount = 0;
  let clearCount = 0;
  let pollCallback: (() => unknown) | undefined;
  let hookIndex = 0;
  const hookValues: unknown[] = [];
  const effects: Array<{ readonly dependencies: readonly unknown[]; readonly cleanup?: () => void }> = [];
  const navAttributes = new Set<string>();
  const navButton = {
    textContent: '升级管理',
    setAttribute(name: string) {
      navAttributes.add(name);
    },
    removeAttribute(name: string) {
      navAttributes.delete(name);
    },
  };
  let navButtons: readonly typeof navButton[] = [];
  const React = {
    Fragment: 'fragment',
    createElement(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): RenderedElement {
      return { type, props, children };
    },
    useState(initial: unknown): readonly [unknown, (next: unknown | ((current: unknown) => unknown)) => void] {
      const index = hookIndex++;
      if (!(index in hookValues)) hookValues[index] = initial;
      return [hookValues[index], (next) => {
        const current = hookValues[index];
        hookValues[index] = typeof next === 'function'
          ? (next as (value: unknown) => unknown)(current)
          : next;
      }];
    },
    useCallback<T>(callback: T): T {
      return callback;
    },
    useEffect(effect: () => void | (() => void), dependencies: readonly unknown[]): void {
      const index = hookIndex++;
      const previous = effects[index];
      const changed = previous === undefined
        || dependencies.length !== previous.dependencies.length
        || dependencies.some((value, dependencyIndex) => value !== previous.dependencies[dependencyIndex]);
      if (!changed) return;
      previous?.cleanup?.();
      effects[index] = { dependencies, cleanup: effect() || undefined };
    },
  };
  let observerCallback: (() => void) | undefined;
  vm.runInNewContext(source, {
    window: {
      __ModuleLoader__: {
        load(config: { readonly factory: (require: (id: string) => unknown) => unknown }) {
          registration = config;
        },
      },
    },
    setInterval: (callback: () => unknown) => {
      intervalCount += 1;
      pollCallback = callback;
      return intervalCount;
    },
    clearInterval: () => {
      clearCount += 1;
    },
    document: {
      querySelector: () => null,
      querySelectorAll: (selector: string) => selector === '[role="dialog"] nav button' ? navButtons : [],
      createElement: () => ({ dataset: {}, textContent: '' }),
      head: { appendChild: () => {} },
      body: {},
    },
    MutationObserver: class {
      constructor(callback: () => void) {
        observerCallback = callback;
      }
      observe() {}
      disconnect() {
        observerCallback = undefined;
      }
    },
  });
  const registrations: Array<{
    readonly name: string;
    readonly component: (props: Record<string, unknown>) => unknown;
  }> = [];
  let snapshot: Record<string, unknown> = {
    version: '1.0.0',
    build: 1,
    support: 'supported',
    phase: 'available',
    lastCheckedAt: null,
    available: { version: '1.1.0', build: 2 },
    errorCode: null,
  };
  let statusCalls = 0;
  const api = {
    status: async () => {
      statusCalls += 1;
      return { ok: true, value: snapshot };
    },
  };
  const remote = { $mount: async () => async () => {} };
  const client = registration?.factory((id) => {
    if (id === 'react') return React;
    if (id === '@deepseek-ai/dsh-client-ui-primitives') {
      return {
        Button: 'button',
        StateDot: 'state-dot',
        IconSettingsOutline14: 'settings-14',
        IconSettingsOutline16: 'settings-16',
      };
    }
    throw new Error(`意外的 Client 依赖：${id}`);
  }) as { readonly apply?: (context: unknown) => Promise<void> } | undefined;
  await client?.apply?.({
    get: (key: string) => key === 'remote' ? remote : api,
    effect: () => {},
    slots: {
      inject: (_name: string, factory: () => unknown) => factory(),
      register: (options: { readonly name: string }, component: (props: Record<string, unknown>) => unknown) => {
        registrations.push({ name: options.name, component });
      },
    },
  });
  const trigger = registrations.find((entry) => entry.name === 'settings.trigger')?.component;
  assert.equal(typeof trigger, 'function');
  hookIndex = 0;
  const first = renderFunctionComponents(trigger?.({ wide: true, t: () => '设置' }));
  assert.equal(containsUpgradeBadge(first), false);
  await new Promise<void>((resolve) => setImmediate(resolve));
  hookIndex = 0;
  const updated = renderFunctionComponents(trigger?.({ wide: true, t: () => '设置' }));
  assert.equal(statusCalls, 1);
  assert.equal(containsUpgradeBadge(updated), true);
  assert.equal(navAttributes.has('data-dsh-forge-upgrade-nav'), false);
  navButtons = [navButton];
  observerCallback?.();
  assert.equal(navAttributes.has('data-dsh-forge-upgrade-nav'), true);
  snapshot = { ...snapshot, phase: 'current', available: null };
  pollCallback?.();
  await new Promise<void>((resolve) => setImmediate(resolve));
  hookIndex = 0;
  const current = renderFunctionComponents(trigger?.({ wide: true, t: () => '设置' }));
  assert.equal(containsUpgradeBadge(current), false);
  observerCallback?.();
  assert.equal(navAttributes.has('data-dsh-forge-upgrade-nav'), true);
  assert.equal(navAttributes.has('data-dsh-forge-upgrade-nav-badge'), false);
  snapshot = { ...snapshot, phase: 'unsupported', support: 'unsupported' };
  pollCallback?.();
  await new Promise<void>((resolve) => setImmediate(resolve));
  hookIndex = 0;
  const unsupported = renderFunctionComponents(trigger?.({ wide: true, t: () => '设置' }));
  assert.equal(containsUpgradeBadge(unsupported), false);
  effects.forEach((effect) => effect.cleanup?.());
  assert.equal(navAttributes.has('data-dsh-forge-upgrade-nav'), false);
  assert.equal(navAttributes.has('data-dsh-forge-upgrade-nav-badge'), false);
  assert.equal(clearCount, intervalCount);
});

test('客户端模块扫描器能够读取 desktop layer 的 manifest', () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'packages/bundles/desktop-layer/package.json'), 'utf8'),
  ) as { readonly exports?: Record<string, unknown> };
  assert.equal(manifest.exports?.['./package.json'], './package.json');
});

test('构建后的 Client 产物保留 ModuleLoader factory 契约', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'packages/bundles/desktop-layer/lib/client.js'), 'utf8');
  let registration: {
    readonly id: string;
    readonly factory: (require: (id: string) => unknown) => unknown;
  } | undefined;
  vm.runInNewContext(source, {
    window: {
      __ModuleLoader__: {
        load(config: { readonly id: string; readonly factory: (require: (id: string) => unknown) => unknown }) {
          registration = config;
        },
      },
    },
  });
  assert.equal(registration?.id, '@dsh-forge/desktop-layer');
  const exports = registration?.factory((id) => {
    if (id === 'react') return {};
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return {};
    throw new Error(`意外的 Client 依赖：${id}`);
  }) as { readonly apply?: unknown; readonly inject?: readonly string[] } | undefined;
  assert.equal(typeof exports?.apply, 'function');
  assert.deepEqual(Array.from(exports?.inject ?? []), ['slots', 'locale', 'remote']);
});
