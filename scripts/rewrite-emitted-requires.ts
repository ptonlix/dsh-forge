/** 构建后兼容步骤：将编译产物中的相对 `.ts` require 改写为 `.js`，不修改源码。 */
import * as fs from 'node:fs';
import * as path from 'node:path';

function rewriteDirectory(directory: string): void {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) rewriteDirectory(target);
    else if (entry.isFile() && target.endsWith('.js')) {
      const source = fs.readFileSync(target, 'utf8');
      const rewritten = source.replace(/(require\(['"][^'"]+)\.ts(['"]\))/g, '$1.js$2');
      if (rewritten !== source) fs.writeFileSync(target, rewritten);
    }
  }
}

const outputDirectory = path.resolve(__dirname, '..', 'dist');
if (!fs.existsSync(outputDirectory)) throw new Error(`未找到 TypeScript 编译目录: ${outputDirectory}`);
rewriteDirectory(outputDirectory);
