import { describe, expect, it } from 'vitest';
import { noCreateMessage } from './no-create';

describe('noCreateMessage', () => {
  it('names the role: a viewer is no reviewer and cannot comment', () => {
    const message = noCreateMessage({ role: 'viewer', name: 'Nord' });
    expect(message).toBe(
      'Als Betrachter in „Nord“ kannst du Reviews nur ansehen, aber keine anlegen. Bitte einen Admin, dich zum Mitglied zu machen.',
    );
    expect(message).not.toMatch(/Reviewer|kommentieren/);
  });

  it('a reviewer may comment', () => {
    expect(noCreateMessage({ role: 'reviewer', name: 'Nord' })).toBe(
      'Als Reviewer in „Nord“ kannst du Reviews ansehen und kommentieren, aber keine anlegen. Bitte einen Admin, dich zum Mitglied zu machen.',
    );
  });
});
