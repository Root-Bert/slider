import type { APIRoute } from 'astro';
import { publishedPosts } from '~/components/blog/posts';
import { page } from '~/lib/links';

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** RSS feed of the blog (no extra dependency – the feed is a few lines of XML). */
export const GET: APIRoute = async ({ site }) => {
  const posts = await publishedPosts();
  const url = (path: string) => new URL(page(path), site).href;
  const items = posts
    .map(
      (post) => `    <item>
      <title>${escape(post.data.title)}</title>
      <link>${url(`blog/${post.id}`)}</link>
      <guid>${url(`blog/${post.id}`)}</guid>
      <description>${escape(post.data.description)}</description>
      <pubDate>${post.data.date.toUTCString()}</pubDate>
      <category>${escape(post.data.tag)}</category>
    </item>`,
    )
    .join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Slider | Blog</title>
    <link>${url('blog')}</link>
    <description>Comparisons, stories and updates</description>
    <language>en</language>
${items}
  </channel>
</rss>
`;
  return new Response(xml, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } });
};
