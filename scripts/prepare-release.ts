import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse as parseYaml } from 'yaml';

const EXACT_SEMVER_PATTERN = new RegExp(
  '^(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)' +
    '(?:-[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$',
);

const DISTRIBUTION_VERSION_LINE = /^(version:[ \t]*)([^\s#]+)([ \t]*(?:#.*)?)(\r?)$/gm;
const PACKAGE_VERSION_LINE = /^([ \t]*"version"[ \t]*:[ \t]*)([^,\r\n]+)([ \t]*,?[ \t]*)(\r?)$/gm;
const PACKAGE_BUILD_LINE = /^([ \t]*"dshForgeBuild"[ \t]*:[ \t]*)([^,\r\n]+)([ \t]*,?[ \t]*)(\r?)$/gm;

interface ParsedSemVer {
  readonly major: string;
  readonly minor: string;
  readonly patch: string;
  readonly prerelease: readonly string[];
}

interface JsonObject {
  readonly [key: string]: unknown;
}

export interface ReleasePrepareInput {
  readonly distributionFile: string;
  readonly packageFile: string;
  readonly version: string;
}

export interface ReleasePrepareResult {
  readonly currentVersion: string;
  readonly version: string;
  readonly currentBuild: number;
  readonly build: number;
}

interface PackageState {
  readonly version: string;
  readonly versionMatch: RegExpMatchArray;
  readonly build: number;
  readonly buildMatch: RegExpMatchArray;
}

function record(value: unknown): JsonObject | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as JsonObject : null;
}

function parseSemVer(value: unknown, label: string): ParsedSemVer {
  if (typeof value !== 'string' || !EXACT_SEMVER_PATTERN.test(value))
    throw new Error(`${label} 必须是精确 SemVer（例如 0.2.0），不能带 v 前缀、range 或 tag`);
  const buildIndex = value.indexOf('+');
  const withoutBuild = buildIndex >= 0 ? value.slice(0, buildIndex) : value;
  const prereleaseIndex = withoutBuild.indexOf('-');
  const core = prereleaseIndex >= 0 ? withoutBuild.slice(0, prereleaseIndex) : withoutBuild;
  const prerelease = prereleaseIndex >= 0 ? withoutBuild.slice(prereleaseIndex + 1).split('.') : [];
  if (prerelease.some((part) => /^\d+$/.test(part) && part.length > 1 && part.startsWith('0')))
    throw new Error(`${label} 必须是精确 SemVer（预发布数字标识不能有前导零）`);
  const coreParts = core.split('.');
  if (coreParts.length !== 3 || coreParts.some((part) => !part))
    throw new Error(`${label} 必须是精确 SemVer（核心版本缺失）`);
  const major = coreParts[0];
  const minor = coreParts[1];
  const patch = coreParts[2];
  if (major === undefined || minor === undefined || patch === undefined)
    throw new Error(`${label} 必须是精确 SemVer（核心版本缺失）`);
  return { major, minor, patch, prerelease };
}

function compareNumeric(left: string, right: string): number {
  const normalizedLeft = left.replace(/^0+(?=\d)/, '');
  const normalizedRight = right.replace(/^0+(?=\d)/, '');
  if (normalizedLeft.length !== normalizedRight.length) return normalizedLeft.length > normalizedRight.length ? 1 : -1;
  return normalizedLeft === normalizedRight ? 0 : normalizedLeft > normalizedRight ? 1 : -1;
}

function compareIdentifier(left: string, right: string): number {
  const leftNumeric = /^\d+$/.test(left);
  const rightNumeric = /^\d+$/.test(right);
  if (leftNumeric && rightNumeric) return compareNumeric(left, right);
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
  return left === right ? 0 : left > right ? 1 : -1;
}

/** 比较两个精确 SemVer；构建元数据不参与优先级。 */
export function compareReleaseVersions(left: string, right: string): number {
  const leftVersion = parseSemVer(left, '当前版本');
  const rightVersion = parseSemVer(right, '目标版本');
  for (const [leftPart, rightPart] of [
    [leftVersion.major, rightVersion.major],
    [leftVersion.minor, rightVersion.minor],
    [leftVersion.patch, rightVersion.patch],
  ] as const) {
    const result = compareNumeric(leftPart, rightPart);
    if (result !== 0) return result;
  }
  if (!leftVersion.prerelease.length || !rightVersion.prerelease.length) {
    if (leftVersion.prerelease.length === rightVersion.prerelease.length) return 0;
    return leftVersion.prerelease.length ? -1 : 1;
  }
  const length = Math.max(leftVersion.prerelease.length, rightVersion.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = leftVersion.prerelease[index];
    const rightPart = rightVersion.prerelease[index];
    if (leftPart === undefined || rightPart === undefined) return leftPart === undefined ? -1 : 1;
    const result = compareIdentifier(leftPart, rightPart);
    if (result !== 0) return result;
  }
  return 0;
}

function distributionVersion(source: string): { readonly version: string; readonly match: RegExpMatchArray } {
  const matches = [...source.matchAll(DISTRIBUTION_VERSION_LINE)];
  if (matches.length !== 1) throw new Error('distribution.yml 必须包含唯一的顶层 version 字段');
  const match = matches[0];
  if (!match) throw new Error('distribution.yml 必须包含唯一的顶层 version 字段');
  let parsedYaml: unknown;
  try {
    parsedYaml = parseYaml(source) as unknown;
  } catch (error: unknown) {
    throw new Error(`distribution.yml 不是有效 YAML: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  const parsed = record(parsedYaml);
  const version = match[2];
  if (!parsed || !version || parsed.version !== version) throw new Error('distribution.yml 的顶层 version 无法解析');
  parseSemVer(version, '当前 distribution.yml 版本');
  return { version, match };
}

function readPackageState(source: string): PackageState {
  const versionMatches = [...source.matchAll(PACKAGE_VERSION_LINE)];
  if (versionMatches.length !== 1) throw new Error('根 package.json 必须包含唯一的 version 字段');
  const versionMatch = versionMatches[0];
  if (!versionMatch) throw new Error('根 package.json 必须包含唯一的 version 字段');
  const buildMatches = [...source.matchAll(PACKAGE_BUILD_LINE)];
  if (buildMatches.length !== 1) throw new Error('根 package.json 必须包含唯一的 dshForgeBuild 字段');
  const buildMatch = buildMatches[0];
  if (!buildMatch) throw new Error('根 package.json 必须包含唯一的 dshForgeBuild 字段');
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(source) as unknown;
  } catch (error: unknown) {
    throw new Error(`根 package.json 不是有效 JSON: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  const parsed = record(parsedJson);
  if (!parsed || typeof parsed.version !== 'string') throw new Error('根 package.json 的 version 必须是字符串');
  const rawVersion = versionMatch[2]?.trim();
  let parsedRawVersion: unknown;
  try {
    parsedRawVersion = rawVersion ? JSON.parse(rawVersion) as unknown : undefined;
  } catch {
    parsedRawVersion = undefined;
  }
  if (parsedRawVersion !== parsed.version) throw new Error('根 package.json 的 version 必须是顶层字符串字段');
  parseSemVer(parsed.version, '当前根 package.json 版本');
  if (!Object.hasOwn(parsed, 'dshForgeBuild')) throw new Error('根 package.json 缺少 dshForgeBuild 字段');
  const build = parsed.dshForgeBuild;
  if (typeof build !== 'number' || !Number.isSafeInteger(build) || build < 1)
    throw new Error('根 package.json 的 dshForgeBuild 必须是正安全整数');
  const rawBuild = buildMatch[2];
  if (!rawBuild || rawBuild.trim() !== String(build)) throw new Error('根 package.json 的 dshForgeBuild 必须是顶层数字字段');
  return { version: parsed.version, versionMatch, build, buildMatch };
}

function replaceMatch(source: string, match: RegExpMatchArray, replacement: string): string {
  const index = match.index;
  if (index === undefined) throw new Error('无法定位待更新的发布字段');
  return `${source.slice(0, index)}${replacement}${source.slice(index + match[0].length)}`;
}

function writeReleaseFiles(updates: readonly { readonly file: string; readonly updated: string }[]): void {
  const firstUpdate = updates[0];
  if (!firstUpdate) throw new Error('没有可写入的发布文件');
  const backupDirectory = fs.mkdtempSync(path.join(path.dirname(firstUpdate.file), '.release-prepare-'));
  const backups: { readonly file: string; readonly backup: string }[] = [];
  try {
    for (const [index, { file }] of updates.entries()) {
      const backup = path.join(backupDirectory, `${index}-${path.basename(file)}`);
      fs.copyFileSync(file, backup);
      backups.push({ file, backup });
    }
    for (const update of updates) fs.writeFileSync(update.file, update.updated, 'utf8');
  } catch (error: unknown) {
    let restoreError: unknown;
    for (const { file, backup } of backups) {
      try { fs.copyFileSync(backup, file); } catch (restoreFailure: unknown) { restoreError ||= restoreFailure; }
    }
    if (restoreError) throw new Error(`发布文件写入失败且恢复失败: ${String(restoreError)}`, { cause: error });
    throw new Error(`发布文件写入失败，已恢复原文件: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  } finally {
    fs.rmSync(backupDirectory, { recursive: true, force: true });
  }
}

export function prepareRelease(input: ReleasePrepareInput): ReleasePrepareResult {
  parseSemVer(input.version, '目标版本');
  const distributionFile = path.resolve(input.distributionFile);
  const packageFile = path.resolve(input.packageFile);
  const distributionSource = fs.readFileSync(distributionFile, 'utf8');
  const packageSource = fs.readFileSync(packageFile, 'utf8');
  const current = distributionVersion(distributionSource);
  const packageState = readPackageState(packageSource);
  if (packageState.version !== current.version)
    throw new Error(`distribution.yml 版本 ${current.version} 与根 package.json 版本 ${packageState.version} 不一致，不会修改文件`);
  const comparison = compareReleaseVersions(current.version, input.version);
  if (comparison > 0) throw new Error(`目标版本 ${input.version} 低于当前版本 ${current.version}，不会修改文件`);
  const nextBuild = comparison === 0 ? packageState.build + 1 : 1;
  if (!Number.isSafeInteger(nextBuild) || nextBuild < 1)
    throw new Error('递增后的 dshForgeBuild 超出正安全整数范围，不会修改文件');
  const updatedDistribution = replaceMatch(
    distributionSource,
    current.match,
    `${current.match[1]}${input.version}${current.match[3]}${current.match[4]}`,
  );
  const updatedPackageVersion = replaceMatch(
    packageSource,
    packageState.versionMatch,
    `${packageState.versionMatch[1]}${JSON.stringify(input.version)}${packageState.versionMatch[3]}${packageState.versionMatch[4]}`,
  );
  const updatedPackageState = readPackageState(updatedPackageVersion);
  const updatedPackage = replaceMatch(
    updatedPackageVersion,
    updatedPackageState.buildMatch,
    `${updatedPackageState.buildMatch[1]}${nextBuild}${updatedPackageState.buildMatch[3]}${updatedPackageState.buildMatch[4]}`,
  );
  writeReleaseFiles([
    { file: distributionFile, updated: updatedDistribution },
    { file: packageFile, updated: updatedPackage },
  ]);
  return Object.freeze({
    currentVersion: current.version,
    version: input.version,
    currentBuild: packageState.build,
    build: nextBuild,
  });
}

export function parseReleaseArguments(arguments_: readonly string[]): string {
  const positional = arguments_[0] === '--' ? arguments_.slice(1) : arguments_;
  if (positional.length !== 1 || !positional[0])
    throw new Error('用法: pnpm run release:prepare -- <version>（例如 0.2.0，不要带 v 前缀）');
  parseSemVer(positional[0], '目标版本');
  return positional[0];
}

function main(): void {
  const version = parseReleaseArguments(process.argv.slice(2));
  const root = path.resolve(__dirname, '..');
  const result = prepareRelease({
    distributionFile: path.join(root, 'distribution.yml'),
    packageFile: path.join(root, 'package.json'),
    version,
  });
  process.stdout.write(
    `已准备发布版本：${result.version}\n` +
    `version: ${result.currentVersion} -> ${result.version}\n` +
    `dshForgeBuild: ${result.currentBuild} -> ${result.build}\n` +
    `下一步：提交变更后创建 annotated tag v${result.version}，CI 会校验 tag 与 distribution.yml 一致。\n`,
  );
}

if (/prepare-release\.(?:ts|js)$/.test(path.basename(process.argv[1] || ''))) {
  try { main(); } catch (error: unknown) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
