import { docsPages, validatePublicationManifest } from '../website/docs.ts';
import { rewriteMarkdown } from '../scripts/project-docs.ts';
import { fragmentExists } from '../scripts/verify-site.ts';

describe('文档站发布清单', () => {
  it('为每个页面提供根语言和 /en/ 路由', () => {
    expect(docsPages).toHaveLength(14);
    expect(docsPages.filter((page) => page.locale === 'root')).toHaveLength(7);
    expect(docsPages.filter((page) => page.locale === 'en' && page.route.startsWith('en/'))).toHaveLength(7);
  });

  it('拒绝重复路由和缺失对侧', () => {
    expect(() => validatePublicationManifest([
      { ...docsPages[0]!, route: 'same.md' },
      { ...docsPages[2]!, route: 'same.md' },
    ])).toThrow(/重复路由/);
    expect(() => validatePublicationManifest([
      { ...docsPages[0]!, source: 'missing.md', route: 'missing.md' },
    ])).toThrow(/缺少双语对侧/);
  });

  it('将公开相对链接投影为站点路由，将内部链接回链到仓库', () => {
    const page = docsPages.find((item) => item.source === 'docs/design/dsh-forge.md');
    expect(page).toBeDefined();
    const projected = rewriteMarkdown(
      '[Reference](../reference/foundation-contracts.md#trust) [Internal](../engineering/foundation-verification.md)',
      page!,
    );
    expect(projected).toContain('(/en/reference/foundation-contracts#trust)');
    expect(projected).toContain('https://github.com/dsh-forge/dsh-forge/blob/master/docs/engineering/foundation-verification.md');
  });

  it('检查 HTML fragment 是否真实存在', () => {
    expect(fragmentExists('<h2 id="trust">Trust</h2>', 'trust')).toBe(true);
    expect(fragmentExists('<h2 id="trust">Trust</h2>', 'missing')).toBe(false);
  });
});
