import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseDistribution, parseProfile } from '../core/schema.ts';
import { parseYaml } from '../core/yaml.ts';
import { checkBilingualDocumentation } from './bilingual.ts';

function walkMarkdown(directory: string, files: string[]): void {
  for (const name of fs.readdirSync(directory)) {
    const file = path.join(directory, name);
    if (fs.statSync(file).isDirectory()) walkMarkdown(file, files);
    else if (file.endsWith('.md')) files.push(file);
  }
}

function validateDocumentContracts(root: string, files: readonly string[]): void {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
    readonly scripts?: Record<string, string>;
  };
  const packageScripts = packageJson.scripts || {};
  const forbidden = ['当前已实现布局', '后续目标布局', '并列替代布局'];
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    for (const phrase of forbidden)
      if (content.includes(phrase)) throw new Error(`文档包含双轨架构表述: ${file} -> ${phrase}`);
    for (const match of content.matchAll(/pnpm run ([a-z0-9:-]+)/g)) {
      const command = match[1];
      if (command && !packageScripts[command]) throw new Error(`文档命令不存在: ${file} -> ${command}`);
    }
    if (content.includes('@dsh-forge/desktop-plugin'))
      throw new Error(`文档引用已删除 desktop-plugin: ${file}`);
    if (
      /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]@dsh-forge\/desktop-services-local(?:['"]|\/)/.test(content) &&
      !file.endsWith(`${path.sep}desktop-services-local${path.sep}README.md`)
    ) {
      throw new Error(`文档不得将私有 provider 作为 consumer 接口: ${file}`);
    }
    for (const [name, parser] of [
      ['distribution', (filePath: string) => parseDistribution(filePath)],
      ['profile', (filePath: string) => parseProfile(filePath)],
    ] as const) {
      const marker = `<!-- dsh-forge-example:${name} -->`;
      const start = content.indexOf(marker);
      if (start < 0) continue;
      const block = content.slice(start).match(/```yaml\s*\n([\s\S]*?)\n```/);
      if (!block?.[1]) throw new Error(`文档示例缺少 YAML 内容: ${file} -> ${name}`);
      const parsed = parseYaml(block[1], `${file}:${name}`);
      if (!parsed || typeof parsed !== 'object') throw new Error(`文档示例不是 YAML 对象: ${file} -> ${name}`);
      const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-forge-doc-example-'));
      const exampleFile = path.join(temporary, `${name}.yml`);
      try {
        fs.writeFileSync(exampleFile, block[1], { mode: 0o600 });
        parser(exampleFile);
      } finally {
        fs.rmSync(temporary, { recursive: true, force: true });
      }
    }
  }
}

function validateDesktopServiceReadme(root: string): void {
  const readme = path.join(root, 'packages', 'desktop-services', 'README.md');
  const content = fs.readFileSync(readme, 'utf8');
  const marker = '<!-- dsh-forge-example:desktop-services-consumer -->';
  const start = content.indexOf(marker);
  const example = start < 0 ? null : content.slice(start).match(/```ts\s*\n([\s\S]*?)\n```/);
  if (!example?.[1]) throw new Error('desktop-services README 缺少标记 TypeScript 示例');
  if (!example[1].includes("from '@dsh-forge/desktop-services'"))
    throw new Error('desktop-services README 示例没有使用公开 import');
  if (example[1].includes('desktop-services-local') || example[1].includes('desktop-plugin'))
    throw new Error('desktop-services README 示例引用私有或已删除路径');
  const consumer = path.join(root, 'tests', 'fixtures', 'desktop-services-consumer', 'tsconfig.json');
  const tsc = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');
  const result = spawnSync(process.execPath, [tsc, '-p', consumer, '--noEmit'], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`desktop-services consumer 编译失败: ${(result.stderr || result.stdout).trim()}`);
}

function validateRelativeLinks(files: readonly string[]): void {
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    if (/[ \t]+$/m.test(content)) throw new Error(`文档尾随空格: ${file}`);
    for (const match of content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      const target = match[1];
      if (!target || /^(?:https?:|#|mailto:)/.test(target)) continue;
      const [relative] = target.split('#');
      if (!relative) continue;
      if (!fs.existsSync(path.resolve(path.dirname(file), relative)))
        throw new Error(`Markdown 链接不存在: ${file} -> ${target}`);
    }
  }
}

export interface DocumentationCheckResult {
  readonly files: number;
  readonly pairs: number;
}

export function checkDocumentation(root: string): DocumentationCheckResult {
  const files: string[] = [];
  walkMarkdown(path.join(root, 'docs'), files);
  walkMarkdown(path.join(root, 'openspec'), files);
  for (const file of [
    path.join(root, 'README.md'),
    path.join(root, 'README.zh.md'),
    path.join(root, 'packages', 'desktop-services', 'README.md'),
    path.join(root, 'packages', 'desktop-services-local', 'README.md'),
    path.join(root, 'tools', 'profile-toolchain', 'README.md'),
  ]) {
    if (!fs.existsSync(file)) throw new Error(`缺少受检查文档: ${file}`);
    files.push(file);
  }
  validateRelativeLinks(files);
  // OpenSpec 历史材料可以引用迁移期间的术语；运行时文档契约只约束仓库入口和公开文档。
  validateDocumentContracts(root, files.filter((file) => !file.includes(`${path.sep}openspec${path.sep}`)));
  validateDesktopServiceReadme(root);
  const pairing = checkBilingualDocumentation(root);
  return Object.freeze({ files: files.length, pairs: pairing.pairs });
}
