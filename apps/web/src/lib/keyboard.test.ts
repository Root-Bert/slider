import { describe, expect, it } from 'vitest';
import { isModEnter, isModKey } from './keyboard';

const keys = (overrides: Partial<{ key: string; metaKey: boolean; ctrlKey: boolean }> = {}) => ({
  key: 'Enter',
  metaKey: false,
  ctrlKey: false,
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
