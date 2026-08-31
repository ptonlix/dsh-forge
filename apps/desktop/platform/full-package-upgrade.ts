import * as fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import type { FullPackageUpdatePlatform } from '@dsh-forge/desktop-services-local/launcher';

export interface FullPackageUpgradeRequest {
  readonly platform: FullPackageUpdatePlatform;
  readonly stagedPackage: string;
  readonly stagingDirectory: string;
  readonly electronPid: number;
  readonly executablePath: string;
  readonly appImagePath?: string;
}

interface FullPackageUpgradeConfiguration {
  readonly schema: 'dsh-forge/full-package-upgrade@1';
  readonly platform: FullPackageUpdatePlatform;
  readonly stagedPackage: string;
  readonly electronPid: number;
  readonly macosApplication?: string;
  readonly appImagePath?: string;
}

export interface PreparedFullPackageUpgrade {
  readonly configuration: string;
}

export interface UpgradeCommandResult {
  readonly status: number | null;
}

export interface UpgradeHelperDependencies {
  waitForParentExit(pid: number): Promise<void>;
  run(command: string, args: readonly string[]): UpgradeCommandResult;
  startApplication(executable: string): Promise<void>;
  /** 复制 macOS bundle 时必须保留 framework 的符号链接、资源叉和 ACL。 */
  copyApplication(source: string, destination: string): Promise<void>;
  move(source: string, destination: string): Promise<void>;
}

export interface UpgradeHelperResult {
  readonly success: boolean;
  readonly code: string | null;
}

const CONFIGURATION_SCHEMA = 'dsh-forge/full-package-upgrade@1';

function fail(message: string): never {
  throw new Error(message);
}

function assertAbsoluteFile(value: string, extension: string, label: string): string {
  if (!path.isAbsolute(value) || !value.endsWith(extension)) fail(`${label} 必须是指定格式的绝对路径`);
  const stat = fs.lstatSync(value);
  if (!stat.isFile()) fail(`${label} 必须是普通文件`);
  return path.resolve(value);
}

function assertDescendant(root: string, candidate: string, label: string): string {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) fail(`${label} 不在受控暂存目录内`);
  return resolvedCandidate;
}

function macosApplicationFromExecutable(executable: string): string {
  let cursor = path.resolve(executable);
  while (true) {
    if (cursor.endsWith('.app') && fs.existsSync(cursor) && fs.statSync(cursor).isDirectory()) return cursor;
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  fail('当前 macOS 进程不位于 .app 安装目录');
}

function appImagePath(value: string | undefined): string {
  if (!value || !path.isAbsolute(value)) fail('APPIMAGE 必须是绝对路径');
  const stat = fs.lstatSync(value);
  if (!stat.isFile()) fail('APPIMAGE 必须是可写普通文件');
  fs.accessSync(value, fs.constants.W_OK);
  return path.resolve(value);
}

function extensionFor(platform: FullPackageUpdatePlatform): string {
  if (platform === 'windows') return '.exe';
  if (platform === 'macos') return '.dmg';
  return '.AppImage';
}

/** 在主进程退出前建立不可变 helper 配置，拒绝 URL、renderer 输入与目录外路径。 */
export function createFullPackageUpgradeConfiguration(
  request: FullPackageUpgradeRequest,
): FullPackageUpgradeConfiguration {
  if (!Number.isSafeInteger(request.electronPid) || request.electronPid < 1) fail('Electron PID 无效');
  if (!path.isAbsolute(request.stagingDirectory)) fail('OTA 暂存目录必须是绝对路径');
  const stagedPackage = assertDescendant(
    request.stagingDirectory,
    assertAbsoluteFile(request.stagedPackage, extensionFor(request.platform), '完整安装包'),
    '完整安装包',
  );
  if (request.platform === 'windows')
    return Object.freeze({ schema: CONFIGURATION_SCHEMA, platform: 'windows', stagedPackage, electronPid: request.electronPid });
  if (request.platform === 'macos')
    return Object.freeze({
      schema: CONFIGURATION_SCHEMA,
      platform: 'macos',
      stagedPackage,
      electronPid: request.electronPid,
      macosApplication: macosApplicationFromExecutable(request.executablePath),
    });
  return Object.freeze({
    schema: CONFIGURATION_SCHEMA,
    platform: 'ubuntu',
    stagedPackage,
    electronPid: request.electronPid,
    appImagePath: appImagePath(request.appImagePath),
  });
}

function configurationFile(stagingDirectory: string): string {
  return path.join(path.resolve(stagingDirectory), `.upgrade-${randomUUID()}.json`);
}

function startDetachedHelper(executable: string, helperScript: string, configuration: string): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(executable, [helperScript, '--run-full-package-upgrade', configuration], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      });
    } catch (error) {
      reject(error);
      return;
    }
    child.once('error', reject);
    child.once('spawn', () => {
      child.removeListener('error', reject);
      child.unref();
      resolve(child);
    });
  });
}

/**
 * 先启动会等待当前 PID 的 Node helper，再允许调用方有序释放 generation 并退出。
 * helper 由当前包内的已编译模块执行，不能接受外部命令或 shell 字符串。
 */
export async function prepareFullPackageUpgrade(
  request: FullPackageUpgradeRequest,
  {
    executable = process.execPath,
    helperScript = __filename,
    launch = startDetachedHelper,
  }: {
    readonly executable?: string;
    readonly helperScript?: string;
    readonly launch?: (executable: string, helperScript: string, configuration: string) => Promise<ChildProcess>;
  } = {},
): Promise<PreparedFullPackageUpgrade> {
  const configuration = createFullPackageUpgradeConfiguration(request);
  const configurationPath = configurationFile(request.stagingDirectory);
  fs.writeFileSync(configurationPath, `${JSON.stringify(configuration)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  try {
    await launch(executable, helperScript, configurationPath);
    return Object.freeze({ configuration: configurationPath });
  } catch (error) {
    await fsPromises.rm(configurationPath, { force: true });
    throw error;
  }
}

function readHelperConfiguration(configurationPath: string): FullPackageUpgradeConfiguration {
  if (!path.isAbsolute(configurationPath)) fail('helper 配置路径必须是绝对路径');
  let value: unknown;
  try {
    value = JSON.parse(fs.readFileSync(configurationPath, 'utf8')) as unknown;
  } catch {
    fail('helper 配置无法读取');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('helper 配置无效');
  const record = value as Record<string, unknown>;
  const platform = record.platform;
  if (
    record.schema !== CONFIGURATION_SCHEMA ||
    (platform !== 'windows' && platform !== 'macos' && platform !== 'ubuntu') ||
    typeof record.stagedPackage !== 'string' ||
    typeof record.electronPid !== 'number'
  )
    fail('helper 配置无效');
  const stagedPackage = assertAbsoluteFile(record.stagedPackage, extensionFor(platform), '完整安装包');
  if (!Number.isSafeInteger(record.electronPid) || record.electronPid < 1) fail('helper 配置 PID 无效');
  if (platform === 'windows') return { schema: CONFIGURATION_SCHEMA, platform, stagedPackage, electronPid: record.electronPid };
  if (platform === 'macos') {
    if (
      typeof record.macosApplication !== 'string' ||
      !path.isAbsolute(record.macosApplication) ||
      !record.macosApplication.endsWith('.app') ||
      !fs.existsSync(record.macosApplication) ||
      !fs.statSync(record.macosApplication).isDirectory()
    )
      fail('helper macOS 应用路径无效');
    return {
      schema: CONFIGURATION_SCHEMA,
      platform,
      stagedPackage,
      electronPid: record.electronPid,
      macosApplication: record.macosApplication,
    };
  }
  if (typeof record.appImagePath !== 'string') fail('helper APPIMAGE 路径无效');
  return {
    schema: CONFIGURATION_SCHEMA,
    platform,
    stagedPackage,
    electronPid: record.electronPid,
    appImagePath: appImagePath(record.appImagePath),
  };
}

async function waitForParentExit(pid: number): Promise<void> {
  while (true) {
    try {
      process.kill(pid, 0);
    } catch (error: unknown) {
      if (typeof error === 'object' && error !== null && (error as NodeJS.ErrnoException).code === 'ESRCH') return;
      if (typeof error === 'object' && error !== null && (error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
  }
}

function run(command: string, args: readonly string[]): UpgradeCommandResult {
  const result = spawnSync(command, args, { stdio: 'ignore', windowsHide: true });
  return { status: result.status };
}

function startApplication(executable: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [], { detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

export function copyMacosApplication(source: string, destination: string): Promise<void> {
  const result = spawnSync(
    '/usr/bin/ditto',
    ['--rsrc', '--extattr', '--acl', source, destination],
    { stdio: 'ignore', windowsHide: true },
  );
  if (result.error || result.status !== 0)
    return Promise.reject(new Error(`ditto 复制 macOS 应用失败: status=${result.status ?? 'null'}`));
  return Promise.resolve();
}

const defaultDependencies: UpgradeHelperDependencies = Object.freeze({
  waitForParentExit,
  run,
  startApplication,
  copyApplication: copyMacosApplication,
  move: (source: string, destination: string) => fsPromises.rename(source, destination),
});

function commandSucceeded(result: UpgradeCommandResult): boolean {
  return result.status === 0;
}

function findApplications(directory: string, found: string[] = []): string[] {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (!entry.isDirectory()) continue;
    if (entry.name.endsWith('.app')) {
      found.push(candidate);
      continue;
    }
    findApplications(candidate, found);
  }
  return found;
}

async function installWindows(
  configuration: FullPackageUpgradeConfiguration,
  dependencies: UpgradeHelperDependencies,
): Promise<void> {
  if (!commandSucceeded(dependencies.run(configuration.stagedPackage, []))) fail('Windows 安装器返回非零状态');
  await fsPromises.rm(configuration.stagedPackage, { force: true });
}

async function installMacos(
  configuration: FullPackageUpgradeConfiguration,
  dependencies: UpgradeHelperDependencies,
): Promise<void> {
  const application = configuration.macosApplication;
  if (!application) fail('macOS 安装目标缺失');
  const mountPoint = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-dmg-'));
  let mounted = false;
  let backup: string | null = null;
  let replacement: string | null = null;
  let originalMoved = false;
  let started = false;
  try {
    if (!commandSucceeded(dependencies.run('hdiutil', ['attach', configuration.stagedPackage, '-nobrowse', '-readonly', '-mountpoint', mountPoint])))
      fail('无法挂载 macOS 安装包');
    mounted = true;
    const candidates = findApplications(mountPoint);
    if (candidates.length !== 1) fail('macOS 安装包必须包含唯一 .app');
    const parent = path.dirname(application);
    const basename = path.basename(application);
    backup = path.join(parent, `.${basename}.dsh-forge-backup-${randomUUID()}`);
    replacement = path.join(parent, `.${basename}.dsh-forge-new-${randomUUID()}`);
    // 先在旧应用仍然存在时复制并验证新 bundle；Electron Framework 使用的符号链接
    // 不能通过 fs.cpSync 复制，否则会变成指向 DMG 挂载点的绝对链接并破坏签名。
    await dependencies.copyApplication(candidates[0]!, replacement);
    if (!fs.existsSync(replacement) || !fs.statSync(replacement).isDirectory())
      fail('macOS 新应用复制结果无效');
    if (!commandSucceeded(dependencies.run('codesign', ['--verify', '--deep', '--strict', replacement])))
      fail('macOS 新应用代码签名验证失败');
    if (!commandSucceeded(dependencies.run('spctl', ['--assess', '--type', 'execute', replacement])))
      fail('macOS 新应用 Gatekeeper 验证失败');
    fs.renameSync(application, backup);
    originalMoved = true;
    fs.renameSync(replacement, application);
    replacement = null;
    if (!commandSucceeded(dependencies.run('open', ['-n', application]))) fail('无法启动新的 macOS 应用');
    started = true;
    if (!commandSucceeded(dependencies.run('hdiutil', ['detach', mountPoint]))) fail('无法卸载 macOS 安装卷');
    mounted = false;
    await fsPromises.rm(backup, { recursive: true, force: true });
    backup = null;
    originalMoved = false;
    await fsPromises.rm(configuration.stagedPackage, { force: true });
  } catch (error) {
    if (!started && originalMoved && backup) {
      try {
        await fsPromises.rm(application, { recursive: true, force: true });
        await fsPromises.rename(backup, application);
        backup = null;
        originalMoved = false;
      } catch {
        // 回滚失败时保留备份，供人工恢复。
      }
    }
    throw error;
  } finally {
    if (replacement) await fsPromises.rm(replacement, { recursive: true, force: true }).catch(() => undefined);
    if (mounted) dependencies.run('hdiutil', ['detach', mountPoint]);
    await fsPromises.rm(mountPoint, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function installUbuntu(
  configuration: FullPackageUpgradeConfiguration,
  dependencies: UpgradeHelperDependencies,
): Promise<void> {
  const destination = configuration.appImagePath;
  if (!destination) fail('Ubuntu AppImage 安装目标缺失');
  const directory = path.dirname(destination);
  const basename = path.basename(destination);
  const replacement = path.join(directory, `.${basename}.dsh-forge-new-${randomUUID()}`);
  const backup = path.join(directory, `.${basename}.dsh-forge-backup-${randomUUID()}`);
  let originalMoved = false;
  let newApplicationStarted = false;
  try {
    await fsPromises.copyFile(configuration.stagedPackage, replacement, fs.constants.COPYFILE_EXCL);
    await fsPromises.chmod(replacement, 0o755);
    await dependencies.move(destination, backup);
    originalMoved = true;
    await dependencies.move(replacement, destination);
    await dependencies.startApplication(destination);
    newApplicationStarted = true;
    await fsPromises.rm(backup, { force: true });
    originalMoved = false;
    await fsPromises.rm(configuration.stagedPackage, { force: true });
  } catch (error) {
    if (originalMoved && !newApplicationStarted) {
      try {
        await fsPromises.rm(destination, { force: true });
        await dependencies.move(backup, destination);
        originalMoved = false;
      } catch {
        // 原子回滚失败时保留备份，禁止将其清理为成功状态。
      }
    }
    throw error;
  } finally {
    await fsPromises.rm(replacement, { force: true }).catch(() => undefined);
  }
}

/** helper 成功前不会删除完整安装包；Ubuntu 启动失败时恢复原 AppImage。 */
export async function runFullPackageUpgrade(
  configurationPath: string,
  dependencies: UpgradeHelperDependencies = defaultDependencies,
): Promise<UpgradeHelperResult> {
  let configuration: FullPackageUpgradeConfiguration;
  try {
    configuration = readHelperConfiguration(configurationPath);
    await dependencies.waitForParentExit(configuration.electronPid);
    if (configuration.platform === 'windows') await installWindows(configuration, dependencies);
    else if (configuration.platform === 'macos') await installMacos(configuration, dependencies);
    else await installUbuntu(configuration, dependencies);
    return Object.freeze({ success: true, code: null });
  } catch {
    return Object.freeze({ success: false, code: 'OTA_INSTALL_FAILED' });
  } finally {
    await fsPromises.rm(configurationPath, { force: true }).catch(() => undefined);
  }
}

if (process.argv[2] === '--run-full-package-upgrade' && process.argv[3]) {
  void runFullPackageUpgrade(path.resolve(process.argv[3])).then((result) => {
    process.exitCode = result.success ? 0 : 1;
  });
}
