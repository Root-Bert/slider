import { getCollection, type CollectionEntry } from 'astro:content';
import { person } from '~/lib/people';

export type Post = CollectionEntry<'blog'>;
export type PostAccent = Post['data']['accent'];

/** The founder as an app author: articles and pricing notes are signed by him. */
export const FOUNDER = person('Robert');

/** CSS colour per post accent: the app's reviewer accents, PowerPoint orange, website sage. */
export const ACCENT_CSS: Record<PostAccent, string> = {
  powerpoint: 'var(--color-powerpoint)',
  cyan: 'var(--color-accent-cyan)',
  green: 'var(--color-sage)',
  violet: 'var(--color-accent-violet)',
  yellow: 'var(--color-accent-yellow)',
  blue: 'var(--color-accent-blue)',
};

/** Published posts, newest first (drafts are left out). */
export async function publishedPosts(): Promise<Post[]> {
  const posts = await getCollection('blog', ({ data }) => !data.draft);
  return posts.sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
}

const DATE = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** "Oct 14, 2026" */
export const formatDate = (date: Date): string => DATE.format(date);

/** "comparison" – filter key of a tag. */
export const tagKey = (tag: string): string => tag.toLowerCase().replace(/\s+/g, '-');
