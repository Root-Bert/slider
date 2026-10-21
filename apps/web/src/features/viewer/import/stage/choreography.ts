/**
 * How the import stage moves (styles in index.css, `[data-import-anim]`): each import picks one
 * at random – like the logo's animations, never the same twice in a row. A choreography covers
 * how the placeholders arrive on the track, how the slide being rendered keeps building itself
 * while it waits, and how a slide prints once rendered. The timing is the same for all of them
 * (deal stagger, tour, outro), so the stage always settles into the viewer the same way.
 */
export const IMPORT_CHOREOGRAPHIES = [
  /** Tossed onto the table like playing cards; the content is written in, line by line. */
  'deal',
  /** The slides drop onto the track and bounce; the content tumbles in from above. */
  'drop',
  /** The slides turn over like cards; the content flips in like a departures board. */
  'flip',
  /** The slides surface from the depth below the track; the content rises in a wave. */
  'rise',
  /** The slides pop up like bubbles and wobble; the content pops in piece by piece. */
  'pop',
  /** The slides swing down on a hinge at the top; the content dangles into place. */
  'swing',
] as const;
export type ImportChoreography = (typeof IMPORT_CHOREOGRAPHIES)[number];

const LAST_KEY = 'slider.importChoreography';

/** A random choreography, never the one the last import played (remembered for the tab). */
export function pickChoreography(random: () => number = Math.random): ImportChoreography {
  let last: string | null = null;
  try {
    last = sessionStorage.getItem(LAST_KEY);
  } catch {
    // Storage blocked: any choreography will do.
  }
  const options = IMPORT_CHOREOGRAPHIES.filter((name) => name !== last);
  const pick = options[Math.min(options.length - 1, Math.floor(random() * options.length))]!;
  try {
    sessionStorage.setItem(LAST_KEY, pick);
  } catch {
    // Not remembered: the next import may repeat it.
  }
  return pick;
}
