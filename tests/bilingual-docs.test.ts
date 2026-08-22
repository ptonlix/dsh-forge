import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  checkBilingualDocumentation,
  gitBlobHash,
  renderSidecar,
  writeBilingualSidecars,
} from '@dsh-forge/profile-toolchain/docs';

function fixture(internalBilingual: readonly string[] = []): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-forge-bilingual-'));
  mkdirSync(join(root, 'docs', 'i18n'), { recursive: true });
  writeFileSync(join(root, 'docs', 'i18n', 'public-documents.json'), JSON.stringify({
    public: ['docs/guide.md'],
    internalBilingual,
    excluded: ['docs/internal.md'],
  }));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function writePair(root: string, english = '# Guide\n\nEnglish | [中文](guide.zh.md)\n\n- One\n', chinese = '# 指南\n\n中文 | [English](guide.md)\n\n- 一\n'): void {
  writeFileSync(join(root, 'docs', 'guide.md'), english);
  writeFileSync(join(root, 'docs', 'guide.zh.md'), chinese);
  writeFileSync(join(root, 'docs', 'guide.i18n.yaml'), renderSidecar(
    'docs/guide.md',
    gitBlobHash(Buffer.from(english)),
    'docs/guide.zh.md',
    gitBlobHash(Buffer.from(chinese)),
  ));
}

describe('双语文档门禁', () => {
  it('删除的一次性迁移记录不再存在', () => {
    expect(existsSync(join(process.cwd(), 'docs', 'engineering', 'agent-assets-migration.md'))).toBe(false);
  });

  it('接受完整配对并记录两侧 hash', () => {
    const { root, cleanup } = fixture();
    try {
      writePair(root);
      expect(checkBilingualDocumentation(root)).toMatchObject({ pairs: 1 });
    } finally {
      cleanup();
    }
  });

  it('接受内部双语配对但不将其计入公开发布', () => {
    const { root, cleanup } = fixture(['docs/internal.md']);
    try {
      writePair(root);
      const english = '# Internal\n\nEnglish | [中文](internal.zh.md)\n\n- One\n';
      const chinese = '# 内部\n\n中文 | [English](internal.md)\n\n- 一\n';
      writeFileSync(join(root, 'docs', 'internal.md'), english);
      writeFileSync(join(root, 'docs', 'internal.zh.md'), chinese);
      writeBilingualSidecars(root, ['docs/internal.md']);
      expect(checkBilingualDocumentation(root)).toMatchObject({
        pairs: 1,
        publicFiles: ['docs/guide.md'],
      });
    } finally {
      cleanup();
    }
  });

  it('拒绝缺少中文文件、hash 漂移和结构不一致', () => {
    const { root, cleanup } = fixture();
    try {
      writePair(root);
      rmSync(join(root, 'docs', 'guide.zh.md'));
      expect(() => checkBilingualDocumentation(root)).toThrow(/缺少双语文档文件/);
      writePair(root);
      writeFileSync(join(root, 'docs', 'guide.md'), readFileSync(join(root, 'docs', 'guide.md'), 'utf8').replace('- One', '- Two'));
      expect(() => checkBilingualDocumentation(root)).toThrow(/hash 漂移/);
      writePair(root, '# Guide\n\nEnglish | [中文](guide.zh.md)\n\n- One\n', '# 指南\n\n中文 | [English](guide.md)\n\n```ts\nconst one = 1\n```\n');
      expect(() => checkBilingualDocumentation(root)).toThrow(/结构不一致/);
    } finally {
      cleanup();
    }
  });

  it('拒绝语言链接未本地化和未声明 sidecar', () => {
    const { root, cleanup } = fixture();
    try {
      writePair(root, '# Guide\n\nEnglish | [中文](guide.zh.md)\n\n[Current](guide.md)\n', '# 指南\n\n中文 | [English](guide.md)\n\n[Current](guide.md)\n');
      expect(() => checkBilingualDocumentation(root)).toThrow(/相对链接未本地化/);
      writePair(root);
      writeFileSync(join(root, 'docs', 'internal.i18n.yaml'), 'internal.md: 0000000000000000000000000000000000000000\n');
      expect(() => checkBilingualDocumentation(root)).toThrow(/非公开或未声明/);
    } finally {
      cleanup();
    }
  });
});
