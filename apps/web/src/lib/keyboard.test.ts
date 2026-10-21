import { describe, expect, it } from 'vitest';
import { isModEnter, isModKey, typesCharacter } from './keyboard';

const keys = (
  overrides: Partial<{ key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean }> = {},
) => ({
  key: 'Enter',
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  ...overrides,
});

describe('isModKey', () => {
  it('accepts ⌘ or Ctrl', () => {
    expect(isModKey(keys({ metaKey: true }))).toBe(true);
    expect(isModKey(keys({ ctrlKey: true }))).toBe(true);
    expect(isModKey(keys())).toBe(false);
  });
});

describe('isModEnter', () => {
  it('needs Enter plus ⌘/Ctrl', () => {
    expect(isModEnter(keys({ metaKey: true }))).toBe(true);
    expect(isModEnter(keys({ ctrlKey: true }))).toBe(true);
    expect(isModEnter(keys())).toBe(false);
    expect(isModEnter(keys({ key: 'a', metaKey: true }))).toBe(false);
  });
});

describe('typesCharacter', () => {
  it('counts ⌥ and AltGr characters, not shortcuts', () => {
    expect(typesCharacter(keys({ key: 'a' }))).toBe(true);
    // "@" on a German keyboard: ⌥L on a Mac, AltGr+Q (Ctrl+Alt) on Windows.
    expect(typesCharacter(keys({ key: '@', altKey: true }))).toBe(true);
    expect(typesCharacter(keys({ key: '@', ctrlKey: true, altKey: true }))).toBe(true);
    expect(typesCharacter(keys({ key: 'c', metaKey: true }))).toBe(false);
    expect(typesCharacter(keys({ key: 'c', ctrlKey: true }))).toBe(false);
    expect(typesCharacter(keys({ key: 'Enter' }))).toBe(false);
  });
});
