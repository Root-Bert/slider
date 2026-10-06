import type { Author } from '@slider/shared';

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/** "Lena ist im Review", "Lena und Max sind im Review", "Lena, Max und 2 weitere sind im Review". */
export function participantsSentence(people: readonly Pick<Author, 'name'>[]): string | null {
  const names = people.map((person) => firstName(person.name));
  const [first, second, third] = names;
  if (first === undefined) return null;
  if (second === undefined) return `${first} ist im Review`;
  if (names.length === 2) return `${first} und ${second} sind im Review`;
  if (names.length === 3) return `${first}, ${second} und ${third} sind im Review`;
  return `${first}, ${second} und ${names.length - 2} weitere sind im Review`;
}

export { firstName };
