import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

const MANAGED_PROFILE_SCHEMA = 'dsh-forge/managed-profile@1';
const MANAGED_PROFILE_MARKER = '.dsh-forge-profile.json';
const LAUNCHER_FALLBACK_PACKAGES = new Set(['@dsh-forge/desktop-layer', '@dsh-forge/desktop-services-local']);

interface ManagedProfileMarker {
  readonly schema: typeof MANAGED_PROFILE_SCHEMA;
  readonly distributionId: string;
  readonly sourceProfile: string;
  readonly templateDigest: string;
  /** 受管 profile 的依赖闭包摘要。 */
  readonly dependencyDigest: string;
}

/** 发行版 profile 安装完成后的稳定结果。 */
export interface ManagedProfileResult {
  readonly directory: string;
  readonly profileName: string;
  readonly installed: boolean;
  readonly updated: boolean;
}

function isMarker(value: unknown): value is ManagedProfileMarker {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.schema === MANAGED_PROFILE_SCHEMA &&
    typeof record.distributionId === 'string' &&
    typeof record.sourceProfile === 'string' &&
    typeof record.templateDigest === 'string' &&
    typeof record.dependencyDigest === 'string'
  );
}

function readMarker(file: string): ManagedProfileMarker | null {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    const value: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    return isMarker(value) ? value : null;
  } catch {
    return null;
  }
}

function pathExists(file: string): boolean {
  try {
    fs.lstatSync(file);
    return true;
  } catch {
    return false;
  }
}

function assertDirectory(directory: string, label: string): void {
  if (!pathExists(directory)) return;
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${label} 必须是非符号链接目录: ${directory}`);
}

/**
 * 计算 template/profile 的内容摘要。
 *
 * 普通 profile 文件不允许符号链接；materialized `node_modules` 单独验证其
 * pnpm 闭包内相对链接，并将闭包摘要纳入受管 profile 的版本事实。
 */
function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

/** 仅忽略由 launcher 临时注入且在使用前会重新验证的 fallback 包。 */
function isIgnoredDependencyPath(dependencies: string, candidate: string): boolean {
  const relative = path.relative(dependencies, candidate).split(path.sep).join('/');
  return path.basename(candidate) === '.bin' || LAUNCHER_FALLBACK_PACKAGES.has(relative);
}

/**
 * 只接受 pnpm 闭包内部的相对链接。复制到 DSH Home 后这些链接仍以
 * `node_modules` 为根解析，不会保留构建机 store 或工作区的绝对引用。
 */
function assertSafeDependencies(directory: string): void {
  const dependencies = path.join(directory, 'node_modules');
  if (!pathExists(dependencies)) return;
  assertDirectory(dependencies, 'profile node_modules');
  const root = fs.realpathSync(dependencies);
  const visit = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      // pnpm 的 .bin 是 CLI shim，不属于 Node/Cordis 的模块解析闭包。
      const file = path.join(current, entry.name);
      if (isIgnoredDependencyPath(dependencies, file)) continue;
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) {
        const link = fs.readlinkSync(file);
        if (path.isAbsolute(link)) throw new Error(`profile 依赖不允许绝对链接: ${file}`);
        let target: string;
        try {
          target = fs.realpathSync(file);
        } catch {
          throw new Error(`profile 依赖包含悬挂链接: ${file}`);
        }
        if (!inside(root, target)) throw new Error(`profile 依赖链接越出闭包: ${file}`);
        continue;
      }
      if (stat.isDirectory()) visit(file);
    }
  };
  visit(dependencies);
}

function dependencyDigest(root: string): string {
  const dependencies = path.join(root, 'node_modules');
  if (!pathExists(dependencies)) return 'sha256-none';
  assertSafeDependencies(root);
  const hash = crypto.createHash('sha256');
  const visited = new Set<string>();
  let hasRelevantEntry = false;
  const visit = (directory: string, relative: string): void => {
    const real = fs.realpathSync(directory);
    if (visited.has(real)) return;
    visited.add(real);
    const entries = fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      if (isIgnoredDependencyPath(dependencies, file)) continue;
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) {
        hasRelevantEntry = true;
        // 保留经过 assertSafeDependencies 校验的相对链接文本，避免 realpath
        // 在 macOS /var 与 /private/var 别名下把临时绝对路径写进摘要。
        hash.update(`link\0${child}\0${fs.readlinkSync(file)}\0`);
      } else if (stat.isDirectory()) {
        visit(file, child);
      } else if (stat.isFile()) {
        hasRelevantEntry = true;
        hash.update(`file\0${child}\0${(stat.mode & 0o777).toString(8)}\0`);
        hash.update(fs.readFileSync(file));
      }
    }
  };
  visit(dependencies, 'node_modules');
  if (!hasRelevantEntry) return 'sha256-none';
  return `sha256-${hash.digest('hex')}`;
}

function directoryDigest(root: string): Readonly<{ templateDigest: string; dependencyDigest: string }> {
  assertDirectory(root, 'profile 目录');
  const hash = crypto.createHash('sha256');
  const visit = (directory: string, relative: string): void => {
    const entries = fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === MANAGED_PROFILE_MARKER) continue;
      const file = path.join(directory, entry.name);
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) throw new Error(`profile 不允许符号链接: ${file}`);
      if (stat.isDirectory()) {
        hash.update(`directory\0${child}\0`);
        visit(file, child);
      } else if (stat.isFile()) {
        hash.update(`file\0${child}\0`);
        hash.update(fs.readFileSync(file));
      } else {
        throw new Error(`profile 包含不支持的文件类型: ${file}`);
      }
    }
  };
  visit(root, '');
  const closure = dependencyDigest(root);
  hash.update(`dependencies\0${closure}\0`);
  return Object.freeze({ templateDigest: `sha256-${hash.digest('hex')}`, dependencyDigest: closure });
}

function profileNameFor(sourceProfile: string): string {
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(sourceProfile)) throw new Error(`profile 名称无效: ${sourceProfile}`);
  return sourceProfile;
}

/** 使用临时文件和 rename 刷新 marker，避免崩溃后留下半个归属记录。 */
function writeMarker(file: string, marker: ManagedProfileMarker): void {
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${crypto.randomUUID()}.tmp`);
  fs.writeFileSync(temporary, `${JSON.stringify(marker, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });
  fs.renameSync(temporary, file);
}

function copyTemplate(source: string, stage: string, marker: ManagedProfileMarker): void {
  assertSafeDependencies(source);
  fs.cpSync(source, stage, {
    recursive: true,
    dereference: false,
    verbatimSymlinks: true,
    filter: (candidate) => {
      const name = path.basename(candidate);
      if (name === 'node_modules' || name === MANAGED_PROFILE_MARKER) return false;
      const stat = fs.lstatSync(candidate);
      if (stat.isSymbolicLink()) throw new Error(`profile 模板不允许符号链接: ${candidate}`);
      return true;
    },
  });
  const dependencies = path.join(source, 'node_modules');
  if (pathExists(dependencies)) {
    // .bin 与 launcher 临时 fallback 都不属于 profile 闭包；其余链接均已通过校验。
    fs.cpSync(dependencies, path.join(stage, 'node_modules'), {
      recursive: true,
      dereference: false,
      verbatimSymlinks: true,
      filter: (candidate) => !isIgnoredDependencyPath(dependencies, candidate),
    });
  }
  writeMarker(path.join(stage, MANAGED_PROFILE_MARKER), marker);
}

function backupPath(dshHome: string, profileName: string): string {
  return path.join(
    dshHome,
    '.dsh-forge',
    'managed-profile-backups',
    profileName,
    `${new Date().toISOString().replaceAll(':', '-')}-${crypto.randomUUID()}`,
  );
}

/**
 * 将发行版 profile 安装到共享 DSH Home 中独占的命名空间。
 *
 * 已安装目录使用 `sourceProfile`，例如 `developer` 会安装为
 * `~/.dsh/profiles/developer`。发行版 ID、来源 profile 和模板摘要记录安装版本；
 * 因此已有缺少当前 marker、归属其他发行版或来源不一致的同名目录一律拒绝覆盖。
 * 升级前的受管 profile 会保留到 Home 下的备份目录，确保写入失败或发布回退时
 * 仍可人工恢复。
 */
export function ensureManagedProfile({
  source,
  dshHome,
  distributionId,
  sourceProfile,
}: {
  readonly source: string;
  readonly dshHome: string;
  readonly distributionId: string;
  readonly sourceProfile: string;
}): ManagedProfileResult {
  const sourceDirectory = path.resolve(source);
  const home = path.resolve(dshHome);
  const profileName = profileNameFor(sourceProfile);
  const template = directoryDigest(sourceDirectory);
  const marker: ManagedProfileMarker = Object.freeze({
    schema: MANAGED_PROFILE_SCHEMA,
    distributionId,
    sourceProfile,
    templateDigest: template.templateDigest,
    dependencyDigest: template.dependencyDigest,
  });
  const profilesDirectory = path.join(home, 'profiles');
  const destination = path.join(profilesDirectory, profileName);
  const markerFile = path.join(destination, MANAGED_PROFILE_MARKER);
  const destinationExists = pathExists(destination);

  assertDirectory(destination, '已安装 profile');
  if (destinationExists) {
    const existing = readMarker(markerFile);
    if (existing?.distributionId !== distributionId || existing.sourceProfile !== sourceProfile)
      throw new Error(`拒绝覆盖不符合当前发行版受管契约的 profile: ${profileName}`);
    const current = directoryDigest(destination);
    if (current.templateDigest === template.templateDigest && fs.existsSync(path.join(destination, 'package.json'))) {
      if (
        existing.templateDigest !== template.templateDigest ||
        existing.dependencyDigest !== template.dependencyDigest
      )
        writeMarker(markerFile, marker);
      return Object.freeze({ directory: destination, profileName, installed: false, updated: false });
    }
  }

  fs.mkdirSync(profilesDirectory, { recursive: true, mode: 0o700 });
  const stage = path.join(profilesDirectory, `.${profileName}.${crypto.randomUUID()}.dsh-forge-stage`);
  copyTemplate(sourceDirectory, stage, marker);
  if (!destinationExists) {
    fs.renameSync(stage, destination);
    return Object.freeze({ directory: destination, profileName, installed: true, updated: false });
  }

  const backup = backupPath(home, profileName);
  fs.mkdirSync(path.dirname(backup), { recursive: true, mode: 0o700 });
  fs.renameSync(destination, backup);
  try {
    fs.renameSync(stage, destination);
  } catch (error) {
    fs.renameSync(backup, destination);
    throw error;
  }
  return Object.freeze({ directory: destination, profileName, installed: false, updated: true });
}
