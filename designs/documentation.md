# Documentation site

The documentation is a Read surface. Readers arrive with a task or a specific question. Persistent navigation, local search, and a readable article take precedence over promotional content.

## Visual direction

Extend the marketing site's implemented Interlock Grid style. Use its self-hosted IBM Plex Sans and Mono, the approved blue and orchid logo, solid dark surfaces, and 1px neutral dividers. The article background is `#151515`, navigation is `#1a1a1a`, and code is inset on `#121212`. Blue identifies links and keyboard focus. Keep body copy readable at 17px with a maximum article measure of 72ch.

The layout has a persistent category sidebar, a central article, and a page contents rail on wide screens. Mobile uses the standard accessible Docusaurus navigation drawer and collapsible page contents. Avoid decorative diagrams, repeated subtitles, and promotional hero content. Use headings, spacing, and links to establish hierarchy.

The footer matches the marketing site: logo and Interlock name above the license, repository link, and author credit. Preserve its spacing, typography, and mobile wrapping. The footer logo links to the marketing homepage.

## Content and navigation

Keep public guides short and explain the product at a high level. Get started begins with Installation and Workflows and runs. Agents distinguishes existing MCP sessions from automatic execution, with separate connection guides for MCP and local harnesses. Using Interlock covers building, reuse, automation, run inspection, reports, and testing. Troubleshooting follows, with CLI reference last. Explain concepts without click-by-click editor tutorials. Connection guides and the CLI reference include concrete configuration and command syntax.

Publish only pages listed in the sidebar. Architecture, full protocol references, advanced execution rules, experiments, contributor instructions, and research stay in the repository and out of public search. Add content when a concrete user question justifies it.

Markdown files in `docs/` remain canonical. The site does not maintain separate copies. Use plain Markdown and relative source links so the same files remain readable on GitHub and in installed packages. Edit links point to the original file. Build checks catch broken document links and anchors.

## Implementation

The Docusaurus configuration and curated navigation live in `website/`. Styling is in `website/src/css/custom.css`. Font URLs resolve from the marketing assets at build time. The logo copy is checked against the marketing original.

The marketing page and documentation share one GitHub Pages artifact, with the marketing page at `/interlock/` and documentation at `/interlock/docs/`. Search uses a locally generated index, without an external account. Check desktop and mobile navigation, long code blocks and tables, keyboard focus, search results, direct page URLs, and links back to the marketing page before delivery.
