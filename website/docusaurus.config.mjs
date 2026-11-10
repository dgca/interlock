import { themes } from 'prism-react-renderer';
import sidebars from './sidebars.mjs';

function documentFiles(items) {
  return items.flatMap((item) =>
    item.type === 'category' ? documentFiles(item.items) : [`${item.id}.md`],
  );
}

// Adding a guide to the sidebar opts it into publication and search.
const publishedDocFiles = documentFiles(sidebars.docs);

export default {
  title: 'Interlock docs',
  tagline: 'Build, run, and inspect repeatable workflows for AI agents.',
  url: 'https://dgca.github.io',
  baseUrl: '/interlock/docs/',
  trailingSlash: true,
  favicon: 'img/interlock-logo.svg',
  organizationName: 'dgca',
  projectName: 'interlock',
  onBrokenLinks: 'throw',
  onBrokenAnchors: 'throw',
  markdown: {
    format: 'md',
    hooks: {
      onBrokenMarkdownLinks: 'throw',
    },
  },
  i18n: { defaultLocale: 'en', locales: ['en'] },
  presets: [
    [
      'classic',
      {
        docs: {
          path: '../docs',
          routeBasePath: '/',
          sidebarPath: './sidebars.mjs',
          include: publishedDocFiles,
          editUrl: ({ docPath }) =>
            `https://github.com/dgca/interlock/edit/main/docs/${docPath}`,
          showLastUpdateTime: false,
          showLastUpdateAuthor: false,
        },
        blog: false,
        pages: false,
        theme: { customCss: './src/css/custom.css' },
      },
    ],
  ],
  themes: [
    [
      '@easyops-cn/docusaurus-search-local',
      {
        hashed: 'filename',
        language: ['en'],
        indexDocs: true,
        indexBlog: false,
        indexPages: false,
        docsRouteBasePath: '/',
        docsDir: '../docs',
        highlightSearchTermsOnTargetPage: true,
      },
    ],
  ],
  themeConfig: {
    image: 'https://dgca.github.io/interlock/social-preview.png',
    colorMode: {
      defaultMode: 'dark',
      disableSwitch: true,
      respectPrefersColorScheme: false,
    },
    navbar: {
      title: 'Interlock',
      logo: { alt: '', src: 'img/interlock-logo.svg', width: 32, height: 32 },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docs',
          position: 'left',
          label: 'Docs',
        },
        {
          type: 'html',
          value: '<a class="navbar__link" href="/interlock/">Website</a>',
          position: 'right',
        },
        {
          href: 'https://github.com/dgca/interlock',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    docs: { sidebar: { hideable: false, autoCollapseCategories: true } },
    tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 3 },
    prism: {
      theme: themes.github,
      darkTheme: themes.vsDark,
      additionalLanguages: ['bash', 'json', 'toml', 'diff'],
    },
  },
};
