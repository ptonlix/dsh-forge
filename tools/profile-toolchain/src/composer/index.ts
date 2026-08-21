import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseYaml, readYaml, stringifyYaml } from '../core/yaml.ts';
import { fail } from '../core/errors.ts';
import { type CompiledProfile } from '../compiler/index.ts';
import { errorMessage } from '../types.ts';
import type { JsonObject, Overlay } from '../types.ts';

/**
 * DSH 配置组合器：在不修改 profile 持久层所有权的前提下，临时叠加
 * desktop layer、home patch 和 launcher overlay，并调用真实 Loader 生成 dump。
 * 组合顺序是行为契约：bundle → profile → home → overlay；诊断会保留未匹配
 * patch、缺失服务和包身份问题，供 CLI、验收和发布门禁消费。
 */

const OVERLAY_FIELDS = new Set([
  'port',
  'profilePath',
  'homePath',
  'platformProvider',
  'generationId',
  'runtimePath',
  'loopbackUrl',
]);
const DESKTOP_LAYER = '@dsh-forge/desktop-layer';
const WEB_BUNDLE = '@deepseek-ai/dsh-web-app';

export interface ConfigEntry {
  readonly id?: string;
  readonly name?: string;
  /** `!!js` 条件会在真实 Loader 中求值，静态转储不能将其误判为布尔值。 */
  readonly disabled?: boolean | string;
  readonly inject?: string | readonly string[];
  readonly provide?: readonly string[];
  readonly provides?: readonly string[];
  readonly [key: string]: unknown;
}

export interface EntryActivation {
  readonly id: string | null;
  readonly name: string | null;
  /** `null` 表示 entry 依赖运行时表达式决定是否禁用。 */
  readonly active: boolean | null;
  readonly requires: readonly string[];
  readonly missing: readonly string[];
}

export interface ComposeDiagnostic {
  readonly code: string;
  readonly id?: string | null;
  readonly package?: string;
  readonly service?: string;
  readonly message?: string;
}

export interface ConfigDump {
  readonly schema: 'dsh-forge/config-dump@1';
  readonly profile: string;
  readonly bundleOrder: readonly string[];
  readonly overlay: Readonly<Overlay>;
  readonly entries: readonly ConfigEntry[];
  readonly activation: readonly EntryActivation[];
  readonly diagnostics: readonly ComposeDiagnostic[];
  readonly dump: string;
  readonly healthy: boolean;
}

/** 校验 launcher 允许的最小运行时覆盖集合，拒绝越界字段和不安全路径。 */
export function validateOverlay(overlay: Overlay = {}): Readonly<Overlay> {
  if (!overlay || typeof overlay !== 'object' || Array.isArray(overlay))
    fail('launcher overlay 必须是对象', 'OVERLAY_INVALID');
  for (const key of Object.keys(overlay)) {
    if (!OVERLAY_FIELDS.has(key)) fail(`launcher overlay 越界字段: ${key}`, 'OVERLAY_FORBIDDEN', { key });
  }
  if (overlay.port !== undefined && (!Number.isInteger(overlay.port) || overlay.port < 1 || overlay.port > 65535)) {
    fail(`overlay.port 无效: ${overlay.port}`, 'OVERLAY_INVALID');
  }
  for (const key of ['profilePath', 'homePath', 'runtimePath']) {
    const value = overlay[key as keyof Overlay];
    if (value !== undefined && (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0')))
      fail(`overlay.${key} 必须是有效绝对路径`, 'OVERLAY_INVALID');
  }
  return Object.freeze({ ...overlay });
}

/** 在内存中插入 launcher 所有的 desktop layer，绝不把它写回 profile。 */
export function desktopBundleOrder(bundles: readonly string[]): string[] {
  if (bundles.includes(DESKTOP_LAYER))
    fail('profile 不得持久化 desktop layer；该层由 launcher 管理', 'DESKTOP_LAYER_OWNERSHIP');
  const web = bundles.indexOf(WEB_BUNDLE);
  if (web < 0) fail('desktop profile 缺少 @deepseek-ai/dsh-web-app', 'DESKTOP_LAYER_UNRESOLVED');
  return [...bundles.slice(0, web + 1), DESKTOP_LAYER, ...bundles.slice(web + 1)];
}

function readPatchInput(patch: string | readonly unknown[] | undefined): unknown[] {
  if (!patch) return [];
  const value = typeof patch === 'string' ? readYaml(patch) : patch;
  if (!Array.isArray(value)) fail('patch 必须是数组', 'PATCH_INVALID');
  return value;
}

/** 将端口 overlay 转换为 Loader patch；没有端口时不生成额外 entry。 */
export function launcherOverlayPatch(overlay: Overlay): ConfigEntry[] {
  if (!overlay.port) return [];
  return [
    {
      id: 'webserver',
      name: '@deepseek-ai/dsh-host-webserver',
      config: { host: '127.0.0.1', port: overlay.port },
    },
  ];
}

function copyProfileToHome(
  compiled: CompiledProfile,
  home: string,
  homePatch: string | readonly unknown[] | undefined,
  overlay: Overlay,
): string {
  const profileDir = path.join(home, 'profiles', compiled.profile.name);
  fs.mkdirSync(profileDir, { recursive: true, mode: 0o700 });
  for (const file of ['package.json', 'cordis.patch.yml', 'cordis.yml', 'pnpm-workspace.yaml', 'pnpm-lock.yaml']) {
    const source = path.join(compiled.profileDir, file);
    if (!fs.existsSync(source)) fail(`编译 profile 缺少 ${file}`, 'COMPOSE_PROFILE_MISSING');
    fs.copyFileSync(source, path.join(profileDir, file));
  }
  const manifestPath = path.join(profileDir, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as JsonObject;
  const dsh = manifest.dsh !== null && typeof manifest.dsh === 'object' ? (manifest.dsh as JsonObject) : {};
  const profile = dsh.profile !== null && typeof dsh.profile === 'object' ? (dsh.profile as JsonObject) : {};
  manifest.dsh = { ...dsh, profile: { ...profile, bundles: desktopBundleOrder(compiled.profile.bundles) } };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  const patches = [...readPatchInput(homePatch), ...launcherOverlayPatch(overlay)];
  if (patches.length) {
    const content = `${stringifyYaml(patches)}\n`;
    fs.writeFileSync(path.join(home, 'cordis.patch.yml'), content, { mode: 0o600 });
  }
  return profileDir;
}

function dshBin(root: string): string {
  const bin = path.join(root, 'node_modules', '.bin', 'dsh');
  if (!fs.existsSync(bin)) fail('未找到上游 dsh CLI', 'DSH_RUNTIME_MISSING');
  return bin;
}

function verifyEntryPackages(entries: readonly ConfigEntry[], compiled: CompiledProfile): ComposeDiagnostic[] {
  const diagnostics: ComposeDiagnostic[] = [];
  const ids = new Set();
  const resolvedPackages = new Set(compiled.dependencyClosure.map((dependency) => dependency.name));
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    if (entry.id) {
      if (ids.has(entry.id)) diagnostics.push({ code: 'DUPLICATE_PROVIDER', id: entry.id });
      ids.add(entry.id);
    }
    if (typeof entry.name !== 'string' || entry.name.startsWith('.')) continue;
    const segments = entry.name.split('/');
    const packageName = entry.name.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0]!;
    const launcherPackage =
      packageName === '@dsh-forge/desktop-services-local' &&
      fs.existsSync(path.join(compiled.root, 'packages', 'desktop-services-local', 'package.json'));
    if (!resolvedPackages.has(packageName) && !launcherPackage)
      diagnostics.push({ code: 'ENTRY_PACKAGE_UNRESOLVED', id: entry.id || null, package: entry.name });
  }
  if (!ids.has('dsh-forge-desktop-services'))
    diagnostics.push({ code: 'DESKTOP_INJECTION_UNRESOLVED', package: '@dsh-forge/desktop-services-local' });
  return diagnostics;
}

function parseWarnings(stderr: string): ComposeDiagnostic[] {
  return stderr
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => ({
      code: /patch(?: insert)?:/.test(line) ? 'PATCH_UNMATCHED' : 'DSH_DUMP_DIAGNOSTIC',
      message: line,
    }));
}

/** 用稳定占位符归一化机器路径，保证配置 dump 可比较且不泄露用户目录。 */
export function normalizeDumpPaths(dump: string, home: string): string {
  // 上游 renderConfigDump 会把临时 home 中的 patch 文件路径写入注释；该路径不是配置事实。
  return dump.split(home).join('<DSH_HOME>');
}

/** 根据提供/注入关系计算 entry 是否可激活，不依赖输入列表顺序。 */
export function entryActivation(
  entries: readonly ConfigEntry[],
  initialServices: readonly string[] = [],
): EntryActivation[] {
  const available = new Set(initialServices);
  const activation = [];
  for (const entry of entries) {
    const requires = Array.isArray(entry.inject) ? entry.inject : entry.inject ? [entry.inject] : [];
    const missing = requires.filter((service) => !available.has(service));
    const active = typeof entry.disabled === 'string' ? null : !entry.disabled && missing.length === 0;
    activation.push({ id: entry.id || null, name: entry.name || null, active, requires, missing });
    for (const service of entry.provide || entry.provides || []) if (active === true) available.add(service);
  }
  return activation;
}

/** 复制 profile 到 home、组合所有 patch 并运行真实 DSH dump-config。 */
export function composeCompiled(
  compiled: CompiledProfile,
  {
    homePatch,
    overlay = {},
    requiredServices = [],
  }: { homePatch?: string | readonly unknown[]; overlay?: Overlay; requiredServices?: readonly string[] } = {},
): ConfigDump {
  const normalizedOverlay = validateOverlay(overlay);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-compose-'));
  try {
    const profileDir = copyProfileToHome(compiled, home, homePatch, normalizedOverlay);
    const result = spawnSync(dshBin(compiled.root), ['--profile', compiled.profile.name, '--dump-config'], {
      cwd: compiled.root,
      encoding: 'utf8',
      timeout: 60_000,
      env: { ...process.env, DSH_HOME: home },
    });
    if (result.status !== 0) {
      fail(`上游 DSH 配置转储失败: ${(result.stderr || result.stdout || 'unknown error').trim()}`, 'DSH_DUMP_FAILED', {
        status: result.status,
        signal: result.signal,
        profileDir,
      });
    }
    let entries;
    try {
      entries = parseYaml(result.stdout, 'dsh --dump-config');
    } catch (error) {
      fail(`无法解析上游 DSH 配置转储: ${errorMessage(error)}`, 'DSH_DUMP_PARSE');
    }
    if (!Array.isArray(entries)) fail('上游 DSH 配置转储不是 entry 数组', 'DSH_DUMP_PARSE');
    const configEntries = entries.filter(
      (entry): entry is ConfigEntry => entry !== null && typeof entry === 'object' && !Array.isArray(entry),
    );
    const activation = entryActivation(configEntries);
    const diagnostics = [...parseWarnings(result.stderr), ...verifyEntryPackages(configEntries, compiled)];
    for (const service of requiredServices) {
      if (!configEntries.some((entry) => entry.id === service || entry.name === service))
        diagnostics.push({ code: 'INJECTION_UNRESOLVED', service });
    }
    return {
      schema: 'dsh-forge/config-dump@1',
      profile: compiled.profile.name,
      bundleOrder: desktopBundleOrder(compiled.profile.bundles),
      overlay: normalizedOverlay,
      entries: configEntries,
      activation,
      diagnostics,
      dump: normalizeDumpPaths(result.stdout, home),
      healthy: diagnostics.length === 0,
    };
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

/** 写入规范化 config-dump.json，供 verifyProfile、CLI 和发布门禁复用。 */
export function writeConfigDump(
  compiled: CompiledProfile,
  options: Parameters<typeof composeCompiled>[1] = {},
): ConfigDump {
  const dump = composeCompiled(compiled, options);
  fs.writeFileSync(path.join(compiled.outputDir, 'config-dump.json'), `${JSON.stringify(dump, null, 2)}\n`, {
    mode: 0o600,
  });
  fs.writeFileSync(path.join(compiled.outputDir, 'config-dump.yml'), dump.dump, { mode: 0o600 });
  return dump;
}

export { DESKTOP_LAYER, WEB_BUNDLE };
