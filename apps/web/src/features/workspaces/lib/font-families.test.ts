import { describe, expect, it } from 'vitest';
import type { WorkspaceFont } from '@slider/shared';
import { faceLabel, groupFamilies, sliderFamilies } from './font-families';

const face = (
  family: string,
  weight: 400 | 700,
  italic: boolean,
  sizeBytes = 100,
  sourceFile: string | null = null,
): WorkspaceFont => ({
  id: `${family}-${weight}-${italic}`,
  family,
  weight,
  italic,
  url: '',
  upm: 1000,
  ascent: 800,
  descent: 200,
  sizeBytes,
  sourceFile,
});

describe('groupFamilies', () => {
  it('groups faces by family, in the usual order, and adds up their size', () => {
    const [inter, lora] = groupFamilies([
      face('Inter', 700, true),
      face('Lora', 400, false, 50),
      face('Inter', 400, false),
      face('Inter', 700, false),
    ]);
    expect(inter?.faces.map(faceLabel)).toEqual(['Normal', 'Fett', 'Fett kursiv']);
    expect(inter?.sizeBytes).toBe(300);
    expect(lora).toMatchObject({ family: 'Lora', sizeBytes: 50 });
  });

  it('names the review a family was taken from', () => {
    const [oswald, inter] = groupFamilies([
      face('Oswald', 400, false, 100, 'Quartalsbericht'),
      face('Inter', 400, false),
    ]);
    expect(oswald?.takenFrom).toBe('Quartalsbericht');
    expect(inter?.takenFrom).toBeNull();
  });
});

describe('sliderFamilies', () => {
  const families = sliderFamilies();

  it("lists Slider's fonts with the Office fonts they stand in for, not the symbol font", () => {
    expect(families.find((family) => family.family === 'Carlito')).toMatchObject({
      source: 'slider',
      css: '"Slider Carlito"',
      sizeBytes: null,
      standsIn: ['Calibri', 'Calibri Light'],
    });
    expect(families.some((family) => family.family === 'OpenSymbol')).toBe(false);
  });

  it('has only the faces with files of their own', () => {
    const oswald = families.find((family) => family.family === 'Oswald');
    expect(oswald?.faces.map(faceLabel)).toEqual(['Normal', 'Fett']);
  });
});
