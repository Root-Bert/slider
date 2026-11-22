import type { SenderAgent, SenderChannel, SenderHome } from '@slider/shared';

export const byLatest = <T extends { updatedAt: string }>(list: readonly T[]) =>
  [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

/** People and groups one writes with, the latest first – „Direkt“ of Sender's bar, and Cloud's. */
export const directOf = (home: SenderHome | undefined): SenderChannel[] =>
  byLatest([...(home?.groups ?? []), ...(home?.direct ?? [])]);

/** Every conversation outside the areas – people, groups and agents – the latest first. */
export const chatsOf = (home: SenderHome | undefined): (SenderChannel | SenderAgent)[] =>
  byLatest<SenderChannel | SenderAgent>([...directOf(home), ...(home?.agents ?? [])]);
