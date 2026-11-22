import type { APIRoute } from 'astro';
import { postPage, publishedPosts } from '~/components/blog/posts';
import { LANGS, appPage, localPage } from '~/i18n';
import { APPS } from '~/lib/apps';
import { page } from '~/lib/links';

/** Every page of the site for search engines (no extra dependency, like the RSS feed). */
const PAGES = [
  ...APPS.flatMap((app) => LANGS.map((lang) => appPage(app, lang))),
  ...LANGS.map((lang) => localPage(lang, 'blog')),
  page('kontakt'),
  page('impressum'),
  page('datenschutz'),
  '/me/',
];

export const GET: APIRoute = async ({ site }) => {
  const posts = await publishedPosts();
  const url = (path: string) => new URL(path, site).href;
  const entries = [
    ...PAGES.map((path) => `  <url><loc>${url(path)}</loc></url>`),
    ...LANGS.flatMap((lang) =>
      posts.map(
        (post) =>
          `  <url><loc>${url(postPage(post, lang))}</loc><lastmod>${(post.data.updated ?? post.data.date).toISOString().slice(0, 10)}</lastmod></url>`,
      ),
    ),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join('\n')}
</urlset>
`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
