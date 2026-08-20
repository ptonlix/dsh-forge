import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveProfile } from '@dsh-forge/profile-toolchain/compiler';
import { writeConfigDump } from '@dsh-forge/profile-toolchain/composer';
import { parseDistribution } from '@dsh-forge/profile-toolchain/schema';
import { createRuntimeManifest, generateEvidence } from '@dsh-forge/profile-toolchain/release';
import { fail } from '@dsh-forge/profile-toolchain/core/errors';
import { errorCode, errorMessage } from '@dsh-forge/profile-toolchain/types';
import type { CompiledProfile } from '@dsh-forge/profile-toolchain/compiler';
import type { Distribution, RuntimePlatform } from '@dsh-forge/profile-toolchain/schema';

/** Electron 目录产物构建脚本；构建前必须已有已验证 profile 和 config dump。 */

interface BuilderConfigInput {
  readonly root: string;
  readonly outputDir: string;
  readonly profileDir: string;
  readonly resolved: CompiledProfile['resolved'];
  readonly distribution: Distribution;
}

interface BuilderResult {
  readonly command: string;
  readonly output: string;
}

function rootDirectory(): string {
  return path.resolve(__dirname, '..');
}

/** 生成 electron-builder 配置，明确 runtime、profile、catalog 和审计证据的位置。 */
function builderConfig({
  root,
  outputDir,
  profileDir,
  resolved,
  distribution,
}: BuilderConfigInput): Record<string, unknown> {
  const config: Record<string, unknown> = {
    appId: distribution.applicationId,
    productName: distribution.branding.productName,
    directories: { output: outputDir },
    asar: true,
    asarUnpack: ['node_modules/**', '**/*.node', '**/helpers/**'],
    files: [
      'dist/**',
      'packages/**',
      'tools/**',
      'catalog/**',
      'package.json',
      'distribution.yml',
      'node_modules/**',
      '!node_modules/.cache/**',
      '!node_modules/**/.pnpm-store/**',
    ],
    extraResources: [
      // workspace 依赖在 pnpm 安装目录中是相对 symlink；保留 packages 拓扑后，
      // 打包 runtime 内的 @dsh-forge/* 链接仍能解析到随包携带的真实目录。
      { from: path.join(root, 'packages'), to: 'dsh-forge/runtime/packages' },
      { from: path.join(root, 'tools'), to: 'dsh-forge/runtime/tools' },
      { from: path.join(root, 'node_modules'), to: 'dsh-forge/runtime/node_modules' },
      { from: profileDir, to: 'dsh-forge/profile' },
      { from: path.join(path.dirname(profileDir), 'resolved-manifest.json'), to: 'dsh-forge/resolved-manifest.json' },
      { from: path.join(path.dirname(profileDir), 'sbom.input.json'), to: 'dsh-forge/sbom.input.json' },
      { from: path.join(path.dirname(profileDir), 'THIRD-PARTY-NOTICES.txt'), to: 'dsh-forge/THIRD-PARTY-NOTICES.txt' },
    ],
    mac: { target: ['dir'] },
    win: { target: ['dir'] },
    artifactName: `${distribution.id}-${resolved.profile.name}-${distribution.version}-\${os}-\${arch}.\${ext}`,
  };
  if (process.env.DSH_FORGE_ELECTRON_ZIP) {
    const electronZip = path.resolve(process.env.DSH_FORGE_ELECTRON_ZIP);
    if (!fs.existsSync(electronZip)) fail(`Electron 压缩包不存在: ${electronZip}`, 'ELECTRON_DIST_MISSING');
    config.electronDist = electronZip;
  }
  return config;
}

/** 选择当前 OS/架构的声明目标，不允许构建未登记的平台。 */
function desktopTargets(distribution: Distribution): RuntimePlatform {
  const target = distribution.platforms.find((candidate) => candidate.os === process.platform);
  if (!target || !target.architectures.includes(process.arch as RuntimePlatform['architectures'][number]))
    fail(`当前平台 ${process.platform}-${process.arch} 未在 distribution.yml 中声明`, 'PACKAGE_TARGET_UNSUPPORTED');
  return target;
}

/** 调用 electron-builder；固定 60 秒超时并关闭自动代码签名发现。 */
function runBuilder(root: string, configFile: string): BuilderResult {
  const binary = path.join(root, 'node_modules', '.bin', 'electron-builder');
  if (!fs.existsSync(binary)) fail('未安装 electron-builder', 'ELECTRON_BUILDER_MISSING');
  const args = ['--config', configFile, '--dir'];
  if (process.platform === 'darwin') args.push('--mac', process.arch === 'arm64' ? '--arm64' : '--x64');
  else if (process.platform === 'win32') args.push('--win', process.arch === 'ia32' ? '--ia32' : '--x64');
  else fail(`当前平台不支持桌面产物构建: ${process.platform}`, 'PACKAGE_TARGET_UNSUPPORTED');
  const result = spawnSync(binary, args, {
    cwd: root,
    encoding: 'utf8',
    timeout: 60_000,
    env: {
      ...process.env,
      CSC_IDENTITY_AUTO_DISCOVERY: 'false',
      ELECTRON_MIRROR: process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/',
    },
  });
  if (result.status !== 0)
    fail(
      `Electron Builder 失败: ${(result.stderr || result.stdout || 'unknown error').trim()}`,
      'ELECTRON_BUILDER_FAILED',
      {
        args,
        status: result.status,
        signal: result.signal,
      },
    );
  return { command: `${binary} ${args.join(' ')}`, output: (result.stdout || result.stderr || '').trim() };
}

/** 在构建输出中定位平台应用目录，找不到时阻止生成 runtime manifest。 */
function findApplication(outputDir: string, productName: string): string {
  const expected = process.platform === 'darwin' ? `${productName}.app` : `${productName}.exe`;
  const queue: string[] = [outputDir];
  while (queue.length) {
    const directory = queue.shift()!;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      if (entry.name === expected) return candidate;
      if (entry.isDirectory()) queue.push(candidate);
    }
  }
  fail(`Electron Builder 未生成 ${expected}`, 'PACKAGE_ARTIFACT_MISSING');
}

function main(): void {
  const root = rootDirectory();
  const profileName = process.argv[2] === '--' ? process.argv[3] : process.argv[2];
  const compiled = resolveProfile({ root, profileName });
  const dump = writeConfigDump(compiled, { overlay: { port: 38080, generationId: 'package-build' } });
  if (!dump.healthy) fail('真实 DSH 配置转储不健康', 'PACKAGE_CONFIG_DUMP');
  const distribution = parseDistribution(path.join(root, 'distribution.yml'), {
    profilesRoot: path.join(root, 'profiles'),
  });
  const target = desktopTargets(distribution);
  const outputDir = path.join(compiled.outputDir, 'desktop-dist');
  fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  const configFile = path.join(compiled.outputDir, 'electron-builder.generated.json');
  fs.writeFileSync(
    configFile,
    `${JSON.stringify(builderConfig({ root, outputDir, profileDir: compiled.profileDir, resolved: compiled.resolved, distribution }), null, 2)}\n`,
    { mode: 0o600 },
  );
  const build = runBuilder(root, configFile);
  const application = findApplication(outputDir, distribution.branding.productName);
  const runtime = createRuntimeManifest({
    resolved: compiled.resolved,
    packageRoot: application,
    signed: false,
    targets: [
      { os: target.os, architectures: [process.arch as RuntimePlatform['architectures'][number]], nativeFiles: [] },
    ],
    declaredTargets: distribution.platforms,
    artifact: application,
  });
  fs.writeFileSync(path.join(compiled.outputDir, 'runtime-manifest.json'), `${JSON.stringify(runtime, null, 2)}\n`, {
    mode: 0o600,
  });
  generateEvidence(runtime, compiled.outputDir);
  process.stdout.write(
    `${JSON.stringify({ application, runtimeManifest: path.join(compiled.outputDir, 'runtime-manifest.json'), evidence: path.join(compiled.outputDir, 'package-evidence.json'), build: build.command }, null, 2)}\n`,
  );
}

try {
  main();
} catch (error: unknown) {
  process.stderr.write(`${errorCode(error) || 'ERROR'}: ${errorMessage(error)}\n`);
  process.exitCode = 1;
}
