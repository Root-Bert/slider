import type { AccentColor, Author } from '@slider/shared';

/*
 * The founder and the personas of the product mockups – first names only, one fixed colour across the
 * whole site. Colours are the app's reviewer accents (minus red: the website stays positive), so
 * avatars and cursors look exactly like in Slider.
 */
const PEOPLE = {
  Albert: 'blue',
  Anna: 'violet',
  Benni: 'green',
  Carolin: 'yellow',
  Finnja: 'cyan',
  Gero: 'yellow',
  Gesa: 'violet',
  Ingrid: 'violet',
  Lara: 'blue',
  Marcel: 'cyan',
  Marianne: 'green',
  Marlon: 'blue',
  Neven: 'green',
  Paul: 'cyan',
  Robert: 'violet',
  Rose: 'yellow',
  Thomas: 'blue',
} as const satisfies Record<string, Exclude<AccentColor, 'red'>>;

export type PersonName = keyof typeof PEOPLE;

/** The persona as an app `Author`, for the app's own Avatar and LiveCursor components. */
export function person(name: PersonName): Author {
  return { id: name.toLowerCase(), name, type: 'owner', color: PEOPLE[name] };
}

/** The persona's accent, typed as an accent (not the wider `Author` colour), e.g. for sketch palettes. */
export function personAccent(name: PersonName): AccentColor {
  return PEOPLE[name];
}
