import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse as parseSemVer } from 'semver';
import { parse as parseYaml } from 'yaml';
import {
  isConfirmedPluginInstall,
  type ConfirmedPluginInstall,
  type ConfirmedPluginInstallSource,
  type DesktopPnpm,
  type DesktopPnpmCommand,
  type DesktopPnpmOperation,
  type DesktopPnpmOptions,
  type DesktopPnpmResult,
  type GitInstallSource,
} from '@dsh-forge/desktop-services';
import { errorMessage } from '@dsh-forge/profile-toolchain/types';
import { fail } from './errors.ts';
import { spawnTree } from './process-tree.ts';
import {
  recoverTransactions,
  restoreProfile,
  snapshotProfile,
  writeJsonExclusive,
  type InstallReceipt,
  type InstallWal,
} from './recovery.ts';
import type {
  DesktopHostCapability,
  ProcessOperation,
  RecoveryFact,
  ResolvedInstallFact,
  SpawnFunction,
} from './types.ts';

const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i;
const STRICT_VERSION_PATTERN = new RegExp(
  '^(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)' +
    '(?:-[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$',
);
const GIT_COMMIT_PATTERN = /^[0-9a-f]{40}$/i;

interface LeaseOperation extends DesktopPnpmOperation {
  readonly source: ProcessOperation;
}

interface PackageLockResolution {
  readonly packageName: string;
  readonly version: string;
  readonly source: Readonly<Record<string, unknown>>;
  readonly integrity?: string;
}

function assertPackageName(value: string, label = 'packageName'): void {
  if (!PACKAGE_NAME_PATTERN.test(value) || value.includes('\0')) fail(`${label} 无效: ${value}`, 'SERVICE_ARGUMENT');
}

/** 使用 SemVer 解析器和严格文本格式拒绝 range、tag、workspace 与 file alias。 */
export function assertExactSemVer(value: string): void {
  if (!STRICT_VERSION_PATTERN.test(value) || !parseSemVer(value, { loose: false }))
    fail(`版本必须是精确 SemVer: ${value}`, 'PACKAGE_VERSION');
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function string(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function equalJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sourceFromCatalog(entry: DesktopHostCapability['catalog'][number]): ConfirmedPluginInstallSource {
  const source = object(entry.source);
  if (!source) fail(`catalog 来源无效: ${entry.id}`, 'CATALOG_INSTALL_SOURCE');
  if (source.kind === 'npm') {
    const registry = string(source.registry);
    const tarball = string(source.tarball);
    if (!registry || !tarball || !entry.integrity)
      fail(`registry catalog 缺少 registry、tarball 或 integrity: ${entry.id}`, 'CATALOG_INSTALL_SOURCE');
    return Object.freeze({ kind: 'registry', registry, tarball, integrity: entry.integrity });
  }
  if (source.kind === 'git') {
    const repository = string(source.repository);
    const commit = string(source.commit);
    if (!repository || !commit || !GIT_COMMIT_PATTERN.test(commit))
      fail(`git catalog 必须使用完整 commit: ${entry.id}`, 'CATALOG_INSTALL_SOURCE');
    return Object.freeze({ kind: 'git', repository, commit });
  }
  if (source.kind === 'workspace') {
    const workspacePath = string(source.path);
    if (!workspacePath) fail(`workspace catalog 缺少路径: ${entry.id}`, 'CATALOG_INSTALL_SOURCE');
    return Object.freeze({ kind: 'workspace', path: workspacePath });
  }
  fail(`不支持的 catalog 来源: ${entry.id}`, 'CATALOG_INSTALL_SOURCE');
}

/** 将确认请求重新绑定到本 generation 的静态 catalog，而非信任调用方字段。 */
export function assertConfirmedInstall(
  request: ConfirmedPluginInstall,
  capability: Pick<DesktopHostCapability, 'catalog' | 'generation'>,
): void {
  if (!isConfirmedPluginInstall(request) || !Object.isFrozen(request) || !Object.isFrozen(request.source))
    fail('安装请求不是已确认的不可变 catalog 请求', 'CATALOG_CONFIRMATION_REQUIRED');
  if (request.profile !== capability.generation.profile)
    fail(`安装请求绑定了其他 profile: ${request.profile}`, 'CATALOG_PROFILE_MISMATCH');
  assertPackageName(request.packageName);
  assertExactSemVer(request.version);
  if (!request.confirmedAt || Number.isNaN(Date.parse(request.confirmedAt)))
    fail('安装请求缺少确认时间', 'CATALOG_CONFIRMATION_REQUIRED');
  const entry = capability.catalog.find((candidate) => candidate.id === request.catalogId);
  if (!entry) fail(`catalog 条目不存在: ${request.catalogId}`, 'CATALOG_CONFIRMATION_REQUIRED');
  const expectedSource = sourceFromCatalog(entry);
  if (
    entry.packageName !== request.packageName ||
    entry.version !== request.version ||
    !equalJson(expectedSource, request.source) ||
    (request.integrity || undefined) !== (entry.integrity || undefined)
  )
    fail(`安装请求与 catalog 快照不一致: ${request.catalogId}`, 'CATALOG_CONFIRMATION_REQUIRED');
}

function argumentsForCommand(command: DesktopPnpmCommand): readonly string[] {
  if (command.kind === 'inspect') {
    if (command.depth !== undefined && (!Number.isInteger(command.depth) || command.depth < 0 || command.depth > 20))
      fail(`inspect depth 无效: ${command.depth}`, 'SERVICE_ARGUMENT');
    if (command.query === 'why' && !command.packageName) fail('pnpm why 需要 packageName', 'SERVICE_ARGUMENT');
    if (command.packageName) assertPackageName(command.packageName);
    const depth = command.depth === undefined ? [] : [`--depth=${command.depth}`];
    return command.query === 'list'
      ? ['list', ...depth, '--filter', './']
      : ['why', command.packageName!, ...depth, '--filter', './'];
  }
  if (command.kind === 'reconcile') return ['install', '--lockfile-only', '--ignore-scripts', '--filter', './'];
  if (command.kind === 'remove') {
    assertPackageName(command.packageName);
    return ['remove', '--ignore-scripts', command.packageName, '--filter', './'];
  }
  fail('未建模的 package command', 'PACKAGE_COMMAND');
}

function argumentsForInstall(request: ConfirmedPluginInstall): readonly string[] {
  const source = request.source;
  if (source.kind === 'workspace') {
    fail('workspace catalog 条目不能触发动态安装', 'CATALOG_INSTALL_SOURCE');
    throw new Error('workspace catalog 条目不能触发动态安装');
  }
  const gitSource = source as GitInstallSource;
  const spec =
    source.kind === 'registry'
      ? `${request.packageName}@${request.version}`
      : `${request.packageName}@git+${gitSource.repository}#${gitSource.commit}`;
  const sourceArguments = source.kind === 'registry' ? [`--registry=${source.registry}`] : [];
  return [
    'add',
    '--save-exact',
    '--ignore-scripts',
    spec,
    ...sourceArguments,
    `--config.allowBuilds=${request.allowBuilds.join(',')}`,
    '--filter',
    './',
  ];
}

function lockResolution(profileDir: string, request: ConfirmedPluginInstall): ResolvedInstallFact {
  const file = path.join(profileDir, 'pnpm-lock.yaml');
  if (!fs.existsSync(file)) fail('pnpm lockfile 缺失，无法验证实际解析来源', 'INSTALL_LOCKFILE_UNKNOWN');
  const lock = object(parseYaml(fs.readFileSync(file, 'utf8')));
  const packages = lock && object(lock.packages);
  if (!packages) fail('pnpm lockfile 格式未知', 'INSTALL_LOCKFILE_UNKNOWN');
  const keyPrefix = `${request.packageName}@${request.version}`;
  const found = Object.entries(packages).find(([key, value]) => key.startsWith(keyPrefix) && object(value));
  if (!found) fail(`lockfile 未解析已确认 package: ${keyPrefix}`, 'INSTALL_LOCKFILE_UNKNOWN');
  const [, metadata] = found;
  const resolution = object(object(metadata)?.resolution);
  if (!resolution) fail('lockfile resolution 格式未知', 'INSTALL_LOCKFILE_UNKNOWN');
  const actual = resolution as PackageLockResolution['source'];
  if (request.source.kind === 'registry') {
    const tarball = string(actual.tarball);
    const integrity = string(actual.integrity);
    if (tarball !== request.source.tarball || integrity !== request.source.integrity)
      fail('lockfile registry 来源或完整性漂移', 'INSTALL_SOURCE_DRIFT');
    return Object.freeze({
      packageName: request.packageName,
      version: request.version,
      source: { tarball },
      integrity,
    });
  }
  if (request.source.kind === 'workspace') {
    fail('workspace 条目没有可验证的动态安装 lockfile 来源', 'INSTALL_LOCKFILE_UNKNOWN');
    throw new Error('workspace 条目没有可验证的动态安装 lockfile 来源');
  }
  const gitRequest = request.source as GitInstallSource;
  const repository = string(actual.repository) || string(actual.repo);
  const commit = string(actual.commit);
  if (repository !== gitRequest.repository || commit !== gitRequest.commit)
    fail('lockfile Git 来源或 commit 漂移', 'INSTALL_SOURCE_DRIFT');
  return Object.freeze({ packageName: request.packageName, version: request.version, source: { repository, commit } });
}

function frozenOperation(source: ProcessOperation, done: Promise<Readonly<DesktopPnpmResult>>): LeaseOperation {
  return Object.freeze({ stdout: source.stdout, stderr: source.stderr, done, cancel: () => source.cancel(), source });
}

/**
 * generation 私有的 package provider。lease 从请求校验前开始持有，直到进程树、
 * reconcile、来源验证、健康检查与 receipt 或恢复全部完成才释放。
 */
export class DesktopPnpmProvider implements DesktopPnpm {
  private lease: LeaseOperation | 'reserved' | null = null;
  private closed = false;
  private recoveryFact: RecoveryFact | null = null;
  private readonly transactionDir: string;
  private readonly spawn: SpawnFunction;

  constructor(private readonly capability: DesktopHostCapability) {
    if (!path.isAbsolute(capability.profileDir) || !fs.existsSync(capability.profileDir))
      fail(`profileDir 无效: ${capability.profileDir}`, 'SERVICE_CWD');
    this.transactionDir = capability.transactionDir || path.join(capability.profileDir, '.recovery');
    this.spawn = capability.spawn || spawnTree;
    const recovery = recoverTransactions(capability.profileDir, this.transactionDir);
    if (recovery.manualRecovery) this.recoveryFact = recovery;
  }

  run(command: DesktopPnpmCommand, options: DesktopPnpmOptions = {}): DesktopPnpmOperation {
    return this.start(argumentsForCommand(command), options, async (result) => {
      if (result.exitCode === 0 && !result.signal && command.kind !== 'inspect') await this.capability.reconcile();
    });
  }

  install(request: ConfirmedPluginInstall, options: DesktopPnpmOptions = {}): DesktopPnpmOperation {
    return this.withInstall(request, options);
  }

  private withInstall(request: ConfirmedPluginInstall, options: DesktopPnpmOptions): DesktopPnpmOperation {
    this.reserve();
    try {
      this.assertUsable(options);
      assertConfirmedInstall(request, this.capability);
      fs.mkdirSync(this.transactionDir, { recursive: true, mode: 0o700 });
      const snapshot = snapshotProfile(this.capability.profileDir);
      const wal = path.join(this.transactionDir, `install-${Date.now()}-${process.pid}.json`);
      const record: InstallWal = Object.freeze({
        schema: 'dsh-forge/desktop-install-wal@1',
        request,
        snapshot,
        startedAt: new Date().toISOString(),
      });
      writeJsonExclusive(wal, record);
      try {
        return this.spawnReserved(argumentsForInstall(request), options, async (result) => {
          if (result.exitCode !== 0 || result.signal || result.cancelled) {
            restoreProfile(this.capability.profileDir, snapshot);
            writeJsonExclusive(`${wal}.failed`, { request, result, nodeModulesRestored: false, failedAt: new Date().toISOString() });
            fs.unlinkSync(wal);
            return;
          }
          try {
            await this.capability.reconcile();
            const resolved = lockResolution(this.capability.profileDir, request);
            if ((await this.capability.verifyNextGeneration()) !== true) throw new Error('下一 generation 健康检查失败');
            const receipt: InstallReceipt = Object.freeze({
              schema: 'dsh-forge/desktop-install-receipt@1',
              request,
              resolved,
              committedAt: new Date().toISOString(),
            });
            writeJsonExclusive(`${wal}.receipt`, receipt);
            fs.unlinkSync(wal);
          } catch (error) {
            restoreProfile(this.capability.profileDir, snapshot);
            writeJsonExclusive(`${wal}.manual-recovery`, {
              request,
              reason: errorMessage(error),
              nodeModulesRestored: false,
              failedAt: new Date().toISOString(),
            });
            fs.unlinkSync(wal);
            this.recoveryFact = Object.freeze({ recovered: true, manualRecovery: true, reason: errorMessage(error) });
            fail(`安装事务需要人工恢复: ${errorMessage(error)}`, 'INSTALL_MANUAL_RECOVERY');
          }
        });
      } catch (error) {
        if (fs.existsSync(wal)) fs.unlinkSync(wal);
        throw error;
      }
    } catch (error) {
      this.releaseReservation();
      throw error;
    }
  }

  private start(
    args: readonly string[],
    options: DesktopPnpmOptions,
    finalize: (result: Readonly<DesktopPnpmResult>) => void | Promise<void>,
  ): DesktopPnpmOperation {
    this.reserve();
    try {
      this.assertUsable(options);
      return this.spawnReserved(args, options, finalize);
    } catch (error) {
      this.releaseReservation();
      throw error;
    }
  }

  private spawnReserved(
    args: readonly string[],
    options: DesktopPnpmOptions,
    finalize: (result: Readonly<DesktopPnpmResult>) => void | Promise<void>,
  ): DesktopPnpmOperation {
    this.capability.initializeProfile?.(this.capability.profileDir);
    const source = this.spawn(this.capability.pnpm, [...this.capability.pnpmArgs, ...args], {
      cwd: this.capability.profileDir,
      env: { ...process.env, ...this.capability.pnpmEnv },
      signal: options.signal,
    });
    const done = source.done.then(
      async (result) => {
        await finalize(result);
        return result;
      },
      async (error) => {
        throw error;
      },
    ).finally(() => {
      if (this.lease !== 'reserved') this.lease = null;
    });
    const operation = frozenOperation(source, done);
    this.lease = operation;
    if (options.signal) options.signal.addEventListener('abort', () => void source.cancel(), { once: true });
    return operation;
  }

  private reserve(): void {
    if (this.closed || this.capability.generation.closed) fail('desktopPnpm generation 已关闭', 'GENERATION_CLOSED');
    if (this.recoveryFact?.manualRecovery)
      fail(`profile 需要人工恢复: ${this.recoveryFact.reason}`, 'INSTALL_MANUAL_RECOVERY');
    if (this.lease) fail('desktopPnpm operation 正在运行', 'PACKAGE_BUSY');
    this.lease = 'reserved';
  }

  private releaseReservation(): void {
    if (this.lease === 'reserved') this.lease = null;
  }

  private assertUsable(options: DesktopPnpmOptions): void {
    if (options.signal?.aborted) fail('operation signal 已取消', 'PACKAGE_CANCELLED');
  }

  async dispose(): Promise<void> {
    this.closed = true;
    const lease = this.lease;
    if (!lease || lease === 'reserved') return;
    await lease.cancel().catch(() => undefined);
    await lease.done.catch(() => undefined);
  }
}
