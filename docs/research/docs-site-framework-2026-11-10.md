# Docs site framework choice

Investigated on November 10, 2026 for a documentation site alongside the existing static marketing homepage. This is an implementation recommendation, not a benchmark.

## Recommendation

Use Docusaurus, with the existing `docs/` directory as the source of truth. Its docs plugin can read a directory outside the website package, select public guides, and organize them through an explicit sidebar. Relative Markdown file links resolve to the corresponding published routes. That fits this repository without moving every guide or keeping a second editable copy. [Docs plugin configuration](https://docusaurus.io/docs/api/plugins/@docusaurus/plugin-content-docs), [Markdown links](https://docusaurus.io/docs/markdown-features/links).

Docusaurus also respects the user's suggested framework. Starlight is a credible alternative, especially for a new documentation collection, but its built-in search does not outweigh Docusaurus's direct fit with the current content.

## Comparison

| Requirement             | Docusaurus                                                                                   | Astro Starlight                                                                                                                          |
| ----------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Existing repo Markdown  | The docs plugin accepts a relative content directory, include patterns, and exclusions.      | The standard loader reads `src/content/docs/`; custom loaders can adapt another directory. Every page needs a title in its content data. |
| Search without accounts | Requires a community local-search integration.                                               | Includes Pagefind full-text search by default.                                                                                           |
| Branding                | Custom CSS and theme configuration can adapt the reading layout.                             | `customCss` and documented CSS variables can adapt the reading layout.                                                                   |
| GitHub Pages            | Emits static files and supports a configured base path.                                      | Emits static files and supports `site` and `base` configuration.                                                                         |
| Link checks             | Production builds check links; anchor and Markdown-link failures can be configured to throw. | Treat link checking as a separate implementation decision rather than assuming the default build catches every reference.                |

Sources: [Docusaurus docs plugin](https://docusaurus.io/docs/api/plugins/@docusaurus/plugin-content-docs), [Docusaurus search options](https://docusaurus.io/docs/search), [Docusaurus configuration](https://docusaurus.io/docs/api/docusaurus-config), [Starlight loader source](https://github.com/withastro/starlight/blob/main/packages/starlight/src/loaders.ts), [Starlight frontmatter](https://starlight.astro.build/reference/frontmatter/), [Starlight search](https://starlight.astro.build/guides/site-search/), [Starlight CSS](https://starlight.astro.build/guides/css-and-tailwind/), [Astro GitHub Pages deployment](https://docs.astro.build/en/guides/deploy/github/).

## Integration decisions

- Keep the marketing homepage at `/interlock/` and mount the documentation at `/interlock/docs/`. Configure Docusaurus with `url: 'https://dgca.github.io'`, `baseUrl: '/interlock/docs/'`, and the docs plugin's `routeBasePath: '/'`. Combine the two static outputs in one Pages artifact. Docusaurus emits static files; its deployment command is unnecessary for the existing Actions deployment. [Deployment](https://docusaurus.io/docs/deployment).
- Use `markdown.format: 'md'` for the existing plain Markdown. The default parser is MDX, which gives braces and angle brackets different meanings. Use `'detect'` instead if future `.mdx` pages need React components. [Markdown configuration](https://docusaurus.io/docs/api/docusaurus-config#markdown).
- Set `onBrokenLinks: 'throw'`, `onBrokenAnchors: 'throw'`, and `markdown.hooks.onBrokenMarkdownLinks: 'throw'`. The old top-level Markdown-link setting is deprecated. Run a production build for these checks. [Link and anchor configuration](https://docusaurus.io/docs/api/docusaurus-config#onBrokenLinks).
- Use `@easyops-cn/docusaurus-search-local` as a theme, with `docsRouteBasePath: '/'`, `docsDir` pointing to the actual content directory, `indexBlog: false`, and `hashed: 'filename'`. Search is generated from the build and does not need a hosted search account. Validate the built site, including a result that opens a section anchor. [Maintainer documentation](https://github.com/easyops-cn/docusaurus-search-local).
- Keep links between published guides as relative `.md` paths. Resolve links to excluded research, proposals, source code, and workflow JSON deliberately, usually to GitHub. The docs plugin can only rewrite links to documents it includes. [Markdown links](https://docusaurus.io/docs/markdown-features/links).
- Extend the current Interlock Grid typography and colors. Keep a readable article width, a persistent task-based sidebar, a page table of contents, and mobile navigation. Avoid a second marketing hero inside the docs.
- Expand the Pages workflow's change filters to include public documentation and its build configuration. Its current `site/**` filter would miss content-only documentation updates. This is a repository observation from `.github/workflows/pages.yml`.

## Version check

The npm registry reports Docusaurus `3.10.2` with Node `>=20` and React 18 or 19 support, and the local-search theme `0.55.3` with Docusaurus theme-common 2 or 3 and React 19 support. These satisfy the repository's Node 24 and React 19 baseline. Reproduce with `npm view @docusaurus/core version engines peerDependencies --json` and `npm view @easyops-cn/docusaurus-search-local version engines peerDependencies --json`. These are compatibility declarations, not a substitute for the site build and browser checks.
