import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { findLatestArtifact } from '@dsh-forge/profile-toolchain/compiler';
import { parseDistribution, parseProfile } from '@dsh-forge/profile-toolchain/schema';
import { inspectPackage, sha256 } from '@dsh-forge/profile-toolchain/release';
import { errorCode, errorMessage } from '@dsh-forge/profile-toolchain/types';
import type { RuntimeManifest } from '@dsh-forge/profile-toolchain/types';

const SMOKE_PROCESS_TIMEOUT_MS = 5 * 60_000;

/** 对已构建 Electron 目录产物执行结构检查和真实 smoke 启动。 */

/** branding.productName 与 electron-builder executableName 保持一致，不能按 Unix 执行位猜测入口。 */
function applicationExecutable(application: string, executableName: string): string {
  if (process.platform === 'darwin') {
    const executable = path.join(application, 'Contents', 'MacOS', executableName);
    if (!fs.existsSync(executable)) throw new Error(`macOS 安装包缺少可执行入口: ${executableName}`);
    return executable;
  }
  if (process.platform === 'win32') {
    const executable = path.join(application, `${executableName}.exe`);
    if (!fs.existsSync(executable)) throw new Error(`Windows 安装包缺少可执行入口: ${executableName}.exe`);
    return executable;
  }
  if (process.platform === 'linux') {
    const executable = path.join(application, executableName);
    if (!fs.existsSync(executable)) throw new Error(`Linux 安装包缺少可执行入口: ${executableName}`);
    return executable;
  }
  throw new Error(`当前 smoke 平台尚未实现: ${process.platform}`);
}

function targetName(argv: readonly string[]): 'darwin-universal' | 'win32-x64' | 'linux-x64' | undefined {
  const index = argv.indexOf('--target');
  const value = index >= 0 ? argv[index + 1] : undefined;
  if (value === 'darwin-universal' || value === 'win32-x64' || value === 'linux-x64') return value;
  if (value !== undefined) throw new Error(`smoke target 无效: ${value}`);
  return undefined;
}

function runtimeFact(runtime: RuntimeManifest, name: string): string {
  const details = runtime.runtime;
  if (!details || typeof details !== 'object' || Array.isArray(details)) throw new Error('runtime manifest 缺少 runtime 事实');
  const value = (details as Record<string, unknown>)[name];
  if (typeof value !== 'string' || !value) throw new Error(`runtime manifest 缺少 ${name}`);
  return value;
}

function limitedOutput(value: string | null | undefined): string | null {
  const output = value?.trim() || '';
  if (!output) return null;
  return output.length > 4_000 ? `${output.slice(0, 2_000)}\n...<truncated>...\n${output.slice(-2_000)}` : output;
}

function smokeProcessDetails(
  executable: string,
  report: string,
  result: SpawnSyncReturns<string>,
  timeoutMs: number,
): Record<string, unknown> {
  return {
    executable,
    cwd: process.cwd(),
    platform: process.platform,
    architecture: process.arch,
    status: result.status,
    signal: result.signal,
    error: result.error
      ? { name: result.error.name, message: result.error.message, code: errorCode(result.error) || null }
      : null,
    stdout: limitedOutput(result.stdout),
    stderr: limitedOutput(result.stderr),
    report,
    reportExists: fs.existsSync(report),
    timeoutMs,
  };
}

/** 将 smoke 临时根放到已解包应用所在磁盘，避免 Windows 跨盘复制大型 profile 闭包。 */
function createSmokeRoot(application: string): string {
  const parent = path.dirname(application);
  try {
    return fs.mkdtempSync(path.join(parent, '.dsh-forge-package-smoke-'));
  } catch {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-package-smoke-'));
  }
}

function readSmokeReport(report: string): unknown {
  if (!fs.existsSync(report)) return null;
  try {
    return JSON.parse(fs.readFileSync(report, 'utf8')) as unknown;
  } catch (error: unknown) {
    return { invalid: errorMessage(error), raw: limitedOutput(fs.readFileSync(report, 'utf8')) };
  }
}

function main(): void {
  const root = path.resolve(__dirname, '..');
  const distribution = parseDistribution(path.join(root, 'distribution.yml'), {
    profilesRoot: path.join(root, 'profiles'),
  });
  const args = process.argv.slice(2);
  const positional = args.filter((argument, index) => argument !== '--' && argument !== '--target' && args[index - 1] !== '--target');
  const profileName = positional[0] || distribution.defaultProfile;
  const selectedTarget = targetName(args);
  if (selectedTarget && selectedTarget.startsWith('darwin') && process.platform !== 'darwin')
    throw new Error(`smoke target 与当前 runner 不匹配: ${selectedTarget}/${process.platform}-${process.arch}`);
  if (selectedTarget === 'win32-x64' && (process.platform !== 'win32' || process.arch !== 'x64'))
    throw new Error(`smoke target 与当前 runner 不匹配: ${selectedTarget}/${process.platform}-${process.arch}`);
  if (selectedTarget === 'linux-x64' && (process.platform !== 'linux' || process.arch !== 'x64'))
    throw new Error(`smoke target 与当前 runner 不匹配: ${selectedTarget}/${process.platform}-${process.arch}`);
  const expectedArchitectures = selectedTarget === 'darwin-universal' ? ['arm64', 'x64'] : [process.arch];
  const profile = parseProfile(path.join(root, 'profiles', profileName, 'profile.yml'));
  if (profile.name !== profileName) throw new Error(`profile manifest 名称不一致: ${profileName} / ${profile.name}`);
  const artifact = findLatestArtifact(root, distribution.id, profileName);
  if (!artifact) throw new Error('没有已解析 profile artifact');
  const runtimeFile = path.join(artifact, 'runtime-manifest.json');
  if (!fs.existsSync(runtimeFile)) throw new Error('没有真实 Electron runtime manifest；请先运行 package:desktop');
  const runtime = JSON.parse(fs.readFileSync(runtimeFile, 'utf8')) as RuntimeManifest;
  const inspection = inspectPackage(runtime);
  if (!inspection.valid)
    throw new Error(`安装包结构检查失败: ${inspection.failures.map((item) => String(item.code)).join(', ')}`);
  const smokeRoot = createSmokeRoot(runtime.packageRoot || process.cwd());
  const userData = path.join(smokeRoot, 'user-data');
  fs.mkdirSync(userData, { recursive: true, mode: 0o700 });
  try {
    const electronReport = path.join(userData, 'electron-runtime.json');
    const executable = applicationExecutable(runtime.packageRoot || '', distribution.branding.productName);
    const result = spawnSync(executable, ['--dsh-forge-smoke'], {
      encoding: 'utf8',
      timeout: SMOKE_PROCESS_TIMEOUT_MS,
      // smoke 不得读取或修改开发者的默认 ~/.dsh；profile 物化、Host 加载和
      // native addon 验证都必须发生在同一个可清理的临时根目录中。
      env: {
        ...process.env,
        DSH_FORGE_SMOKE_USER_DATA: userData,
        DSH_FORGE_SMOKE_REPORT: electronReport,
        DSH_HOME: path.join(userData, 'dsh-home'),
      },
    });
    const processDetails = smokeProcessDetails(executable, electronReport, result, SMOKE_PROCESS_TIMEOUT_MS);
    // spawnSync 超时可能同时返回 status=0 和 error=ETIMEDOUT；只检查退出码
    // 会把被强制终止的 Electron 进程误判为成功。
    if (result.status !== 0 || result.signal || result.error) {
      const processError = result.error ? `${errorCode(result.error) || 'spawn-error'}: ${errorMessage(result.error)}` : null;
      throw new Error(`安装包 smoke 失败: ${JSON.stringify({ ...processDetails, processError, smokeReport: readSmokeReport(electronReport) })}`);
    }
    if (!fs.existsSync(electronReport))
      throw new Error(`安装包 smoke 未写入 Electron runtime 报告: ${JSON.stringify(processDetails)}`);
    const processRuntime = JSON.parse(fs.readFileSync(electronReport, 'utf8')) as Record<string, unknown>;
    if (processRuntime.status !== 'passed')
      throw new Error(`安装包 smoke 启动未完成: ${JSON.stringify({ ...processDetails, smokeReport: processRuntime })}`);
    const electron = runtimeFact(runtime, 'electron');
    const electronAbi = runtimeFact(runtime, 'electronAbi');
    if (
      processRuntime.schema !== 'dsh-forge/electron-smoke@1' ||
      processRuntime.electron !== electron ||
      processRuntime.electronAbi !== electronAbi
    )
      throw new Error('安装包 Electron runtime 与 manifest 不一致');
    const nativeEvidence = {
      schema: 'dsh-forge/native-verification@1',
      target: selectedTarget === 'darwin-universal'
        ? { os: 'darwin', architectures: expectedArchitectures }
        : { os: process.platform, architecture: expectedArchitectures[0] },
      electron,
      electronAbi,
      runtimeManifestSha256: sha256(runtimeFile),
      nativeFiles: runtime.nativeAddons || [],
      result: 'passed',
      verifiedAt: new Date().toISOString(),
    };
    const target = selectedTarget || `${process.platform}-${process.arch}`;
    fs.writeFileSync(path.join(artifact, `native-verification.${target}.json`), `${JSON.stringify(nativeEvidence, null, 2)}\n`, {
      mode: 0o600,
    });
    const report = {
      healthy: true,
      application: runtime.packageRoot,
      signing: runtime.signing,
      nativeEvidence,
      checkedAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(artifact, `package-smoke.${target}.json`), `${JSON.stringify(report, null, 2)}\n`, {
      mode: 0o600,
    });
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } finally {
    fs.rmSync(smokeRoot, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error: unknown) {
  process.stderr.write(`${errorCode(error) || 'ERROR'}: ${errorMessage(error)}\n`);
  process.exitCode = 1;
}
