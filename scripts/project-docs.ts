import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  canonicalRepositoryBranch,
  canonicalRepositoryUrl,
  docsPages,
  routeForSource,
  counterpartSource,
  publishedSources,
  type DocsPage,
} from '../website/docs.ts';

const root = path.resolve(__dirname, '..');
const generated = path.join(root, 'website', '.generated');

function sitePath(route: string): string {
  const clean = route.replace(/\.md$/, '');
  if (clean === 'index') return '/';
  if (clean.endsWith('/index')) return `/${clean.slice(0, -'/index'.length)}/`;
  return `/${clean}`;
}

function splitTarget(target: string): { path: string; suffix: string } {
  const marker = target.search(/[?#]/);
  return marker < 0 ? { path: target, suffix: '' } : { path: target.slice(0, marker), suffix: target.slice(marker) };
}

function resolveSource(source: string, target: string): string | undefined {
  const targetPath = splitTarget(target).path;
  if (!targetPath || /^(?:https?:|mailto:|#|\/)/.test(targetPath)) return undefined;
  const absolute = path.posix.normalize(path.posix.join(path.posix.dirname(source), targetPath));
  return absolute.startsWith('../') ? undefined : absolute;
}

function routeLink(page: DocsPage, source: string, target: string): string | undefined {
  const resolved = resolveSource(source, target);
  if (resolved === undefined) return undefined;
  const { suffix } = splitTarget(target);
  const languageTarget = resolved === counterpartSource(source);
  const targetPage = publishedSources.get(resolved);
  if (languageTarget) {
    const counterpart = publishedSources.get(counterpartSource(source));
    return counterpart === undefined ? undefined : `${sitePath(counterpart.route)}${suffix}`;
  }
  if (targetPage === undefined) {
    return `${canonicalRepositoryUrl}/blob/${canonicalRepositoryBranch}/${resolved}${suffix}`;
  }
  const localized = routeForSource(resolved, page.locale);
  return localized === undefined ? undefined : `${sitePath(localized)}${suffix}`;
}

export function rewriteMarkdown(content: string, page: DocsPage): string {
  return content.replace(/(!?\[[^\]]*\])\(([^)]+)\)/g, (full, label: string, target: string) => {
    const rewritten = routeLink(page, page.source, target);
    return rewritten === undefined ? full : `${label}(${rewritten})`;
  });
}

function writePage(page: DocsPage): void {
  const sourceFile = path.join(root, page.source);
  if (!fs.existsSync(sourceFile)) throw new Error(`发布清单源文件不存在: ${page.source}`);
  const output = path.join(generated, page.route);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, rewriteMarkdown(fs.readFileSync(sourceFile, 'utf8'), page));
}

export function projectDocs(): void {
  fs.rmSync(generated, { recursive: true, force: true });
  for (const page of docsPages) writePage(page);
}

export function expectedRoutes(): readonly string[] {
  return docsPages.map((page) => page.route);
}

export function emitRawMarkdown(dist: string, base: string): void {
  const entries = docsPages.map((page) => {
    const source = path.join(generated, page.route);
    const target = path.join(dist, page.route);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, fs.readFileSync(source, 'utf8'));
    const url = `${base}${page.route.replace(/\.md$/, '')}.md`;
    return `- [${page.label}](${url})`;
  });
  fs.writeFileSync(path.join(dist, 'llms.txt'), `# DSH Forge\n\n${entries.join('\n')}\n`);
}
