/**
 * The AI runs on two models of the same key: one for everything it does in a deck (`review`), a
 * stronger one to create a deck (`create`). Other kinds have one model, just „Modell“.
 */
export const AI_MODEL_ROLES = {
  review: {
    label: 'Review, Kommentar, Anpassung',
    hint: 'Prüft Folien, antwortet in Kommentaren und ändert, worum ihr bittet.',
  },
  create: {
    label: 'Präsentation erstellen',
    hint: 'Baut ganze Präsentationen aus eurem Material. Am besten das stärkste Modell.',
  },
} as const;

export type AiModelRole = keyof typeof AI_MODEL_ROLES;

/**
 * The choices for the model decks are created on: first the one it falls back to (`standard`
 * as shown, `fallback` its id – not offered twice), then what the service offers – and the
 * current one until the service answered.
 */
export function createModelOptions(
  offered: readonly { id: string; name: string }[],
  standard: string,
  fallback: string,
  current: string | null,
): { value: string; label: string }[] {
  const options = [
    { value: '', label: standard },
    ...offered
      .filter((model) => model.id !== fallback)
      .map((model) => ({ value: model.id, label: model.name })),
  ];
  if (current && !offered.some((model) => model.id === current)) {
    options.push({ value: current, label: current });
  }
  return options;
}
