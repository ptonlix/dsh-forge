import * as fs from 'node:fs';
import * as path from 'node:path';
import { createProfileSnapshot } from '../../packages/desktop-plugin/contracts/index.ts';
import { fail } from '../core/errors.ts';
import { errorMessage } from '../types.ts';
import type { GenerationLike, ProcessOperation, ProcessResult, ProfileSummary, SpawnOptions } from '../types.ts';
import { spawnTree } from './process-tree.ts';

/**
 * 受 launcher 所有的桌面服务。
 *
 * desktopPnpm 仅在选中 profile 内运行受管 pnpm 命令，安装会先写入只含受保护
 * profile 文件的 WAL 快照；失败恢复这些文件，但明确不承诺回滚 node_modules。
 * desktopProfiles 则把 profile 选择限制在当前 generation 生命周期内。
 */

export interface ProfileSnapshot {
  readonly 'package.json': string | null;
  readonly 'pnpm-lock.yaml': string | null;
  readonly 'pnpm-workspace.yaml': string | null;
}

export interface RecoveryFact {
  readonly recovered: boolean;
  readonly manualRecovery: boolean;
  readonly reason?: string | null;
}

export interface PluginInstallationRequest {
  readonly bundle: string;
  readonly version: string;
  readonly source: string;
  readonly allowBuilds?: readonly string[];
}

export interface DesktopServiceOptions {
  readonly generation?: GenerationLike;
  readonly profileDir: string;
  readonly pnpm?: string;
  readonly pnpmArgs?: readonly string[];
  readonly pnpmEnv?: NodeJS.ProcessEnv;
  readonly spawn?: SpawnFunction;
  readonly transactionDir?: string;
  readonly initializeProfile?: (profileDir: string) => void;
  readonly manager?: ProfileManager;
  readonly profiles?: readonly ProfileSummary[];
}

export interface DesktopOperationOptions extends SpawnOptions {
  readonly reconcile?: () => void | Promise<void>;
  readonly verifyNextGeneration?: () => boolean | Promise<boolean>;
}

export type SpawnFunction = (command: string, args: readonly string[], options?: SpawnOptions) => ProcessOperation;

export interface ProfileManager {
  select(profile: string): Promise<GenerationLike>;
}

interface ProtectedProfileFile {
  readonly file: keyof ProfileSnapshot;
  readonly target: string;
}

/** 拒绝空字符串与 NUL，防止参数进入路径、命令或配置边界。 */
export function validateText(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0'))
    fail(`${label} 为空或包含 NUL`, 'SERVICE_ARGUMENT');
}

/** 验证 cwd 是现存绝对目录，后续调用还会限制其不得离开 profile 根目录。 */
export function validateCwd(cwd: unknown): asserts cwd is string {
  validateText(cwd, 'cwd');
  if (!path.isAbsolute(cwd) || !fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory())
    fail(`cwd 无效: ${cwd}`, 'SERVICE_CWD');
}

function protectedProfileFiles(profileDir: string): ProtectedProfileFile[] {
  return (['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'] as const).map((file) => ({
    file,
    target: path.join(profileDir, file),
  }));
}

/** 读取安装事务可恢复的 profile 文件；node_modules 不属于快照范围。 */
export function snapshotProfile(profileDir: string): ProfileSnapshot {
  const snapshot: Record<keyof ProfileSnapshot, string | null> = {
    'package.json': null,
    'pnpm-lock.yaml': null,
    'pnpm-workspace.yaml': null,
  };
  for (const { file, target } of protectedProfileFiles(profileDir)) {
    snapshot[file] = fs.existsSync(target) ? fs.readFileSync(target).toString('base64') : null;
  }
  return snapshot;
}

/** 按 WAL 快照恢复受保护文件，删除快照中不存在的目标文件。 */
export function restoreProfile(profileDir: string, snapshot: ProfileSnapshot): void {
  for (const { file, target } of protectedProfileFiles(profileDir)) {
    const content = snapshot[file];
    if (content === null || content === undefined) {
      if (fs.existsSync(target)) fs.unlinkSync(target);
    } else {
      fs.writeFileSync(target, Buffer.from(content, 'base64'), { mode: 0o600 });
    }
  }
}

/** 恢复未完成的安装 WAL，并报告是否必须人工处理 node_modules 状态。 */
export function recoverTransactions(profileDir: string, transactionDir: string): RecoveryFact {
  if (!fs.existsSync(transactionDir)) return { recovered: false, manualRecovery: false };
  let recovered = false;
  for (const file of fs.readdirSync(transactionDir).filter((name) => /^install-.*\.json$/.test(name))) {
    const target = path.join(transactionDir, file);
    try {
      const transaction = JSON.parse(fs.readFileSync(target, 'utf8')) as { snapshot?: ProfileSnapshot };
      if (!transaction.snapshot) throw new Error('恢复事务缺少配置快照');
      restoreProfile(profileDir, transaction.snapshot);
      fs.renameSync(target, `${target}.recovered`);
      recovered = true;
    } catch (error) {
      return { recovered, manualRecovery: true, reason: errorMessage(error) };
    }
  }
  return {
    recovered,
    manualRecovery: recovered,
    reason: recovered ? '已恢复受保护配置；node_modules 未自动回滚' : null,
  };
}

function wrapOperation(operation: ProcessOperation, done: Promise<Readonly<ProcessResult>>): ProcessOperation {
  return Object.freeze({
    stdout: operation.stdout,
    stderr: operation.stderr,
    done,
    cancel: () => operation.cancel(),
  });
}

/**
 * profile 范围内的 pnpm 执行器。单个 provider 同一时间只允许一个 operation；
 * 关闭 generation、人工恢复状态、越界 cwd、动态版本和未经授权的 add 都会被拒绝。
 */
export class DesktopPnpmProvider {
  readonly generation?: GenerationLike;
  readonly profileDir: string;
  readonly pnpm: string;
  readonly pnpmArgs: readonly string[];
  readonly pnpmEnv: NodeJS.ProcessEnv;
  spawn: SpawnFunction;
  readonly transactionDir: string;
  readonly initializeProfile?: (profileDir: string) => void;
  busy: ProcessOperation | null = null;
  closed = false;
  recoveryFact: RecoveryFact | null = null;

  constructor({
    generation,
    profileDir,
    pnpm = 'pnpm',
    pnpmArgs = [],
    pnpmEnv = {},
    spawn = spawnTree,
    transactionDir,
    initializeProfile,
  }: DesktopServiceOptions) {
    validateCwd(profileDir);
    this.generation = generation;
    this.profileDir = path.resolve(profileDir);
    this.pnpm = pnpm;
    this.pnpmArgs = pnpmArgs.slice();
    this.pnpmEnv = { ...pnpmEnv };
    this.spawn = spawn;
    this.transactionDir = transactionDir || path.join(this.profileDir, '.recovery');
    this.initializeProfile = initializeProfile;
    const recovery = recoverTransactions(this.profileDir, this.transactionDir);
    if (recovery.manualRecovery) this.recoveryFact = Object.freeze(recovery);
    generation?.attach(this);
  }

  private start(args: readonly string[], options: DesktopOperationOptions = {}): ProcessOperation {
    if (this.closed || this.generation?.closed) fail('desktopPnpm generation 已关闭', 'GENERATION_CLOSED');
    if (this.recoveryFact?.manualRecovery)
      fail(`profile 需要人工恢复: ${this.recoveryFact.reason}`, 'INSTALL_MANUAL_RECOVERY');
    if (this.busy) fail('desktopPnpm operation 正在运行', 'PACKAGE_BUSY');
    this.initializeProfile?.(this.profileDir);
    const cwd = path.resolve(options.cwd || this.profileDir);
    validateCwd(cwd);
    if (cwd !== this.profileDir && !cwd.startsWith(`${this.profileDir}${path.sep}`))
      fail(`operation 不得离开 profile 目录: ${cwd}`, 'SERVICE_CWD');
    if (!Array.isArray(args) || args.some((arg) => typeof arg !== 'string' || arg.includes('\0')))
      fail('package 参数无效', 'SERVICE_ARGUMENT');
    if (options.signal?.aborted) fail('operation signal 已取消', 'PACKAGE_CANCELLED');
    const operation = this.spawn(this.pnpm, [...this.pnpmArgs, ...args], {
      cwd,
      env: { ...process.env, ...this.pnpmEnv, ...options.env },
      signal: options.signal,
    });
    this.busy = operation;
    const done = operation.done.finally(() => {
      if (this.busy === operation) this.busy = null;
    });
    if (options.signal) options.signal.addEventListener('abort', () => void operation.cancel(), { once: true });
    return wrapOperation(operation, done);
  }

  runPlugin(args: readonly string[], options: DesktopOperationOptions = {}): ProcessOperation {
    if (!Array.isArray(args) || args.includes('add'))
      fail('runPlugin 不允许执行 add；请使用 installPlugin', 'PACKAGE_INSTALL_API');
    let effectiveOptions = options;
    if (options.source !== undefined) {
      validateText(options.source, 'source');
      if (path.isAbsolute(options.source)) fail('插件 source 必须相对 profile 目录', 'SERVICE_ARGUMENT');
      effectiveOptions = { ...options, cwd: path.resolve(this.profileDir, options.source) };
    }
    const operation = this.start(args, effectiveOptions);
    if (!options.reconcile) return operation;
    const done = operation.done.then(async (result) => {
      if (result.exitCode === 0 && !result.signal) await options.reconcile?.();
      return result;
    });
    return wrapOperation(operation, done);
  }

  installPlugin(
    { bundle, version, source, allowBuilds = [] }: PluginInstallationRequest,
    options: DesktopOperationOptions = {},
  ): ProcessOperation {
    validateText(bundle, 'bundle');
    validateText(version, 'version');
    validateText(source, 'source');
    if (path.isAbsolute(source) || source.includes('..')) fail('安装来源必须是受审计的相对标识', 'SERVICE_ARGUMENT');
    if (!/^\d+\.\d+\.\d+$/.test(version)) fail('installPlugin 必须使用精确版本', 'PACKAGE_VERSION');
    fs.mkdirSync(this.transactionDir, { recursive: true, mode: 0o700 });
    const snapshot = snapshotProfile(this.profileDir);
    const wal = path.join(this.transactionDir, `install-${Date.now()}-${process.pid}.json`);
    fs.writeFileSync(
      wal,
      JSON.stringify({
        bundle,
        version,
        source,
        allowBuilds: [...allowBuilds],
        snapshot,
        startedAt: new Date().toISOString(),
      }),
      { flag: 'wx', mode: 0o600 },
    );
    let operation: ProcessOperation;
    try {
      operation = this.start(
        [
          'add',
          '--save-exact',
          '--ignore-scripts',
          `${bundle}@${version}`,
          `--config.allowBuilds=${allowBuilds.join(',')}`,
          '--filter',
          './',
        ],
        options,
      );
    } catch (error) {
      fs.unlinkSync(wal);
      throw error;
    }
    const done = operation.done.then(async (result) => {
      if (result.exitCode !== 0 || result.signal) {
        restoreProfile(this.profileDir, snapshot);
        fs.writeFileSync(`${wal}.failed`, JSON.stringify({ result, nodeModulesRestored: false }));
        fs.unlinkSync(wal);
        return result;
      }
      try {
        await options.reconcile?.();
        const healthy = await options.verifyNextGeneration?.();
        if (healthy !== true) throw new Error('下一 generation 健康检查失败');
        fs.writeFileSync(
          `${wal}.receipt`,
          JSON.stringify({ bundle, version, source, committedAt: new Date().toISOString() }),
        );
        fs.unlinkSync(wal);
        return result;
      } catch (error) {
        restoreProfile(this.profileDir, snapshot);
        fs.writeFileSync(
          `${wal}.manual-recovery`,
          JSON.stringify({ reason: errorMessage(error), nodeModulesRestored: false }),
        );
        fs.unlinkSync(wal);
        this.recoveryFact = Object.freeze({ recovered: true, manualRecovery: true, reason: errorMessage(error) });
        fail(`安装后 generation 未通过健康检查，进入人工恢复: ${errorMessage(error)}`, 'INSTALL_MANUAL_RECOVERY');
      }
    });
    return wrapOperation(operation, done);
  }

  async dispose(): Promise<void> {
    this.closed = true;
    const operation = this.busy;
    if (!operation) return;
    await operation.cancel();
    await operation.done;
  }
}

/** 当前 generation 的只读 profile 列表和选择服务。 */
export class DesktopProfilesProvider {
  readonly generation?: GenerationLike;
  readonly manager?: ProfileManager;
  readonly profiles: readonly ProfileSummary[];
  current: string | null;

  constructor({
    generation,
    manager,
    profiles = [],
  }: Pick<DesktopServiceOptions, 'generation' | 'manager' | 'profiles'>) {
    this.generation = generation;
    this.manager = manager;
    this.profiles = profiles.map((profile) => Object.freeze({ ...profile }));
    this.current = generation?.profile || null;
    generation?.attach(this);
  }
  snapshot() {
    this.assertOpen();
    return createProfileSnapshot(this.current, this.profiles);
  }
  list(): readonly ProfileSummary[] {
    this.assertOpen();
    return this.profiles.map((profile) =>
      Object.freeze({ ...profile, selectable: profile.selectable !== false, reason: profile.reason || null }),
    );
  }
  select(profile: string): Promise<GenerationLike> {
    this.assertOpen();
    validateText(profile, 'profile');
    if (!this.manager) fail('desktopProfiles manager 不可用', 'SERVICE_CONFIG');
    return this.manager.select(profile);
  }
  private assertOpen(): void {
    if (!this.generation || this.generation.closed) fail('desktopProfiles generation 已关闭', 'GENERATION_CLOSED');
  }
  async dispose(): Promise<void> {
    this.current = null;
  }
}

/** 同时创建并冻结 desktopProfiles 与 desktopPnpm，作为注入到 DSH Host 的 capability。 */
export function createDesktopServices(options: DesktopServiceOptions): Readonly<{
  desktopProfiles: DesktopProfilesProvider;
  desktopPnpm: DesktopPnpmProvider;
}> {
  const profiles = new DesktopProfilesProvider(options);
  const pnpm = new DesktopPnpmProvider(options);
  return Object.freeze({ desktopProfiles: profiles, desktopPnpm: pnpm });
}
