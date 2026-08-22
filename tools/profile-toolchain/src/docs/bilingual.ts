import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface PublicDocumentsManifest {
  readonly public: readonly string[];
  readonly internalBilingual: readonly string[];
  readonly excluded: readonly string[];
}

export interface BilingualCheckResult {
  readonly pairs: number;
  readonly publicFiles: readonly string[];
}

interface LinkTarget {
  readonly source: string;
  readonly target: string;
}

const ignoredDirectories = new Set(['.git', 'artifacts', 'dist', 'node_modules', '.pnpm-store', 'website']);
const hashPattern = /^[0-9a-f]{40}$/;

function toPosix(file: string): string {
  return file.split(path.sep).join('/');
}

function assertRepositoryPath(file: string, kind: string): void {
  if (
    file.length === 0 ||
    path.isAbsolute(file) ||
    file.includes('\\') ||
    file.startsWith('../') ||
    file.includes('/../') ||
    path.posix.normalize(file) !== file
  ) {
    throw new Error(`${kind} 包含非法仓库路径: ${file}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value) || !value.every((entry): entry is string => typeof entry === 'string'))
    throw new Error(`公开文档清单字段 ${field} 必须是字符串数组`);
  return value;
}

export function readPublicDocumentsManifest(repositoryRoot: string): PublicDocumentsManifest {
  const manifestFile = path.join(repositoryRoot, 'docs', 'i18n', 'public-documents.json');
  let value: unknown;
  try {
    value = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  } catch (error) {
    throw new Error(`无法读取公开文档清单: ${manifestFile} (${error instanceof Error ? error.message : String(error)})`);
  }
  if (!isRecord(value)) throw new Error('公开文档清单必须是 JSON 对象');
  const unsupported = Object.keys(value).filter((key) => !['public', 'internalBilingual', 'excluded'].includes(key));
  if (unsupported.length > 0) throw new Error(`公开文档清单包含未知字段: ${unsupported.join(', ')}`);
  const publicFiles = stringArray(value.public, 'public');
  const internalBilingual = stringArray(value.internalBilingual ?? [], 'internalBilingual');
  const excluded = stringArray(value.excluded, 'excluded');
  if (publicFiles.length === 0) throw new Error('公开文档清单不能为空');
  const seen = new Set<string>();
  for (const file of publicFiles) {
    assertRepositoryPath(file, '公开文档清单');
    if (!file.endsWith('.md') || file.endsWith('.zh.md'))
      throw new Error(`公开文档必须使用英文 .md 路径: ${file}`);
    if (seen.has(file)) throw new Error(`公开文档清单重复路径: ${file}`);
    seen.add(file);
  }
  for (const file of internalBilingual) {
    assertRepositoryPath(file, '内部双语文档清单');
    if (!file.endsWith('.md') || file.endsWith('.zh.md'))
      throw new Error(`内部双语文档必须使用英文 .md 路径: ${file}`);
    if (seen.has(file)) throw new Error(`双语文档清单重复路径: ${file}`);
    seen.add(file);
    if (!excluded.includes(file)) throw new Error(`内部双语文档必须同时列为排除项: ${file}`);
  }
  for (const file of excluded) assertRepositoryPath(file, '公开文档排除项');
  return Object.freeze({
    public: Object.freeze([...publicFiles]),
    internalBilingual: Object.freeze([...internalBilingual]),
    excluded: Object.freeze([...excluded]),
  });
}

export function chineseSibling(english: string): string {
  if (!english.endsWith('.md') || english.endsWith('.zh.md'))
    throw new Error(`不是英文 Markdown 路径: ${english}`);
  return `${english.slice(0, -'.md'.length)}.zh.md`;
}

export function sidecarPath(english: string): string {
  if (!english.endsWith('.md') || english.endsWith('.zh.md'))
    throw new Error(`不是英文 Markdown 路径: ${english}`);
  return `${english.slice(0, -'.md'.length)}.i18n.yaml`;
}

export function gitBlobHash(content: Buffer): string {
  const hash = createHash('sha1');
  hash.update(`blob ${content.byteLength}\0`);
  hash.update(content);
  return hash.digest('hex');
}

export function renderSidecar(english: string, englishHash: string, chinese: string, chineseHash: string): string {
  return [
    '# 已确认中英文内容的 Git blob hash。修改任一侧后，必须同步对侧并重新生成。',
    `# pnpm run docs:pair --write ${english}`,
    `${path.posix.basename(english)}: ${englishHash}`,
    `${path.posix.basename(chinese)}: ${chineseHash}`,
    '',
  ].join('\n');
}

export function parseSidecar(content: string): ReadonlyMap<string, string> {
  const entries = new Map<string, string>();
  for (const line of content.split('\n')) {
    if (line === '' || line.startsWith('#')) continue;
    const match = /^([^:#]+\.md): ([0-9a-f]{40})$/.exec(line);
    if (!match?.[1] || !match[2]) throw new Error(`sidecar 格式非法: ${line}`);
    if (entries.has(match[1])) throw new Error(`sidecar 重复条目: ${match[1]}`);
    entries.set(match[1], match[2]);
  }
  return entries;
}

function readFile(repositoryRoot: string, file: string): Buffer {
  const absolute = path.join(repositoryRoot, file);
  if (!fs.existsSync(absolute)) throw new Error(`缺少双语文档文件: ${file}`);
  if (!fs.statSync(absolute).isFile()) throw new Error(`双语文档路径不是文件: ${file}`);
  return fs.readFileSync(absolute);
}

function languageSwitcher(content: string, expected: string, file: string): void {
  const lines = content.split('\n').filter((line) => line.trim() !== '');
  if (lines[1] !== expected) throw new Error(`语言切换链接错误: ${file}，应为 ${expected}`);
}

function structureSignature(content: string): readonly string[] {
  const signature: string[] = [];
  let fenced = false;
  for (const line of content.split('\n')) {
    const fence = /^(```|~~~)([^\s]*)/.exec(line);
    if (fence?.[1] !== undefined) {
      signature.push(`fence:${fenced ? 'close' : 'open'}:${fence[1]}:${fence[2] || ''}`);
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const heading = /^(#{1,6})\s+/.exec(line);
    if (heading?.[1]) signature.push(`heading:${heading[1].length}`);
    const ordered = /^(\s*)\d+[.)]\s+/.exec(line);
    if (ordered?.[1] !== undefined) signature.push(`list:ordered:${ordered[1].length}`);
    const unordered = /^(\s*)[-*+]\s+/.exec(line);
    if (unordered?.[1] !== undefined) signature.push(`list:unordered:${unordered[1].length}`);
    if (/^\|.*\|\s*$/.test(line)) {
      const columns = line.split('|').length - 2;
      signature.push(`table:${columns}`);
    }
  }
  if (fenced) throw new Error('Markdown 代码围栏未闭合');
  return signature;
}

function normalizeMarkdownTarget(repositoryRoot: string, source: string, rawTarget: string): string | undefined {
  const [target] = rawTarget.split('#', 1);
  if (!target || /^(?:https?:|mailto:|#|\/)/.test(target)) return undefined;
  const relative = target.split(/[\s?]/, 1)[0];
  if (!relative || !relative.endsWith('.md')) return undefined;
  const resolved = path.resolve(path.dirname(path.join(repositoryRoot, source)), relative);
  const normal = toPosix(path.relative(repositoryRoot, resolved));
  assertRepositoryPath(normal, `Markdown 链接 ${source}`);
  return normal;
}

function relativeLinks(repositoryRoot: string, source: string, content: string): readonly LinkTarget[] {
  const links: LinkTarget[] = [];
  for (const match of content.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    const rawTarget = match[1];
    if (!rawTarget) continue;
    const target = normalizeMarkdownTarget(repositoryRoot, source, rawTarget);
    if (target) links.push({ source, target });
  }
  return links;
}

function assertLocalizedLinks(
  repositoryRoot: string,
  english: string,
  chinese: string,
  englishContent: string,
  chineseContent: string,
  bilingualFiles: ReadonlySet<string>,
): void {
  const englishLinks = relativeLinks(repositoryRoot, english, englishContent);
  const chineseLinks = relativeLinks(repositoryRoot, chinese, chineseContent);
  if (englishLinks.length !== chineseLinks.length)
    throw new Error(`相对链接数量不一致: ${english} / ${chinese}`);
  for (let index = 0; index < englishLinks.length; index += 1) {
    const left = englishLinks[index];
    const right = chineseLinks[index];
    if (!left || !right) throw new Error(`相对链接读取失败: ${english} / ${chinese}`);
    const expected = left.target === chinese
      ? english
      : bilingualFiles.has(left.target) ? chineseSibling(left.target) : left.target;
    if (right.target !== expected)
      throw new Error(`相对链接未本地化: ${chinese} 应链接到 ${expected}，实际为 ${right.target}`);
  }
}

function walkSidecars(directory: string, root: string, found: string[]): void {
  for (const name of fs.readdirSync(directory)) {
    if (ignoredDirectories.has(name)) continue;
    const absolute = path.join(directory, name);
    if (fs.statSync(absolute).isDirectory()) {
      walkSidecars(absolute, root, found);
    } else if (name.endsWith('.i18n.yaml')) {
      found.push(toPosix(path.relative(root, absolute)));
    }
  }
}

function assertNoUnexpectedSidecars(repositoryRoot: string, bilingualFiles: ReadonlySet<string>): void {
  const sidecars: string[] = [];
  walkSidecars(repositoryRoot, repositoryRoot, sidecars);
  const expected = new Set([...bilingualFiles].map(sidecarPath));
  for (const file of sidecars) {
    if (!expected.has(file)) throw new Error(`非公开或未声明文档不应有双语 sidecar: ${file}`);
  }
}

export function checkBilingualDocumentation(repositoryRoot: string): BilingualCheckResult {
  const manifest = readPublicDocumentsManifest(repositoryRoot);
  const bilingualFiles = new Set([...manifest.public, ...manifest.internalBilingual]);
  assertNoUnexpectedSidecars(repositoryRoot, bilingualFiles);
  for (const english of bilingualFiles) {
    const chinese = chineseSibling(english);
    const sidecar = sidecarPath(english);
    const englishBuffer = readFile(repositoryRoot, english);
    const chineseBuffer = readFile(repositoryRoot, chinese);
    const sidecarBuffer = readFile(repositoryRoot, sidecar);
    const englishContent = englishBuffer.toString('utf8');
    const chineseContent = chineseBuffer.toString('utf8');
    const sidecarEntries = parseSidecar(sidecarBuffer.toString('utf8'));
    const expectedKeys = new Set([path.posix.basename(english), path.posix.basename(chinese)]);
    if (sidecarEntries.size !== expectedKeys.size || [...expectedKeys].some((key) => !sidecarEntries.has(key)))
      throw new Error(`sidecar 没有精确记录双语文件: ${sidecar}`);
    if (!hashPattern.test(sidecarEntries.get(path.posix.basename(english)) || ''))
      throw new Error(`sidecar 英文 hash 非法: ${sidecar}`);
    if (!hashPattern.test(sidecarEntries.get(path.posix.basename(chinese)) || ''))
      throw new Error(`sidecar 中文 hash 非法: ${sidecar}`);
    if (sidecarEntries.get(path.posix.basename(english)) !== gitBlobHash(englishBuffer))
      throw new Error(`英文文档 hash 漂移: ${english}`);
    if (sidecarEntries.get(path.posix.basename(chinese)) !== gitBlobHash(chineseBuffer))
      throw new Error(`中文文档 hash 漂移: ${chinese}`);
    languageSwitcher(englishContent, `English | [中文](${path.posix.basename(chinese)})`, english);
    languageSwitcher(chineseContent, `中文 | [English](${path.posix.basename(english)})`, chinese);
    const englishStructure = structureSignature(englishContent);
    const chineseStructure = structureSignature(chineseContent);
    if (JSON.stringify(englishStructure) !== JSON.stringify(chineseStructure))
      throw new Error(`双语文档结构不一致: ${english} / ${chinese}`);
    assertLocalizedLinks(repositoryRoot, english, chinese, englishContent, chineseContent, bilingualFiles);
  }
  return Object.freeze({ pairs: manifest.public.length, publicFiles: Object.freeze([...manifest.public]) });
}

export function writeBilingualSidecars(repositoryRoot: string, files: readonly string[]): BilingualCheckResult {
  const manifest = readPublicDocumentsManifest(repositoryRoot);
  const requested = files.length === 0 ? manifest.public : files;
  const allowed = new Set([...manifest.public, ...manifest.internalBilingual]);
  for (const english of requested) {
    if (!allowed.has(english)) throw new Error(`不是已声明英文文档，不能写入 sidecar: ${english}`);
    const chinese = chineseSibling(english);
    const englishBuffer = readFile(repositoryRoot, english);
    const chineseBuffer = readFile(repositoryRoot, chinese);
    fs.writeFileSync(
      path.join(repositoryRoot, sidecarPath(english)),
      renderSidecar(english, gitBlobHash(englishBuffer), chinese, gitBlobHash(chineseBuffer)),
      'utf8',
    );
  }
  return checkBilingualDocumentation(repositoryRoot);
}
