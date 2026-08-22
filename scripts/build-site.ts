import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { emitRawMarkdown, expectedRoutes, projectDocs } from './project-docs.ts';

const root = path.resolve(__dirname, '..');
const website = path.join(root, 'website');
const base = process.env.DOCS_BASE ?? '/';

projectDocs();
if (process.argv.includes('--dev')) {
  const vitepress = path.join(website, 'node_modules', 'vitepress', 'bin', 'vitepress.js');
  const result = spawnSync(process.execPath, [vitepress, 'dev', '.', '--host', '127.0.0.1', '--port', '5173'], { cwd: website, stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
} else {
  const vitepress = path.join(website, 'node_modules', 'vitepress', 'bin', 'vitepress.js');
  const result = spawnSync(process.execPath, [vitepress, 'build', '.'], { cwd: website, stdio: 'inherit', env: { ...process.env, DOCS_BASE: base } });
  if (result.status !== 0) process.exit(result.status ?? 1);
  const dist = path.join(website, '.dist');
  emitRawMarkdown(dist, base);
  for (const route of expectedRoutes()) {
    const html = path.join(dist, route === 'index.md' ? 'index.html' : route.replace(/\.md$/, '.html'));
    if (!fs.existsSync(html)) throw new Error(`站点 HTML 路由缺失: ${route}`);
    if (!fs.existsSync(path.join(dist, route))) throw new Error(`raw Markdown 路由缺失: ${route}`);
  }
  if (!fs.existsSync(path.join(dist, 'llms.txt'))) throw new Error('缺少 llms.txt');
}
