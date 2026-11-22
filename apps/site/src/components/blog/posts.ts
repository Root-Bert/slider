import { getCollection, type CollectionEntry } from 'astro:content';
import { LANGS, localPage, type Lang } from '~/i18n';
import { person } from '~/lib/people';

export type Post = CollectionEntry<'blog'>;
export type PostAccent = Post['data']['accent'];

/** The founder as an app author: articles and pricing notes are signed by him. */
export const FOUNDER = person('Robert');

/** CSS colour per post accent: the app's reviewer accents, PowerPoint orange, green. */
export const ACCENT_CSS: Record<PostAccent, string> = {
  powerpoint: 'var(--color-powerpoint)',
  cyan: 'var(--color-accent-cyan)',
  green: 'var(--color-accent-green)',
  violet: 'var(--color-accent-violet)',
  yellow: 'var(--color-accent-yellow)',
  blue: 'var(--color-accent-blue)',
};

/**
 * A post's language and slug. English posts lie right in `content/blog`, the other languages in a
 * folder of their code with the same file name (`de/slider-1-0.md`).
 */
export function postLang(post: Post): Lang {
  const head = post.id.split('/')[0] as Lang;
  return post.id.includes('/') && LANGS.includes(head) ? head : 'en';
}
export const postSlug = (post: Post): string => post.id.split('/').pop()!;
/** A post's address in a language: `/slider/de/blog/slider-1-0`. */
export const postPage = (post: Post, lang: Lang): string =>
  localPage(lang, `blog/${postSlug(post)}`);

/**
 * Published posts in a language, always newest first (drafts are left out). A post that is not
 * translated yet shows in English.
 */
export async function publishedPosts(lang: Lang = 'en'): Promise<Post[]> {
  const all = await getCollection('blog', ({ data }) => !data.draft);
  const own = new Map(
    all.filter((post) => postLang(post) === lang).map((post) => [postSlug(post), post]),
  );
  return all
    .filter((post) => postLang(post) === 'en')
    .map((post) => own.get(postSlug(post)) ?? post)
    .sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
}

/** The paths of a language's article pages (`getStaticPaths`). */
export async function postPaths(lang: Lang) {
  const posts = await publishedPosts(lang);
  return posts.map((post) => ({ params: { slug: postSlug(post) }, props: { post, posts } }));
}

const LOCALE: Record<Lang, string> = { en: 'en-US', de: 'de-DE', fr: 'fr-FR' };

/** "Oct 14, 2026", "14. Okt. 2026", "14 oct. 2026" */
export const formatDate = (date: Date, lang: Lang = 'en'): string =>
  new Intl.DateTimeFormat(LOCALE[lang], { month: 'short', day: 'numeric', year: 'numeric' }).format(
    date,
  );

/** "comparison" – filter key of a tag. */
export const tagKey = (tag: string): string => tag.toLowerCase().replace(/\s+/g, '-');
