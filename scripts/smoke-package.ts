import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { findLatestArtifact } from '@dsh-forge/profile-toolchain/compiler';
import { parseDistribution, parseProfile } from '@dsh-forge/profile-toolchain/schema';
import { inspectPackage } from '@dsh-forge/profile-toolchain/release';
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
  throw new Error(`当前 smoke 平台尚未实现: ${process.platform}`);
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
    const executable = applicationExecutable(runtime.packageRoot || '');
    const result = spawnSync(executable, ['--dsh-forge-smoke'], {
      encoding: 'utf8',
      timeout: 30_000,
      env: { ...process.env, DSH_FORGE_SMOKE_USER_DATA: userData },
    });
    if (result.status !== 0) {
      const processError = result.error
        ? `${errorCode(result.error) || 'spawn-error'}: ${errorMessage(result.error)}`
        : null;
      const output = (result.stderr || result.stdout || processError || result.signal || 'unknown error').trim();
      throw new Error(`安装包 smoke 失败: ${output}`);
    }
    const report = {
      healthy: true,
      application: runtime.packageRoot,
      signing: runtime.signing,
      checkedAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(artifact, 'package-smoke.json'), `${JSON.stringify(report, null, 2)}\n`, {
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
