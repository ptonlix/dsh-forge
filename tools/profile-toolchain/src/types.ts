/**
 * 项目跨模块共享的结构化类型。
 *
 * 外部 JSON、YAML、IPC 报文和插件对象在进入业务层前保持不可信；解析器
 * 使用 `unknown` 接收原始值，完成校验后才转换为这里定义的稳定契约。
 * 这里的类型只描述已经被项目代码认可的形状，不承担运行时校验职责。
 */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue | undefined;
}

export type JsonRecord = Readonly<Record<string, JsonValue | undefined>>;

export interface ErrorLike {
  readonly message: string;
  readonly name?: string;
  readonly code?: string;
  readonly stack?: string;
  readonly cause?: unknown;
}

export interface ProfileSummary {
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

export interface ProfileStateFailure {
  readonly target: string | null;
  readonly stage: string;
  readonly attempt: number;
  readonly reason: string;
  readonly occurredAt: string;
}

export interface ProfileState {
  version: number;
  active: string | null;
  pending: { readonly profile: string; readonly requestedAt: string } | null;
  lastKnownGood: string | null;
  generationId: string | null;
  lastFailure: ProfileStateFailure | null;
  manualRecovery: { readonly target: string; readonly reason: string; readonly stage: string } | null;
}

export interface ActivityRecord {
  readonly generationId?: string;
  readonly profile?: string;
  readonly startedAt?: string;
  readonly corrupt?: boolean;
}

export interface StateStore {
  /** 读取状态；文件损坏时由实现生成带失败事实的安全默认值。 */
  load(): ProfileState;
  save(state: ProfileState): ProfileState;
  markActivity(record: ActivityRecord): void;
  clearActivity(): void;
  readActivity(): ActivityRecord | null;
}

export interface Disposable {
  dispose?: (reason?: string) => void | Promise<void>;
}

export interface GenerationHooks {
  /** generation 生命周期钩子；每个钩子都受启动器的超时与失败回滚策略约束。 */
  prepare?: (generation: GenerationLike) => void | Promise<void>;
  hostReady?: (generation: GenerationLike) => void | Promise<void>;
  webReady?: (generation: GenerationLike) => void | Promise<void>;
  windowReady?: (generation: GenerationLike) => void | Promise<void>;
  rendererReady?: (generation: GenerationLike) => void | Promise<void>;
  interactionReady?: (generation: GenerationLike) => void | Promise<void>;
  hideWindow?: (generation: GenerationLike) => void | Promise<void>;
  dispose?: (generation: GenerationLike, reason?: string) => void | Promise<void>;
}

export interface GenerationLike extends Disposable {
  readonly id: string;
  readonly profile: string;
  readonly context: JsonRecord;
  readonly stage: string;
  readonly closed: boolean;
  attach(service: Disposable): void;
}

export interface GenerationManagerOptions {
  readonly stateStore: StateStore;
  readonly hooks?: GenerationHooks;
  readonly healthDeadlineMs?: number;
  readonly profiles?: readonly ProfileSummary[];
}

export interface Overlay {
  readonly port?: number;
  readonly profilePath?: string;
  readonly homePath?: string;
  readonly platformProvider?: string;
  readonly generationId?: string;
  readonly runtimePath?: string;
  readonly loopbackUrl?: string;
}

export interface ProcessResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly cancelled: boolean;
}

export interface ProcessOperation extends Disposable {
  /** 受管进程的输出流、完成结果和可重复调用的取消操作。 */
  readonly stdout: NodeJS.ReadableStream;
  readonly stderr: NodeJS.ReadableStream;
  readonly done: Promise<Readonly<ProcessResult>>;
  cancel(): Promise<void>;
}

export interface SpawnOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly signal?: AbortSignal;
  readonly reconcile?: () => void | Promise<void>;
  readonly verifyNextGeneration?: () => boolean | Promise<boolean>;
  readonly source?: string;
  readonly [key: string]: unknown;
}

export interface RuntimeTarget {
  readonly os: 'darwin' | 'win32' | 'linux';
  readonly architectures: readonly ('arm64' | 'x64' | 'ia32')[];
  readonly nativeFiles?: readonly NativeFile[];
}

export type NativeFileRoot = 'app.asar.unpacked' | 'dsh-forge/profile' | 'dsh-forge/runtime';

export interface NativeFile {
  /** 打包资源中的受限根目录，path 永远相对于该根目录。 */
  readonly root: NativeFileRoot;
  readonly path: string;
  readonly executable: boolean;
  readonly sha256: string;
}

export interface RuntimeManifest {
  /** 已打包运行时的可审计清单；targets 与 nativeAddons 用于发布前平台校验。 */
  readonly packageRoot: string | null;
  readonly inputDigest?: string;
  readonly targets: readonly RuntimeTarget[];
  readonly declaredTargets?: readonly RuntimeTarget[];
  readonly nativeAddons?: readonly NativeFile[];
  readonly signing?: { readonly signed: boolean; readonly kind?: string };
  readonly [key: string]: unknown;
}

export interface PackageInspection {
  readonly valid: boolean;
  readonly failures: readonly Record<string, unknown>[];
  readonly signing?: RuntimeManifest['signing'];
}

export interface UpdateInstallResult {
  /** 更新器完成或保留当前版本后的显式结果，禁止用布尔值表达失败原因。 */
  readonly installed: boolean;
  readonly retainedVersion?: string;
  readonly reason?: string;
  readonly staged?: string;
}

export function errorMessage(error: unknown): string {
  /** 将任意 catch 值转换为稳定诊断文本，不假设异常一定是 Error 实例。 */
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return String(error);
}

export function errorCode(error: unknown): string | undefined {
  /** 从未知异常中提取可选错误码，供 CLI 和恢复逻辑选择稳定分支。 */
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return undefined;
}
