import type { AccountAuthor, SenderAgent, SenderChannel, SenderHome } from '@slider/shared';
import { byLatest } from './direct';

/** Lower case, accents gone: „Änderung“ is found by „anderung“ too. */
const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * What the side bar's field finds, in the order a click is meant: conversations named so (the
 * latest first), then people one has not written with yet (a click starts it), then groups found
 * only by one of their people – „cleo“ is Cleo first, not the group she is in.
 */
export function searchConversations(
  home: SenderHome | undefined,
  meId: string,
  query: string,
): (SenderChannel | SenderAgent | AccountAuthor)[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!home || words.length === 0) return [];
  const matches = (...texts: string[]) => {
    const all = fold(texts.join(' '));
    return words.every((word) => all.includes(word));
  };
  const channels = [...home.areas.flatMap((area) => area.channels), ...home.groups, ...home.direct];
  const named = byLatest<SenderChannel | SenderAgent>([
    ...channels.filter((channel) => matches(channel.name)),
    ...home.agents.filter((agent) => matches(agent.title)),
  ]);
  const byPeople = byLatest(
    channels.filter(
      (channel) =>
        !matches(channel.name) &&
        matches(...channel.members.filter((each) => each.id !== meId).map((each) => each.name)),
    ),
  );
  const talkedTo = new Set(
    home.direct.flatMap((channel) => (channel.person ? [channel.person.id] : [])),
  );
  const people = home.people
    .filter((person) => person.id !== meId && !talkedTo.has(person.id) && matches(person.name))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
  return [...named, ...people, ...byPeople];
}
