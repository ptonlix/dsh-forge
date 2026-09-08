/**
 * 存储设置页客户端测试：Remote 固定面（无参数、共享校验拒绝路径与 Electron
 * 对象）、注册的「存储空间」section、加载态、跨卷文案、清理按钮边界与卸载清理。
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';
import {
  DESKTOP_LAYER_TYPERT_REMOTE,
  STORAGE_TYPERT_REMOTE,
  storageSnapshotSchema,
  TYPERT_REMOTE,
} from '@dsh-forge/desktop-layer/remote';

function snapshot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    phase: 'ready',
    cacheBytes: 2048,
    sessionsBytes: 1024,
    otherBytes: 512,
    appUsedBytes: 3584,
    volume: { totalBytes: 1_000_000_000, usedBytes: 400_000_000, freeBytes: 600_000_000 },
    userDataOnDifferentVolume: false,
    scannedAt: '2026-09-04T00:00:00.000Z',
    errorCode: null,
    ...overrides,
  };
}

test('存储 Remote 只暴露四个无参数方法，结果使用严格共享校验', () => {
  assert.deepEqual(
    STORAGE_TYPERT_REMOTE.descriptors.map((entry) => entry.method),
    ['status', 'refresh', 'cleanCache', 'cleanSessions'],
  );
  for (const descriptor of STORAGE_TYPERT_REMOTE.descriptors) {
    assert.equal(descriptor.service, 'storageManager');
    assert.equal(descriptor.namespace, 'storageManager');
    assert.deepEqual(descriptor.parameters, []);
    assert.equal(descriptor.cancellation, undefined);
    assert.equal(descriptor.invocation.kind, 'direct');
    assert.equal(descriptor.result.mode, 'strict');
    assert.equal(descriptor.result.typeSymbol, '@dsh-forge/desktop-layer#StorageSnapshot');
    assert.equal(typeof descriptor.result.schema?.parse, 'function');
  }
  // 升级方法仍在同一 package 的 descriptors 中，不能再单独 $mount 一份贡献。
  assert.deepEqual(
    TYPERT_REMOTE.descriptors.map((entry) => entry.method),
    ['status', 'check', 'startUpgrade'],
  );
  assert.equal(DESKTOP_LAYER_TYPERT_REMOTE.package, '@dsh-forge/desktop-layer');
  assert.deepEqual(
    DESKTOP_LAYER_TYPERT_REMOTE.descriptors.map((entry) => `${entry.namespace}/${entry.method}`),
    [
      'upgradeManager/status',
      'upgradeManager/check',
      'upgradeManager/startUpgrade',
      'storageManager/status',
      'storageManager/refresh',
      'storageManager/cleanCache',
      'storageManager/cleanSessions',
    ],
  );
});

test('存储快照共享校验接受三类总和一致的合法快照', () => {
  const value = snapshot();
  assert.deepEqual(storageSnapshotSchema.parse(value), value);
});

test('存储快照共享校验拒绝路径、文件名与 Electron 对象', () => {
  for (const bad of [
    snapshot({ path: '/Users/x/.dsh' }),
    snapshot({ dshHome: '/Users/x/.dsh' }),
    snapshot({ directoryCandidates: ['/Users/x'] }),
    snapshot({ ipcRenderer: {} }),
    snapshot({ window: {} }),
    snapshot({ cacheBytes: -1 }),
    snapshot({ cacheBytes: 1.5 }),
    snapshot({ appUsedBytes: 999 }),
    snapshot({ phase: 'walking' }),
    snapshot({ userDataOnDifferentVolume: 'yes' }),
    snapshot({ volume: { totalBytes: -1, usedBytes: 1, freeBytes: 1 } }),
    snapshot({ scannedAt: 5 }),
  ]) {
    assert.throws(() => storageSnapshotSchema.parse(bad));
  }
});

test('构建后的 Client 产物注册「存储空间」section 且不引入路径与 Electron 能力', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'packages/bundles/desktop-layer/lib/client.js'), 'utf8');
  assert.match(source, /存储空间/);
  assert.match(source, /dsh-forge-storage/);
  assert.match(source, /storageManager/);
  assert.match(source, /data-storage-settings/);
  assert.match(source, /data-storage-cache/);
  assert.match(source, /data-storage-sessions/);
  assert.match(source, /data-storage-other/);
  assert.match(source, /data-storage-bar/);
  assert.match(source, /前往清理会话/);
  assert.match(source, /前往清理/);
  assert.match(source, /STORAGE_BUSY/);
  assert.match(source, /storageSnapshotSchema\.parse/);
  assert.match(source, /remote\.\$mount/);
  assert.equal((source.match(/\$mount\(/g) || []).length, 1);
  assert.doesNotMatch(source, /ipcRenderer|http:\/\/|https:\/\/|dshHome: ['"`]|userData: ['"`]/);
});

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

function walk(value: unknown, visit: (element: RenderedElement) => void): void {
  if (!isRenderedElement(value)) return;
  visit(value);
  for (const child of value.children) walk(child, visit);
}

function findByMarker(value: unknown, marker: string): RenderedElement[] {
  const found: RenderedElement[] = [];
  walk(value, (element) => {
    if (element.props?.[marker] === true) found.push(element);
  });
  return found;
}

function textOf(value: unknown): string {
  const parts: string[] = [];
  const collect = (current: unknown): void => {
    if (typeof current === 'string' || typeof current === 'number') parts.push(String(current));
    else if (Array.isArray(current)) current.forEach(collect);
    else if (isRenderedElement(current)) current.children.forEach(collect);
  };
  collect(value);
  return parts.join('');
}

/** 与升级页测试相同的 React/ModuleLoader 运行假件；useCallback 按依赖记忆。 */
function createHarness() {
  let hookIndex = 0;
  const hookValues: unknown[] = [];
  const effects: Array<{ readonly dependencies: readonly unknown[]; readonly cleanup?: () => void }> = [];
  const callbacks: Array<{ readonly dependencies: readonly unknown[]; readonly value: unknown }> = [];
  const React = {
    Fragment: 'fragment',
    createElement(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): RenderedElement {
      return { type, props, children };
    },
    useState<T>(initial: T): readonly [T, (next: T | ((current: T) => T)) => void] {
      const index = hookIndex++;
      if (!(index in hookValues)) hookValues[index] = initial;
      return [hookValues[index] as T, (next) => {
        const current = hookValues[index] as T;
        hookValues[index] = typeof next === 'function' ? (next as (value: T) => T)(current) : next;
      }];
    },
    useCallback<T>(callback: T, dependencies: readonly unknown[]): T {
      const index = hookIndex++;
      const previous = callbacks[index];
      const changed = previous === undefined
        || dependencies.length !== previous.dependencies.length
        || dependencies.some((value, dependencyIndex) => value !== previous.dependencies[dependencyIndex]);
      if (changed) callbacks[index] = { dependencies, value: callback };
      return (changed ? callback : previous!.value) as T;
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
  const primitives = {
    Button: 'button',
    StateDot: 'state-dot',
    IconSettingsOutline14: 'settings-14',
    IconSettingsOutline16: 'settings-16',
  };
  const flush = (): Promise<void> => new Promise<void>((resolve) => setImmediate(resolve));
  const remote: { $mount: () => Promise<() => Promise<void>> } = { $mount: async () => async () => {} };
  let storageApi: Record<string, () => Promise<unknown>> = {};
  const reset = (api: Record<string, () => Promise<unknown>>): void => {
    storageApi = api;
  };
  const mount = async (): Promise<{
    readonly registrations: Array<{
      readonly name: string;
      readonly options: Record<string, unknown>;
      readonly component: (props: Record<string, unknown>) => unknown;
    }>;
    cleanup(): void;
  }> => {
    const source = fs.readFileSync(path.join(process.cwd(), 'packages/bundles/desktop-layer/lib/client.js'), 'utf8');
    let registration: { readonly factory: (require: (id: string) => unknown) => unknown } | undefined;
    vm.runInNewContext(source, {
      window: {
        __ModuleLoader__: {
          load(config: { readonly factory: (require: (id: string) => unknown) => unknown }) {
            registration = config;
          },
        },
      },
      document: {
        querySelector: () => null,
        querySelectorAll: () => [],
        createElement: () => ({ dataset: {}, textContent: '' }),
        head: { appendChild: () => {} },
        body: {},
      },
      MutationObserver: class {
        observe() {}
        disconnect() {}
      },
    });
    const registrations: Array<{
      readonly name: string;
      readonly options: Record<string, unknown>;
      readonly component: (props: Record<string, unknown>) => unknown;
    }> = [];
    const client = registration?.factory((id) => {
      if (id === 'react') return React;
      if (id === '@deepseek-ai/dsh-client-ui-primitives') return primitives;
      throw new Error(`意外的 Client 依赖：${id}`);
    }) as { readonly apply?: (context: unknown) => Promise<void> } | undefined;
    await client?.apply?.({
      get: (key: string) => key === 'remote' ? remote : storageApi,
      effect: () => {},
      slots: {
        inject: (_name: string, factory: () => unknown) => factory(),
        register: (options: Record<string, unknown>, component: (props: Record<string, unknown>) => unknown) => {
          registrations.push({ name: String(options.name), options, component });
        },
      },
    });
    return {
      registrations,
      cleanup: () => effects.forEach((effect) => effect.cleanup?.()),
    };
  };
  const render = (component: (props: Record<string, unknown>) => unknown): unknown => {
    hookIndex = 0;
    let node = component({});
    while (isRenderedElement(node) && typeof node.type === 'function') {
      node = (node.type as (props: Record<string, unknown>) => unknown)(node.props ?? {});
    }
    return node;
  };
  return {
    render,
    reset,
    mount,
    flush,
    hookValues,
  };
}

test('设置页通过 Remote 渲染三类占用，其他数据没有删除按钮', async () => {
  const harness = createHarness();
  const apiCalls: string[] = [];
  let resolveRefresh: (value: unknown) => void = () => {};
  const refreshGate = new Promise<unknown>((resolve) => {
    resolveRefresh = resolve;
  });
  harness.reset({
    refresh: async () => {
      apiCalls.push('refresh');
      return refreshGate;
    },
    cleanCache: async () => {
      apiCalls.push('cleanCache');
      return { ok: true, value: snapshot({ cacheBytes: 0, appUsedBytes: 1536 }) };
    },
    cleanSessions: async () => {
      apiCalls.push('cleanSessions');
      return { ok: true, value: snapshot({ sessionsBytes: 0, appUsedBytes: 2560 }) };
    },
  });
  const mounted = await harness.mount();
  const storageSections = mounted.registrations.filter((entry) => entry.name === 'settings.section'
    && String(entry.options.id) === 'dsh-forge-storage');
  assert.equal(storageSections.length, 1);
  const sectionLabel = (storageSections[0]!.options.label as () => string)();
  assert.equal(sectionLabel, '存储空间');
  assert.equal(mounted.registrations.filter((entry) => entry.name === 'settings.section').length, 2);
  const section = storageSections[0]!.component;

  // 首次渲染触发挂载刷新（effect 在渲染期间启动，状态在下一渲染可见）。
  harness.render(section);
  assert.equal(apiCalls.length, 1);
  const loadingView = harness.render(section);
  assert.equal(findByMarker(loadingView, 'data-storage-loading').length, 1);
  assert.equal(textOf(findByMarker(loadingView, 'data-storage-loading')[0]!), '正在扫描…');

  resolveRefresh({ ok: true, value: snapshot() });
  await harness.flush();
  const rendered = harness.render(section);
  assert.equal(findByMarker(rendered, 'data-storage-total').length, 1);
  const cacheRow = findByMarker(rendered, 'data-storage-cache')[0];
  const sessionsRow = findByMarker(rendered, 'data-storage-sessions')[0];
  const otherRow = findByMarker(rendered, 'data-storage-other')[0];
  assert.ok(cacheRow);
  assert.ok(sessionsRow);
  assert.ok(otherRow);
  const text = textOf(rendered);
  assert.equal(text.includes('缓存数据'), true);
  assert.equal(text.includes('会话数据'), true);
  assert.equal(text.includes('其他数据'), true);
  assert.equal(text.includes('本页不能删除'), true);

  const buttonsIn = (row: RenderedElement): RenderedElement[] => {
    const found: RenderedElement[] = [];
    walk(row, (element) => {
      if (element.type === 'button') found.push(element);
    });
    return found;
  };
  assert.equal(buttonsIn(otherRow).length, 0);
  const cacheClean = buttonsIn(cacheRow).find((button) => textOf(button) === '前往清理');
  const sessionsClean = buttonsIn(sessionsRow).find((button) => textOf(button) === '前往清理会话');
  if (!cacheClean || !cacheClean.props) assert.fail('缓存行缺少「前往清理」按钮');
  if (!sessionsClean || !sessionsClean.props) assert.fail('会话行缺少「前往清理会话」按钮');
  assert.equal(cacheClean.props.disabled, false);
  assert.equal(sessionsClean.props.disabled, false);

  const cleanOnClick = cacheClean.props.onClick;
  if (typeof cleanOnClick !== 'function') assert.fail('缓存清理按钮缺少点击处理');
  (cleanOnClick as () => void)();
  await harness.flush();
  const afterClean = harness.render(section);
  assert.deepEqual(apiCalls, ['refresh', 'cleanCache']);
  assert.equal(textOf(afterClean).includes('本页不能删除'), true);
  assert.equal(findByMarker(afterClean, 'data-storage-cache').length, 1);
  mounted.cleanup();
});

test('跨卷快照展示对比条范围说明', async () => {
  const harness = createHarness();
  let resolveRefresh: (value: unknown) => void = () => {};
  const refreshGate = new Promise<unknown>((resolve) => {
    resolveRefresh = resolve;
  });
  harness.reset({ refresh: async () => refreshGate });
  const mounted = await harness.mount();
  const section = mounted.registrations.find((entry) => entry.name === 'settings.section'
    && String(entry.options.id) === 'dsh-forge-storage')?.component;
  assert.ok(section);
  harness.render(section);
  resolveRefresh({ ok: true, value: snapshot({ userDataOnDifferentVolume: true }) });
  await harness.flush();
  const rendered = harness.render(section);
  assert.equal(findByMarker(rendered, 'data-storage-bar').length, 1);
  const text = textOf(rendered);
  assert.equal(text.includes('对比条只统计 DSH Home 所在磁盘'), true);
  assert.equal(text.includes('954 MB'), true);
  mounted.cleanup();
});

test('页面卸载后迟到结果不写回 UI', async () => {
  const harness = createHarness();
  let resolveRefresh: (value: unknown) => void = () => {};
  const refreshGate = new Promise<unknown>((resolve) => {
    resolveRefresh = resolve;
  });
  harness.reset({ refresh: async () => refreshGate });
  const mounted = await harness.mount();
  const section = mounted.registrations.find((entry) => entry.name === 'settings.section'
    && String(entry.options.id) === 'dsh-forge-storage')?.component;
  assert.ok(section);
  harness.render(section);
  // 页面卸载：先执行 effects 清理（mounted=false），再让迟到结果返回。
  mounted.cleanup();
  resolveRefresh({ ok: true, value: snapshot() });
  await harness.flush();

  assert.equal(harness.hookValues[1], null);
  const afterUnmount = harness.render(section);
  assert.equal(findByMarker(afterUnmount, 'data-storage-loading').length, 0);
  assert.doesNotThrow(() => harness.render(section));
});

test('Remote 失败时页面显示可理解的错误而不是内部路径', async () => {
  const harness = createHarness();
  harness.reset({
    refresh: async () => {
      throw new Error('STORAGE_BUSY: busy');
    },
  });
  const mounted = await harness.mount();
  const section = mounted.registrations.find((entry) => entry.name === 'settings.section'
    && String(entry.options.id) === 'dsh-forge-storage')?.component;
  assert.ok(section);
  harness.render(section);
  await harness.flush();
  const rendered = harness.render(section);
  const text = textOf(rendered);
  assert.equal(findByMarker(rendered, 'data-storage-inline-error').length, 1);
  assert.equal(text.includes('请稍后重试'), true);
  assert.equal(text.includes('/Users/'), false);
  mounted.cleanup();
});
