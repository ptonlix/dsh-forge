import * as fs from 'node:fs';
import * as path from 'node:path';
import { docsPages } from '../website/docs.ts';

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'website', '.dist');
function routeKey(route: string): string {
  const clean = route.replace(/\.md$/, '');
  if (clean === 'index') return '/';
  return `/${clean}/`;
}

export function fragmentExists(html: string, fragment: string): boolean {
  const escaped = fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:id|name)="${escaped}"`).test(html);
}

export function verifySiteOutput(dist: string): { readonly routes: number } {
  const htmlByRoute = new Map<string, string>();
  for (const page of docsPages) {
    const html = path.join(dist, page.route === 'index.md' ? 'index.html' : page.route.replace(/\.md$/, '.html'));
    if (!fs.existsSync(html)) throw new Error(`站点 HTML 路由缺失: ${page.route}`);
    htmlByRoute.set(routeKey(page.route), fs.readFileSync(html, 'utf8'));
    if (!fs.existsSync(path.join(dist, page.route))) throw new Error(`raw Markdown 路由缺失: ${page.route}`);
  }
  for (const [route, html] of htmlByRoute) {
    for (const match of html.matchAll(/href="([^"]+)"/g)) {
      const href = match[1];
      if (!href || /^(?:https?:|mailto:|#|\/[^/])/.test(href)) continue;
      const [target, fragment] = href.split('#');
      if (!target || !target.startsWith('/')) continue;
      const targetRoute = target.endsWith('/') ? target : `${target}/`;
      const targetHtml = htmlByRoute.get(targetRoute);
      if (!targetHtml) throw new Error(`站内 HTML 链接不存在: ${route} -> ${href}`);
      if (fragment && !fragmentExists(targetHtml, fragment))
        throw new Error(`站内 fragment 不存在: ${route} -> ${href}`);
    }
  }
  if (!fs.existsSync(path.join(dist, 'llms.txt'))) throw new Error('缺少 llms.txt');
  return Object.freeze({ routes: docsPages.length });
}

if (require.main === module) console.log(JSON.stringify({ valid: true, ...verifySiteOutput(dist) }));
