import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkBoundaries } from '../scripts/check-boundaries.ts';

describe('仓库目录边界', () => {
  it('在迁移完成后拒绝旧 src 或跨包源码相对导入', () => {
    const result = checkBoundaries(path.resolve(__dirname, '..'));
    expect(result.valid, result.failures.join('\n')).toBe(true);
  });
});
