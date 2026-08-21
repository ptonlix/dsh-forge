import * as fs from 'node:fs';
import * as path from 'node:path';

/** 目录边界门禁的结构化结果，便于 CLI 和测试复用同一实现。 */
export interface BoundaryCheckResult {
  readonly valid: boolean;
  readonly failures: readonly string[];
}

const SOURCE_ROOTS = Object.freeze(['apps', 'packages', 'tools', 'scripts', 'tests']);
const REQUIRED_ROOTS = Object.freeze([
  'apps/desktop',
  'packages/desktop-services',
  'packages/desktop-services-local',
  'packages/bundles',
  'tools',
]);
const GENERATED_ROOTS = Object.freeze(['dist', 'artifacts', 'node_modules', 'tests/fixtures']);
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);

function walk(directory: string, files: string[] = []): string[] {
  if (!fs.existsSync(directory)) {
    return files;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (GENERATED_ROOTS.includes(entry.name)) {
      continue;
    }

    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(file, files);
    } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(file);
    }
  }

  return files;
}

/** third-party fixture 代表外部 consumer，必须与生产 bundle 一样拒绝私有 provider。 */
function walkFixtureFiles(directory: string, files: string[] = []): string[] {
  if (!fs.existsSync(directory)) return files;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walkFixtureFiles(file, files);
    else if (SOURCE_EXTENSIONS.has(path.extname(entry.name)) || entry.name === 'package.json') files.push(file);
  }
  return files;
}

function packageRoot(file: string, root: string): string | null {
  const relative: string[] = path.relative(root, file).split(path.sep);
  if (relative.length < 2) {
    return null;
  }

  const first = relative[0];
  const second = relative[1];
  if (first && second && (first === 'apps' || first === 'packages' || first === 'tools')) {
    return path.join(first, second);
  }
  return first || null;
}

/** 检查生产代码是否只通过设计目录和公开 package exports 互相依赖。 */
export function checkBoundaries(root: string): BoundaryCheckResult {
  const failures: string[] = [];
  for (const required of REQUIRED_ROOTS) {
    if (!fs.existsSync(path.join(root, required))) {
      failures.push(`缺少设计目录: ${required}`);
    }
  }

  if (fs.existsSync(path.join(root, 'src'))) {
    failures.push('禁止保留根级生产目录: src');
  }

  for (const file of walkFixtureFiles(path.join(root, 'tests', 'fixtures'))) {
    if (fs.readFileSync(file, 'utf8').includes('@dsh-forge/desktop-services-local'))
      failures.push(`${path.relative(root, file)} 第三方 fixture 不得导入私有 desktop-services-local`);
  }

  for (const file of SOURCE_ROOTS.flatMap((directory) => walk(path.join(root, directory)))) {
    const content = fs.readFileSync(file, 'utf8');
    const owner = packageRoot(file, root);
    for (const match of content.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g)) {
      const imported = match[1];
      if (!imported) {
        continue;
      }

      const testLocalProviderSource =
        owner === 'tests' &&
        imported.startsWith('../packages/desktop-services-local/src/');
      if (/(?:^|\/)src(?:\/|$)/.test(imported) && !testLocalProviderSource) {
        failures.push(`${path.relative(root, file)} 依赖旧 src 路径: ${imported}`);
      }

      if (!imported.startsWith('.')) {
        if (imported === '@dsh-forge/desktop-services-local' || imported.startsWith('@dsh-forge/desktop-services-local/')) {
          const allowed =
            owner === 'apps/desktop' && imported === '@dsh-forge/desktop-services-local/launcher'
              ? true
              : owner === 'packages/bundles' && file.includes(`${path.sep}desktop-layer${path.sep}`) && imported === '@dsh-forge/desktop-services-local'
                ? true
                : owner === 'tests' && !file.includes(`${path.sep}tests${path.sep}fixtures${path.sep}`);
          if (!allowed)
            failures.push(`${path.relative(root, file)} 不得导入私有 desktop-services-local 接口: ${imported}`);
        }
        if (imported === '@dsh-forge/desktop-plugin' || imported.startsWith('@dsh-forge/desktop-plugin/'))
          failures.push(`${path.relative(root, file)} 引用已删除 desktop-plugin: ${imported}`);
        continue;
      }

      const resolved = path.resolve(path.dirname(file), imported);
      const targetOwner = packageRoot(resolved, root);
      if (
        owner &&
        targetOwner &&
        owner !== targetOwner &&
        (owner.startsWith('apps/') || owner.startsWith('packages/') || owner.startsWith('tools/'))
      ) {
        failures.push(`${path.relative(root, file)} 跨包相对导入: ${imported}`);
      }

      if (owner?.startsWith('tools/') && imported.includes('/apps/')) {
        failures.push(`${path.relative(root, file)} 工具包反向依赖应用: ${imported}`);
      }
    }
  }
  return Object.freeze({ valid: failures.length === 0, failures: Object.freeze(failures) });
}

if (require.main === module) {
  const result = checkBoundaries(path.resolve(__dirname, '..'));
  if (!result.valid) {
    for (const failure of result.failures) {
      process.stderr.write(`${failure}\n`);
    }

    process.exitCode = 1;
  } else {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
}
