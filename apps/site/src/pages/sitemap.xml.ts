import type { APIRoute } from 'astro';
import { publishedPosts } from '~/components/blog/posts';
import { page } from '~/lib/links';

/** Every page of the site for search engines (no extra dependency, like the RSS feed). */
const PAGES = ['', 'product', 'vision', 'pricing', 'blog', 'kontakt', 'impressum', 'datenschutz'];

export const GET: APIRoute = async ({ site }) => {
  const posts = await publishedPosts();
  const url = (path: string) => new URL(page(path), site).href;
  const entries = [
    ...PAGES.map((path) => `  <url><loc>${url(path)}</loc></url>`),
    ...posts.map(
      (post) =>
        `  <url><loc>${url(`blog/${post.id}`)}</loc><lastmod>${(post.data.updated ?? post.data.date).toISOString().slice(0, 10)}</lastmod></url>`,
    ),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join('\n')}
</urlset>
`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
