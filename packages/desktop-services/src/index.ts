import type { Context } from '@deepseek-ai/cordis';
import type { Readable } from 'node:stream';

/** 公开桌面服务协议的当前主版本。 */
export const DESKTOP_SERVICES_PROTOCOL = 1 as const;

/** Cordis 中由桌面 layer 发布的稳定 service 名称。 */
export const desktopServiceNames = Object.freeze({
  profiles: 'desktopProfiles',
  pnpm: 'desktopPnpm',
  descriptor: 'desktopServices',
});

/** 公开服务的只读描述；它说明协议，不授予 Electron 或 Node 权限。 */
export interface DesktopServicesDescriptor {
  readonly protocol: typeof DESKTOP_SERVICES_PROTOCOL;
  readonly executionMode: 'trusted-in-process';
  readonly services: readonly [
    typeof desktopServiceNames.profiles,
    typeof desktopServiceNames.pnpm,
    typeof desktopServiceNames.descriptor,
  ];
}

export interface DesktopProfileSummary {
  readonly name: string;
  readonly exists: boolean;
  readonly bundles: readonly string[];
  readonly webCompatible: boolean;
  readonly default: boolean;
  readonly selectable: boolean;
  readonly error: string | null;
  readonly reason: string | null;
}

/** generation 内稳定的 profile 事实；所有层级均为只读。 */
export interface DesktopProfileSnapshot {
  readonly protocol: typeof DESKTOP_SERVICES_PROTOCOL;
  readonly current: string | null;
  readonly profiles: readonly DesktopProfileSummary[];
}

/** profile 选择会持久化下一次启动目标，并完整重启当前 generation。 */
export interface DesktopProfileSelection {
  readonly id: string;
  readonly profile: string;
  readonly stage: string;
  readonly closed: boolean;
}

/** 当前 generation 的 profile service。调用已关闭 generation 的方法会失败。 */
export interface DesktopProfiles {
  readonly current: string | null;
  snapshot(): Readonly<DesktopProfileSnapshot>;
  list(): readonly DesktopProfileSummary[];
  select(name: string): Promise<DesktopProfileSelection>;
}

/** 只读检查、受控同步与受控卸载的完整 command contract。 */
export type DesktopPnpmCommand =
  | Readonly<{ readonly kind: 'inspect'; readonly query: 'list' | 'why'; readonly packageName?: string; readonly depth?: number }>
  | Readonly<{ readonly kind: 'reconcile' }>
  | Readonly<{ readonly kind: 'remove'; readonly packageName: string }>;

export interface DesktopPnpmResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly cancelled: boolean;
}

/**
 * 受管 pnpm operation。`done` 在进程树、reconcile、来源校验、receipt 或恢复全部
 * 结束后才结算；`cancel()` 可重复调用。
 */
export interface DesktopPnpmOperation {
  readonly stdout: Readable;
  readonly stderr: Readable;
  readonly done: Promise<Readonly<DesktopPnpmResult>>;
  cancel(): Promise<void>;
}

/** operation 只允许传递取消信号；工作目录和 pnpm 参数由 provider 所有。 */
export interface DesktopPnpmOptions {
  readonly signal?: AbortSignal;
}

export interface RegistryInstallSource {
  readonly kind: 'registry';
  readonly registry: string;
  readonly tarball: string;
  readonly integrity: string;
}

export interface GitInstallSource {
  readonly kind: 'git';
  readonly repository: string;
  readonly commit: string;
}

/** workspace catalog 可以被审计展示，但 provider 不允许它触发动态安装。 */
export interface WorkspaceInstallSource {
  readonly kind: 'workspace';
  readonly path: string;
}

export type ConfirmedPluginInstallSource = RegistryInstallSource | GitInstallSource | WorkspaceInstallSource;

const confirmedPluginInstallBrand = Symbol.for('@dsh-forge/desktop-services.confirmed-plugin-install');

/**
 * 已确认安装请求绑定 catalog、目标 profile 和确认事实。此品牌帮助受支持路径避免
 * 将展示对象误作授权；它不构成对同进程代码的安全隔离。
 */
export interface ConfirmedPluginInstall {
  readonly catalogId: string;
  readonly profile: string;
  readonly packageName: string;
  readonly version: string;
  readonly source: ConfirmedPluginInstallSource;
  readonly integrity?: string;
  readonly allowBuilds: readonly string[];
  readonly confirmedAt: string;
  readonly confirmation: Readonly<{ readonly kind: 'dsh-forge/catalog-confirmation@1'; readonly userConfirmed: true }>;
  readonly [confirmedPluginInstallBrand]: true;
}

/** profile 范围的受管 package service，禁止原始参数数组和任意 options 对象。 */
export interface DesktopPnpm {
  run(command: DesktopPnpmCommand, options?: DesktopPnpmOptions): DesktopPnpmOperation;
  install(request: ConfirmedPluginInstall, options?: DesktopPnpmOptions): DesktopPnpmOperation;
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return value;
}

/** provider 在启动 package manager 前验证授权值的运行时品牌。 */
export function isConfirmedPluginInstall(value: unknown): value is ConfirmedPluginInstall {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<PropertyKey, unknown>)[confirmedPluginInstallBrand] === true &&
    (value as { readonly confirmation?: { readonly kind?: unknown; readonly userConfirmed?: unknown } }).confirmation
      ?.kind === 'dsh-forge/catalog-confirmation@1' &&
    (value as { readonly confirmation?: { readonly userConfirmed?: unknown } }).confirmation?.userConfirmed === true
  );
}

/** 创建深度冻结的 profile snapshot，禁止 consumer 反向修改 launcher 状态。 */
export function createDesktopProfileSnapshot(
  current: string | null,
  profiles: readonly DesktopProfileSummary[],
): Readonly<DesktopProfileSnapshot> {
  return deepFreeze({
    protocol: DESKTOP_SERVICES_PROTOCOL,
    current,
    profiles: profiles.map((profile) => ({ ...profile, bundles: [...profile.bundles] })),
  });
}

/** 在操作前显式协商桌面服务协议，主版本不匹配时不允许推断行为。 */
export function assertDesktopServicesProtocol(
  descriptor: Readonly<{ readonly protocol: number }>,
  requiredProtocol = DESKTOP_SERVICES_PROTOCOL,
): asserts descriptor is DesktopServicesDescriptor {
  if (descriptor.protocol !== requiredProtocol) {
    throw new Error(`desktop services 协议不兼容: 需要 ${requiredProtocol}，实际 ${descriptor.protocol}`);
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    desktopProfiles: import('@dsh-forge/desktop-services').DesktopProfiles;
    desktopPnpm: import('@dsh-forge/desktop-services').DesktopPnpm;
    desktopServices: import('@dsh-forge/desktop-services').DesktopServicesDescriptor;
  }
}

export type DesktopServicesContext = Pick<
  Context,
  (typeof desktopServiceNames)[keyof typeof desktopServiceNames]
>;
