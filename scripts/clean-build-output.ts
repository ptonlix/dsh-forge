import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * 清理单个 workspace 的构建输出，避免迁移前的旧目录残留到新产物。
 *
 * 脚本只接受名为 dist 的目录，并拒绝仓库外路径；它不参与生产运行时。
 */
function main(): void {
  const requested = process.argv[2];
  if (!requested) throw new Error('缺少构建输出目录');
  const target = path.resolve(process.cwd(), requested);
  if (path.basename(target) !== 'dist') throw new Error(`只允许清理 dist 目录: ${target}`);
  const repositoryRoot = path.resolve(__dirname, '..');
  const relative = path.relative(repositoryRoot, target);
  if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
    throw new Error(`构建输出目录必须位于仓库内: ${target}`);
  fs.rmSync(target, { recursive: true, force: true });
}

main();
