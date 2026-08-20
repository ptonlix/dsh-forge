import { readYaml } from '../core/yaml.ts';
import { parseCatalogEntry, type CatalogEntry } from '../core/schema.ts';
import { fail } from '../core/errors.ts';

const TRUST_MODE = 'trusted-in-process';
const NON_ISOLATION_NOTICE = '该插件与 DSH Host 同进程运行；元数据审查和用户授权不构成 Node/Electron 技术隔离。';

/** 静态 catalog 信任边界：只读取审计快照，安装必须经过用户确认且不在启动期执行。 */

/** 创建供审计和 UI 展示的 host 能力描述，不宣称技术隔离。 */
export function hostDescriptor({
  id,
  version,
  supportedServices = [],
  executionMode = TRUST_MODE,
}: {
  id: string;
  version: string;
  supportedServices?: readonly string[];
  executionMode?: string;
}): Readonly<Record<string, unknown>> {
  if (executionMode !== TRUST_MODE) fail('首版只支持 trusted-in-process', 'TRUST_MODE');
  return Object.freeze({
    schema: 'dsh-forge/host-descriptor@1',
    id,
    version,
    supportedServices: supportedServices.slice(),
    executionMode,
    enforcement: 'unavailable',
    notice: NON_ISOLATION_NOTICE,
  });
}

/** 读取并验证 catalog 顶层 schema 与条目结构。 */
export function readCatalog(file: string): Readonly<{ schema: string; entries: readonly CatalogEntry[] }> {
  const raw = readYaml(file);
  const record =
    raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (
    !record ||
    record.schema !== 'dsh-forge/catalog@1' ||
    !Array.isArray(record.entries) ||
    Object.keys(record).some((key) => !['schema', 'entries'].includes(key))
  )
    fail('catalog 快照 schema 无效', 'CATALOG_SCHEMA');
  return Object.freeze({
    schema: record.schema as string,
    entries: (record.entries as unknown[]).map(parseCatalogEntry),
  });
}

/** 检查 catalog id 唯一性、条目 schema 和 L0/L1 审计有效期。 */
export function verifyCatalog(
  catalog: readonly CatalogEntry[] | { readonly entries: readonly CatalogEntry[] },
  { now = Date.now(), maxAuditAgeMs = 180 * 24 * 60 * 60 * 1000 } = {},
): { readonly valid: true; readonly count: number; readonly checkedAt: string } {
  const entries =
    (catalog as { readonly entries?: readonly CatalogEntry[] }).entries ?? (catalog as readonly CatalogEntry[]);
  const ids = new Set<string>();
  for (const entry of entries) {
    if (ids.has(entry.id)) fail(`catalog id 重复: ${entry.id}`, 'CATALOG_DUPLICATE');
    ids.add(entry.id);
    parseCatalogEntry(entry);
    if (entry.tier !== 'L2' && Date.parse(entry.verifiedAt!) + maxAuditAgeMs < now)
      fail(`catalog 审核已过期: ${entry.id}`, 'CATALOG_AUDIT_EXPIRED');
  }
  return { valid: true, count: entries.length, checkedAt: new Date().toISOString() };
}

/** 判断版本、来源、脚本、能力或执行模式变化是否需要重新审计。 */
export function requiresReaudit(previous: CatalogEntry, next: CatalogEntry): boolean {
  parseCatalogEntry(previous);
  parseCatalogEntry(next);
  const facts: readonly (keyof CatalogEntry)[] = [
    'version',
    'integrity',
    'dependencies',
    'scripts',
    'capabilities',
    'pluginRequest',
    'executionMode',
  ];
  return facts.some((field) => JSON.stringify(previous[field] ?? null) !== JSON.stringify(next[field] ?? null));
}

export function loadStaticCatalog(file: string): Readonly<{ schema: string; entries: readonly CatalogEntry[] }> {
  const catalog = readCatalog(file);
  verifyCatalog(catalog);
  return catalog;
}

/** 生成安装确认记录；未明确确认时抛出错误且不允许调用安装流程。 */
export function installationConfirmation(
  entry: CatalogEntry,
  profile: string,
  userConfirmed = false,
  profileChanges = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'],
) {
  parseCatalogEntry(entry);
  const confirmation = Object.freeze({
    packageName: entry.packageName,
    version: entry.version,
    source: entry.source,
    integrity: entry.integrity,
    license: entry.license,
    capabilities: entry.capabilities,
    scripts: entry.scripts,
    executionMode: entry.executionMode,
    notice: NON_ISOLATION_NOTICE,
    profile,
    profileChanges: profileChanges.slice(),
    userConfirmed,
  });
  if (!userConfirmed) fail('安装必须由用户明确确认', 'CATALOG_CONFIRMATION_REQUIRED', confirmation);
  return confirmation;
}

export function assertNoStartupInstall<T>(catalog: T, action?: { readonly type?: string }): T {
  if (action && action.type === 'install') fail('启动阶段禁止自动安装 catalog 内容', 'CATALOG_STARTUP_INSTALL');
  return catalog;
}

export { TRUST_MODE, NON_ISOLATION_NOTICE };
