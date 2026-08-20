import * as fs from 'node:fs';

const PROFILE_NAME_PATTERN = /^[a-z][a-z0-9-]{1,63}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** 校验 profile 名称，拒绝路径片段和不稳定的运行时参数。 */
export function assertProfileName(value: string, source: string): string {
  if (!PROFILE_NAME_PATTERN.test(value)) throw new Error(`${source} 包含无效 profile 名称: ${value}`);
  return value;
}

/**
 * 读取开发态 Electron 的显式 profile 参数。
 *
 * 参数必须采用 `--profile <name>` 形式；重复、缺值或把另一个选项误作名称都会
 * 立即失败，避免启动器静默回退到默认 profile。
 */
export function profileFromArguments(argv: readonly string[]): string | null {
  const indexes = argv.flatMap((value, index) => (value === '--profile' ? [index] : []));
  if (indexes.length === 0) return null;
  if (indexes.length > 1) throw new Error('启动参数中重复指定了 --profile');
  const value = argv[indexes[0]! + 1];
  if (!value || value.startsWith('-')) throw new Error('--profile 必须提供 profile 名称');
  return assertProfileName(value, '启动参数');
}

/** 从打包时写入的 resolved manifest 提取唯一可运行的 profile 名称。 */
export function packagedProfileName(manifestFile: string): string {
  let manifest: unknown;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  } catch (error) {
    throw new Error(`无法读取打包 profile 清单: ${manifestFile}`, { cause: error });
  }
  const profile = isRecord(manifest) ? manifest.profile : null;
  if (!isRecord(profile) || typeof profile.name !== 'string')
    throw new Error(`打包 profile 清单无效: ${manifestFile}`);
  return assertProfileName(profile.name, '打包 profile 清单');
}

/**
 * 选择本次 Desktop 应安装和启动的仓库 profile。
 *
 * 开发态允许显式覆盖发行默认值；打包产物只包含构建时选定的一个 profile，故拒绝
 * 与该身份不同的运行时参数，防止应用声明启动了一个未随包交付的 profile。
 */
export function selectDesktopProfile({
  defaultProfile,
  requestedProfile,
  packagedProfile,
}: {
  readonly defaultProfile: string;
  readonly requestedProfile: string | null;
  readonly packagedProfile: string | null;
}): string {
  const fallback = assertProfileName(defaultProfile, '发行版默认值');
  if (!packagedProfile) return requestedProfile || fallback;
  const embedded = assertProfileName(packagedProfile, '打包 profile 清单');
  if (requestedProfile && requestedProfile !== embedded)
    throw new Error(`打包应用仅包含 profile: ${embedded}；不能选择 ${requestedProfile}`);
  return embedded;
}
