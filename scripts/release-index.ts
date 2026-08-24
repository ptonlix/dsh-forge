import * as fs from 'node:fs';
import * as path from 'node:path';
import { sha256 } from '@dsh-forge/profile-toolchain/release';
import { errorCode, errorMessage } from '@dsh-forge/profile-toolchain/types';

export interface ReleaseIndexFile {
  readonly path: string;
  readonly sha256: string;
}

export interface ReleaseIndexTarget {
  readonly target: string;
  readonly directory: string;
  readonly runtimeManifest: string;
  readonly packageEvidence: string;
  readonly packageInspection: string;
  readonly nativeVerification: string;
  readonly packageSmoke: string;
  readonly files: readonly ReleaseIndexFile[];
}

export interface ReleaseIndex {
  readonly schema: 'dsh-forge/release-index@1';
  readonly distribution: string;
  readonly version: string;
  readonly profile: string;
  readonly inputDigest: string;
  readonly runId: string | null;
  readonly targets: readonly ReleaseIndexTarget[];
}

function fail(message: string): never {
  throw new Error(message);
}

function jsonFile(file: string): Record<string, unknown> {
  if (!fs.existsSync(file)) fail(`release artifact 缺少文件: ${file}`);
  const value = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`release artifact JSON 无效: ${file}`);
  return value as Record<string, unknown>;
}

function filesUnder(directory: string, prefix = '', result: ReleaseIndexFile[] = []): ReleaseIndexFile[] {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    const relative = path.join(prefix, entry.name).split(path.sep).join('/');
    if (entry.isDirectory()) filesUnder(candidate, relative, result);
    else if (entry.isFile()) result.push({ path: relative, sha256: sha256(candidate) });
  }
  return result.sort((left, right) => left.path.localeCompare(right.path));
}

export function buildReleaseIndex({
  root,
  expectedTargets,
  profile,
  distribution,
  version,
  runId = null,
}: {
  readonly root: string;
  readonly expectedTargets: readonly string[];
  readonly profile: string;
  readonly distribution: string;
  readonly version: string;
  readonly runId?: string | null;
}): ReleaseIndex {
  const targetOrder = new Map(expectedTargets.map((target, index) => [target, index]));
  const directories = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort(
      (left, right) =>
        (targetOrder.get(left.name) ?? Number.MAX_SAFE_INTEGER) -
        (targetOrder.get(right.name) ?? Number.MAX_SAFE_INTEGER),
    );
  const found = new Map<string, ReleaseIndexTarget>();
  let inputDigest: string | null = null;
  let inputDigestTarget: string | null = null;
  for (const entry of directories) {
    const target = entry.name;
    if (!expectedTargets.includes(target)) continue;
    if (found.has(target)) fail(`release artifact target 重复: ${target}`);
    const directory = path.join(root, target);
    const runtimeFile = path.join(directory, 'runtime-manifest.json');
    const evidenceFile = path.join(directory, 'package-evidence.json');
    const inspectionFile = path.join(directory, `package-inspection.${target}.json`);
    const nativeFile = path.join(directory, `native-verification.${target}.json`);
    const smokeFile = path.join(directory, `package-smoke.${target}.json`);
    const runtime = jsonFile(runtimeFile);
    const evidence = jsonFile(evidenceFile);
    const inspection = jsonFile(inspectionFile);
    const native = jsonFile(nativeFile);
    const smoke = jsonFile(smokeFile);
    const manifest = (evidence.manifest || {}) as Record<string, unknown>;
    const runtimeDistribution = ((runtime.distribution || {}) as Record<string, unknown>);
    const runtimeProfile = ((runtime.profile || {}) as Record<string, unknown>);
    const digest = typeof runtime.inputDigest === 'string' ? runtime.inputDigest : '';
    if (
      runtimeDistribution.id !== distribution ||
      runtimeDistribution.version !== version ||
      runtimeProfile.name !== profile
    )
      fail(`release artifact 身份漂移: ${target}`);
    if (manifest.distribution && JSON.stringify(manifest.distribution) !== JSON.stringify(runtime.distribution))
      fail(`package evidence manifest 漂移: ${target}`);
    if (digest.length !== 64 || !/^[a-f0-9]+$/i.test(digest)) fail(`release artifact 缺少 inputDigest: ${target}`);
    if (inputDigest && inputDigest !== digest)
      fail(
        `release artifact inputDigest 漂移: ${target} ` +
        JSON.stringify({ expectedTarget: inputDigestTarget, expectedDigest: inputDigest, actualDigest: digest }),
      );
    inputDigest = digest;
    inputDigestTarget = target;
    if (inspection.valid !== true || inspection.target !== target || native.result !== 'passed' || smoke.healthy !== true)
      fail(`release artifact inspect/smoke/evidence 未通过: ${target}`);
    const runtimeTargets = Array.isArray(runtime.targets) ? runtime.targets : [];
    if (!runtimeTargets.some((item) => {
      if (!item || typeof item !== 'object') return false;
      const record = item as Record<string, unknown>;
      const architectures = Array.isArray(record.architectures) ? record.architectures : [];
      return `${String(record.os)}-${architectures.join('-')}` === target || (target === 'darwin-universal' && record.os === 'darwin' && architectures.includes('arm64') && architectures.includes('x64'));
    })) fail(`runtime manifest 缺少目标: ${target}`);
    found.set(target, {
      target,
      directory,
      runtimeManifest: runtimeFile,
      packageEvidence: evidenceFile,
      packageInspection: inspectionFile,
      nativeVerification: nativeFile,
      packageSmoke: smokeFile,
      files: filesUnder(directory),
    });
  }
  const missing = expectedTargets.filter((target) => !found.has(target));
  if (missing.length) fail(`release artifact 缺少目标: ${missing.join(', ')}`);
  return {
    schema: 'dsh-forge/release-index@1',
    distribution,
    version,
    profile,
    inputDigest: inputDigest || fail('release artifact 为空'),
    runId,
    targets: expectedTargets.map((target) => found.get(target)!),
  };
}

function main(): void {
  const args = process.argv.slice(2);
  const value = (name: string, fallback?: string): string => {
    const index = args.indexOf(name);
    return index >= 0 && args[index + 1] ? args[index + 1]! : fallback || fail(`缺少参数: ${name}`);
  };
  const index = buildReleaseIndex({
    root: value('--root'),
    expectedTargets: value('--targets').split(',').filter(Boolean),
    profile: value('--profile'),
    distribution: value('--distribution'),
    version: value('--version'),
    runId: args.includes('--run-id') ? value('--run-id') : null,
  });
  const output = value('--output', path.join(index.targets[0]!.directory, '..', 'release-index.json'));
  fs.writeFileSync(output, `${JSON.stringify(index, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify(index)}\n`);
}

if (/release-index\.(?:ts|js)$/.test(path.basename(process.argv[1] || ''))) {
  try { main(); } catch (error: unknown) {
    process.stderr.write(`${errorCode(error) || 'RELEASE_INDEX'}: ${errorMessage(error)}\n`);
    process.exitCode = 1;
  }
}
