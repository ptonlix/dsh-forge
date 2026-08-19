/** desktop capability 协议版本；变更必须同步 launcher 注入端和公开合同。 */
export const DESKTOP_PROTOCOL = 1 as const;

export interface DesktopProfileSummary {
  readonly name: string;
  readonly dir?: string;
  readonly exists?: boolean;
  readonly bundles?: readonly string[];
  readonly webCompatible?: boolean;
  readonly default?: boolean;
  readonly selectable: boolean;
  readonly error?: string | null;
  readonly reason?: string | null;
}

export interface DesktopProfileSelection {
  readonly id: string;
  readonly profile: string;
  readonly stage: string;
  readonly closed: boolean;
}

/** profile 列表服务；snapshot/list 返回值不允许反向修改 launcher 状态。 */
export interface DesktopProfiles {
  readonly current: string | null;
  snapshot(): Readonly<DesktopProfileSnapshot>;
  list(): readonly DesktopProfileSummary[];
  select(name: string): Promise<DesktopProfileSelection>;
}

/** pnpm operation 的输出、完成和取消语义；done 前资源仍归 provider 所有。 */
export interface DesktopPnpmOperation {
  readonly stdout: import('node:stream').Readable;
  readonly stderr: import('node:stream').Readable;
  readonly done: Promise<Readonly<{ exitCode: number | null; signal: NodeJS.Signals | null; cancelled: boolean }>>;
  cancel(): Promise<void>;
}

/** profile 范围的 pnpm 服务；安装入口要求精确版本和受审计来源。 */
export interface DesktopPnpm {
  runPlugin(args: readonly string[], options?: object): DesktopPnpmOperation;
  installPlugin(request: object, options?: object): DesktopPnpmOperation;
}

export interface DesktopProfileSnapshot {
  readonly protocol: typeof DESKTOP_PROTOCOL;
  readonly current: string | null;
  readonly profiles: readonly DesktopProfileSummary[];
}

function freeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
  return value;
}

/** 创建深度冻结的 profile 快照，作为跨插件边界的只读值传递。 */
export function createProfileSnapshot(
  current: string | null,
  profiles: readonly DesktopProfileSummary[],
): Readonly<DesktopProfileSnapshot> {
  return freeze({ protocol: DESKTOP_PROTOCOL, current, profiles: profiles.slice() });
}
