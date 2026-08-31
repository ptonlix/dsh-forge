export type DocsLocale = 'root' | 'en';

export const canonicalRepositoryUrl = 'https://github.com/ptonlix/dsh-forge';
export const canonicalRepositoryBranch = 'main';

export interface DocsPage {
  readonly locale: DocsLocale;
  readonly contentLocale: 'zh-CN' | 'en-US';
  readonly source: string;
  readonly route: string;
  readonly label: string;
  readonly section: string;
  readonly order: number;
}

interface PairedPage {
  readonly source: string;
  readonly route: string;
  readonly label: { readonly root: string; readonly en: string };
  readonly section: { readonly root: string; readonly en: string };
  readonly order: number;
}

function paired(page: PairedPage): readonly DocsPage[] {
  return [
    {
      locale: 'root',
      contentLocale: 'zh-CN',
      source: page.source.replace(/\.md$/, '.zh.md'),
      route: page.route,
      label: page.label.root,
      section: page.section.root,
      order: page.order,
    },
    {
      locale: 'en',
      contentLocale: 'en-US',
      source: page.source,
      route: `en/${page.route}`,
      label: page.label.en,
      section: page.section.en,
      order: page.order,
    },
  ];
}

export const docsPages: readonly DocsPage[] = [
  ...paired({ source: 'README.md', route: 'index.md', label: { root: '首页', en: 'Home' }, section: { root: '入口', en: 'Start' }, order: 0 }),
  ...paired({ source: 'docs/README.md', route: 'docs/index.md', label: { root: '文档地图', en: 'Documentation map' }, section: { root: '入口', en: 'Start' }, order: 1 }),
  ...paired({ source: 'docs/design/dsh-forge.md', route: 'design/dsh-forge.md', label: { root: '发行版架构', en: 'Distribution architecture' }, section: { root: '设计', en: 'Design' }, order: 0 }),
  ...paired({ source: 'docs/reference/foundation-contracts.md', route: 'reference/foundation-contracts.md', label: { root: '基础契约', en: 'Foundation contracts' }, section: { root: '参考', en: 'Reference' }, order: 0 }),
  ...paired({ source: 'docs/engineering/foundation-boundaries.md', route: 'engineering/foundation-boundaries.md', label: { root: '工程边界', en: 'Engineering boundaries' }, section: { root: '工程', en: 'Engineering' }, order: 0 }),
  ...paired({ source: 'packages/desktop-services/README.md', route: 'packages/desktop-services.md', label: { root: '公开桌面服务', en: 'Public desktop services' }, section: { root: '包参考', en: 'Package reference' }, order: 0 }),
  ...paired({ source: 'tools/profile-toolchain/README.md', route: 'tools/profile-toolchain.md', label: { root: 'Profile 工具链', en: 'Profile toolchain' }, section: { root: '工具参考', en: 'Tooling reference' }, order: 0 }),
].map((page) => Object.freeze(page));

export function validatePublicationManifest(pages: readonly DocsPage[]): void {
  const routes = new Set<string>();
  const sources = new Set<string>();
  for (const page of pages) {
    if (!page.route.endsWith('.md')) throw new Error(`发布路由必须使用 .md: ${page.route}`);
    if (page.locale === 'root' && page.route.startsWith('en/')) throw new Error(`中文路由不得使用 /en/: ${page.route}`);
    if (page.locale === 'en' && !page.route.startsWith('en/')) throw new Error(`英文路由必须使用 /en/: ${page.route}`);
    const routeKey = `${page.locale}:${page.route}`;
    if (routes.has(routeKey)) throw new Error(`发布清单重复路由: ${routeKey}`);
    routes.add(routeKey);
    if (sources.has(page.source)) throw new Error(`发布清单重复源文件: ${page.source}`);
    sources.add(page.source);
  }
  for (const page of pages) {
    const counterpart = page.source.endsWith('.zh.md') ? page.source.replace(/\.zh\.md$/, '.md') : page.source.replace(/\.md$/, '.zh.md');
    if (!sources.has(counterpart)) throw new Error(`发布页面缺少双语对侧: ${page.source}`);
  }
}

validatePublicationManifest(docsPages);

export const publishedSources = new Map(docsPages.map((page) => [page.source, page]));
export const routeSet = new Set(docsPages.map((page) => `${page.route.slice(0, -'.md'.length)}/`));

export function counterpartSource(source: string): string {
  return source.endsWith('.zh.md') ? source.replace(/\.zh\.md$/, '.md') : source.replace(/\.md$/, '.zh.md');
}

export function routeForSource(source: string, locale: DocsLocale): string | undefined {
  const page = publishedSources.get(source);
  if (page === undefined) return undefined;
  if (page.locale === locale) return page.route;
  return publishedSources.get(counterpartSource(source))?.route;
}

export function sections(locale: DocsLocale): readonly { readonly label: string; readonly items: readonly { readonly link: string; readonly label: string }[] }[] {
  const groups = new Map<string, DocsPage[]>();
  for (const page of docsPages.filter((item) => item.locale === locale)) {
    const pages = groups.get(page.section) ?? [];
    pages.push(page);
    groups.set(page.section, pages);
  }
  return [...groups].map(([label, pages]) => ({
    label,
    items: pages.sort((a, b) => a.order - b.order).map((page) => {
      const clean = page.route.replace(/\.md$/, '');
      const link = clean === 'index'
        ? '/'
        : clean.endsWith('/index') ? `/${clean.slice(0, -'/index'.length)}/` : `/${clean}`;
      return { link, label: page.label };
    }),
  }));
}
