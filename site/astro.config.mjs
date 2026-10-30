import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// Entirely docs. Monochrome page, one red accent taken from the logo label.
// The site is served from a subdirectory of the user page, so `base` is
// '/entirely'. Content links are written with that prefix: Starlight does not
// rewrite links inside Markdown/MDX. Images are imported through Astro
// (src/assets) and get the base automatically.
//
// Sidebar: each section autogenerates from its directory, so a content author
// adds or renames a page by editing files only. Order inside a section comes
// from the optional `sidebar.order` frontmatter field, then the file name.
export default defineConfig({
  site: 'https://greysquirr3l.github.io',
  base: '/entirely',
  integrations: [
    starlight({
      title: 'Entirely',
      description:
        'An unofficial Visual Studio Code extension that shows Entire sessions, checkpoints and trails inside the editor.',
      logo: { src: './src/assets/logo.png', alt: 'Entirely' },
      favicon: '/favicon.png',
      customCss: ['./src/styles/custom.css'],
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/greysquirr3l/entirely-vscode' },
      ],
      sidebar: [
        { label: 'Getting started', items: [{ autogenerate: { directory: 'getting-started' } }] },
        { label: 'Guides', items: [{ autogenerate: { directory: 'guides' } }] },
        { label: 'Reference', items: [{ autogenerate: { directory: 'reference' } }] },
        { label: 'Concepts', items: [{ autogenerate: { directory: 'concepts' } }] },
        { label: 'Contributing', items: [{ autogenerate: { directory: 'contributing' } }] },
      ],
    }),
  ],
});
