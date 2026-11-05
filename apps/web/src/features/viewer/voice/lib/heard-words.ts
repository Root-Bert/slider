/**
 * Words heard live put after what a field holds. `lastTaken`: the field's text right after the
 * words before were put in – unchanged since, the new ones go on exactly where those stopped (the
 * live stream hands over parts of words); else (typed meanwhile, the first words) they go after
 * it with one space between, none in front of the first.
 */
export function joinHeard(now: string, words: string, lastTaken: string | null = null): string {
  if (lastTaken !== null && now === lastTaken) return now + words;
  if (!now.trim()) return words.trimStart();
  return /\s$/.test(now) || /^\s/.test(words) ? now + words : `${now} ${words}`;
}
