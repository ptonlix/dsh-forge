import type { Readable } from 'node:stream';

/** desktop capability 协议版本；实现与 launcher 必须同步升级。 */
export const DESKTOP_PROTOCOL: 1;

export interface DesktopProfileSummary {
  name: string;
  dir?: string;
  exists?: boolean;
  bundles?: readonly string[];
  webCompatible?: boolean;
  default?: boolean;
  selectable: boolean;
  error?: string | null;
  reason?: string | null;
}

export interface DesktopProfileSelection {
  readonly id: string;
  readonly profile: string;
  readonly stage: string;
  readonly closed: boolean;
}

/** profile 选择服务的公开只读合同。 */
export interface DesktopProfiles {
  readonly current: string | null;
  snapshot(): Readonly<{ protocol: 1; current: string | null; profiles: readonly DesktopProfileSummary[] }>;
  list(): readonly DesktopProfileSummary[];
  select(name: string): Promise<DesktopProfileSelection>;
}

/** pnpm operation 的输出流、完成结果和取消操作。 */
export interface DesktopPnpmOperation {
  readonly stdout: Readable;
  readonly stderr: Readable;
  readonly done: Promise<Readonly<{ exitCode: number | null; signal: NodeJS.Signals | null; cancelled: boolean }>>;
  cancel(): Promise<void>;
}

/** profile 范围的 pnpm 命令服务。 */
export interface DesktopPnpm {
  runPlugin(args: readonly string[], options?: object): DesktopPnpmOperation;
  installPlugin(request: object, options?: object): DesktopPnpmOperation;
}

/** 创建跨插件边界传递的冻结 profile 快照。 */
export function createProfileSnapshot(
  current: string | null,
  profiles: readonly DesktopProfileSummary[],
): Readonly<object>;
