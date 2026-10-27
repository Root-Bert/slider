/** ODF lengths (`12.3cm`, `4in`, `18pt`, …) in centimetres. */

const CM_PER: Record<string, number> = {
  cm: 1,
  mm: 0.1,
  in: 2.54,
  pt: 2.54 / 72,
  pc: 2.54 / 6,
  px: 2.54 / 96,
};

const LENGTH = /^\s*(-?(?:\d+\.?\d*|\.\d+))\s*(cm|mm|in|pt|pc|px)?\s*$/;

/** `null` when the value is missing or no length. */
export function lengthToCm(value: string | undefined): number | null {
  if (value === undefined) return null;
  const match = LENGTH.exec(value);
  if (!match) return null;
  const number = Number(match[1]);
  const factor = CM_PER[match[2] ?? 'cm'];
  return Number.isFinite(number) && factor !== undefined ? number * factor : null;
}

/** Centimetres as an ODF length, rounded to 1/1000 cm like LibreOffice writes them. */
export const cm = (value: number): string => `${Number(value.toFixed(3))}cm`;
