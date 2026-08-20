import * as os from 'node:os';
import * as path from 'node:path';

/** DSH 约定的用户数据根目录环境变量。 */
export const DSH_HOME_ENV = 'DSH_HOME';
const DEFAULT_DSH_HOME_DIR = '.dsh';

export type DshHomeSource = 'environment' | 'default';

export interface ResolvedDshHome {
  readonly path: string;
  readonly source: DshHomeSource;
}

/**
 * 按上游 DSH 的规则展开 Home 路径。
 *
 * 空白 `DSH_HOME` 视为未设置；非空值保留原始字符后再解析，避免把含空格的
 * 合法路径静默改写。此规则与 `@deepseek-ai/dsh-home-paths` 保持一致。
 */
function expandHomePath(value: string, homeDirectory: string): string {
  if (value === '~') return homeDirectory;
  if (value.startsWith('~/') || value.startsWith('~\\')) return path.join(homeDirectory, value.slice(2));
  return value;
}

/**
 * 解析本次 Desktop 应使用的 DSH 用户根目录。
 *
 * 环境变量优先于默认的 `~/.dsh`，但该函数不写入 `process.env`。这样动态加载的
 * 上游组件、Desktop Host 与用户在终端启动的 DSH 会落到同一个根目录。
 */
export function resolveDesktopDshHome(
  env: Readonly<Record<string, string | undefined>> = process.env,
  homeDirectory = os.homedir(),
): ResolvedDshHome {
  const configured = env[DSH_HOME_ENV];
  const source: DshHomeSource = configured !== undefined && configured.trim().length > 0 ? 'environment' : 'default';
  const selected = source === 'environment' ? configured! : path.join(homeDirectory, DEFAULT_DSH_HOME_DIR);
  return Object.freeze({ path: path.resolve(expandHomePath(selected, homeDirectory)), source });
}
