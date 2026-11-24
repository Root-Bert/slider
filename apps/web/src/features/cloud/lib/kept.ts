/**
 * What „In Cloud ablegen …“ / „Als PDF ablegen …“ tells once the file is there: where, and
 * whether it is new or the next version of one of its name there.
 */
export const keptText = (name: string, place: string, created: boolean) =>
  created
    ? `„${name}“ in „${place}“ abgelegt`
    : `„${name}“ in „${place}“ als neue Fassung abgelegt`;
