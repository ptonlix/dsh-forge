import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

const MANAGED_PROFILE_SCHEMA = 'dsh-forge/managed-profile@1';
const MANAGED_PROFILE_MARKER = '.dsh-forge-profile.json';

interface ManagedProfileMarker {
  readonly schema: typeof MANAGED_PROFILE_SCHEMA;
  readonly distributionId: string;
  readonly sourceProfile: string;
  readonly templateDigest: string;
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
    typeof record.templateDigest === 'string'
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
 * `node_modules` 是安装状态而非 profile 声明，不参与摘要也不会写入用户 Home；
 * 任何符号链接都被拒绝，避免发行模板或已安装 profile 间接引用任意本地路径。
 */
function directoryDigest(root: string): string {
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
  return `sha256-${hash.digest('hex')}`;
}

function profileNameFor(sourceProfile: string): string {
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(sourceProfile)) throw new Error(`profile 名称无效: ${sourceProfile}`);
  return sourceProfile;
}

/**
 * 发行版 ID 是目录所有权凭据；sourceProfile 仅记录本次模板来源。
 *
 * 同一发行版可以在保持已安装目录不变时重命名 source profile。把来源名称也作为
 * 所有权条件会使这类正常迁移被误判为用户目录，从而无法更新已有受管 profile。
 */
function ownsProfile(marker: ManagedProfileMarker | null, distributionId: string): boolean {
  return marker?.distributionId === distributionId;
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
  fs.cpSync(source, stage, {
    recursive: true,
    dereference: false,
    filter: (candidate) => {
      const name = path.basename(candidate);
      if (name === 'node_modules' || name === MANAGED_PROFILE_MARKER) return false;
      const stat = fs.lstatSync(candidate);
      if (stat.isSymbolicLink()) throw new Error(`profile 模板不允许符号链接: ${candidate}`);
      return true;
    },
  });
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
 * `~/.dsh/profiles/developer`。发行版 ID 证明目录归属，来源 profile 和模板摘要
 * 记录安装版本；因此已有无归属标记或属于其他发行版的同名目录一律拒绝覆盖。
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
  const templateDigest = directoryDigest(sourceDirectory);
  const marker: ManagedProfileMarker = Object.freeze({
    schema: MANAGED_PROFILE_SCHEMA,
    distributionId,
    sourceProfile,
    templateDigest,
  });
  const profilesDirectory = path.join(home, 'profiles');
  const destination = path.join(profilesDirectory, profileName);
  const markerFile = path.join(destination, MANAGED_PROFILE_MARKER);
  const destinationExists = pathExists(destination);

  assertDirectory(destination, '已安装 profile');
  if (destinationExists) {
    const existing = readMarker(markerFile);
    if (!ownsProfile(existing, distributionId))
      throw new Error(`拒绝覆盖非本发行版管理的 profile: ${profileName}`);
    const currentDigest = directoryDigest(destination);
    if (currentDigest === templateDigest && fs.existsSync(path.join(destination, 'package.json'))) {
      if (existing?.sourceProfile !== sourceProfile || existing.templateDigest !== templateDigest)
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
