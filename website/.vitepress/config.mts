import { defineConfig } from 'vitepress';
import { resolve } from 'node:path';
import { sections } from '../docs.ts';

const base = process.env.DOCS_BASE ?? '/';
if (!base.startsWith('/') || !base.endsWith('/')) throw new Error('DOCS_BASE 必须以 / 开始并以 / 结束');

function nav(locale: 'root' | 'en') {
  return sections(locale).map((section) => ({
    text: section.label,
    items: section.items.map((item) => ({ text: item.label, link: item.link })),
  }));
}

export default defineConfig({
  title: 'DSH Forge',
  description: 'Auditable desktop distributions around DeepSeek Harness',
  lang: 'zh-CN',
  locales: {
    root: { label: '中文', lang: 'zh-CN', link: '/' },
    en: { label: 'English', lang: 'en-US', link: '/en/' },
  },
  base,
  outDir: resolve(__dirname, '..', '.dist'),
  srcDir: resolve(__dirname, '..', '.generated'),
  cleanUrls: true,
  markdown: { theme: 'github-dark' },
  themeConfig: {
    search: {
      provider: 'local',
      options: {
        locales: {
          root: {
            translations: {
              button: { buttonText: '搜索文档', buttonAriaLabel: '搜索文档' },
              modal: {
                displayDetails: '显示详细列表',
                resetButtonTitle: '重置搜索',
                backButtonTitle: '关闭搜索',
                noResultsText: '没有找到',
                footer: {
                  selectText: '选择',
                  selectKeyAriaLabel: '回车',
                  navigateText: '导航',
                  navigateUpKeyAriaLabel: '向上箭头',
                  navigateDownKeyAriaLabel: '向下箭头',
                  closeText: '关闭',
                  closeKeyAriaLabel: 'Escape',
                },
              },
            },
          },
          en: {
            translations: {
              button: { buttonText: 'Search docs', buttonAriaLabel: 'Search docs' },
            },
          },
        },
      },
    },
    langMenuLabel: '切换语言',
    i18nRouting: true,
    sidebar: {
      '/': nav('root'),
      '/en/': nav('en'),
    },
    socialLinks: [{ icon: 'github', link: 'https://github.com/deepseek-ai/dsh-forge' }],
  },
});
