import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { findLatestArtifact } from '@dsh-forge/profile-toolchain/compiler';
import { parseDistribution, parseProfile } from '@dsh-forge/profile-toolchain/schema';
import { inspectPackage, sha256 } from '@dsh-forge/profile-toolchain/release';
import { errorCode, errorMessage } from '@dsh-forge/profile-toolchain/types';
import type { RuntimeManifest } from '@dsh-forge/profile-toolchain/types';

/** 对已构建 Electron 目录产物执行结构检查和真实 smoke 启动。 */

function applicationExecutable(application: string): string {
  if (process.platform === 'darwin') {
    const directory = path.join(application, 'Contents', 'MacOS');
    const names = fs
      .readdirSync(directory)
      .filter((name) => (fs.statSync(path.join(directory, name)).mode & 0o111) !== 0);
    if (names.length !== 1) throw new Error('macOS 安装包缺少唯一可执行入口');
    return path.join(directory, names[0]!);
  }
  if (process.platform === 'win32') {
    const names = fs.readdirSync(application).filter((name) => name.toLowerCase().endsWith('.exe'));
    if (names.length !== 1) throw new Error('Windows 安装包缺少唯一可执行入口');
    return path.join(application, names[0]!);
  }
  throw new Error(`当前 smoke 平台尚未实现: ${process.platform}`);
}

function runtimeFact(runtime: RuntimeManifest, name: string): string {
  const details = runtime.runtime;
  if (!details || typeof details !== 'object' || Array.isArray(details)) throw new Error('runtime manifest 缺少 runtime 事实');
  const value = (details as Record<string, unknown>)[name];
  if (typeof value !== 'string' || !value) throw new Error(`runtime manifest 缺少 ${name}`);
  return value;
}

function main(): void {
  const root = path.resolve(__dirname, '..');
  const distribution = parseDistribution(path.join(root, 'distribution.yml'), {
    profilesRoot: path.join(root, 'profiles'),
  });
  const profileName = (process.argv[2] === '--' ? process.argv[3] : process.argv[2]) || distribution.defaultProfile;
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
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-package-smoke-'));
  try {
    const electronReport = path.join(userData, 'electron-runtime.json');
    const executable = applicationExecutable(runtime.packageRoot || '');
    const result = spawnSync(executable, ['--dsh-forge-smoke'], {
      encoding: 'utf8',
      timeout: 30_000,
      // smoke 不得读取或修改开发者的默认 ~/.dsh；profile 物化、Host 加载和
      // native addon 验证都必须发生在同一个可清理的临时根目录中。
      env: {
        ...process.env,
        DSH_FORGE_SMOKE_USER_DATA: userData,
        DSH_FORGE_SMOKE_REPORT: electronReport,
        DSH_HOME: path.join(userData, 'dsh-home'),
      },
    });
    if (result.status !== 0) {
      const processError = result.error
        ? `${errorCode(result.error) || 'spawn-error'}: ${errorMessage(result.error)}`
        : null;
      const output = (result.stderr || result.stdout || processError || result.signal || 'unknown error').trim();
      throw new Error(`安装包 smoke 失败: ${output}`);
    }
    if (!fs.existsSync(electronReport)) throw new Error('安装包 smoke 未写入 Electron runtime 报告');
    const processRuntime = JSON.parse(fs.readFileSync(electronReport, 'utf8')) as Record<string, unknown>;
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
      target: { os: process.platform, architecture: process.arch },
      electron,
      electronAbi,
      runtimeManifestSha256: sha256(runtimeFile),
      nativeFiles: runtime.nativeAddons || [],
      result: 'passed',
      verifiedAt: new Date().toISOString(),
    };
    const target = `${process.platform}-${process.arch}`;
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
    fs.rmSync(userData, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error: unknown) {
  process.stderr.write(`${errorCode(error) || 'ERROR'}: ${errorMessage(error)}\n`);
  process.exitCode = 1;
}
