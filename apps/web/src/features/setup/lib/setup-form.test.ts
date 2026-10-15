import { SETUP_KEYS, type SetupField, type SetupKey } from '@slider/shared';
import { describe, expect, it } from 'vitest';
import { collectChanges, initialDraft } from './setup-form';

const empty: SetupField = { source: null, value: null, set: false };
const fieldsWith = (overrides: Partial<Record<SetupKey, SetupField>>) =>
  ({
    ...Object.fromEntries(SETUP_KEYS.map((key) => [key, empty])),
    ...overrides,
  }) as Record<SetupKey, SetupField>;

describe('collectChanges', () => {
  it('sends edited values, typed secrets and removals – never environment values', () => {
    const fields = fieldsWith({
      OIDC_LABEL: { source: 'stored', value: 'Firmen-Login', set: true },
      OIDC_CLIENT_SECRET: { source: 'stored', value: null, set: true },
      SIGNUP: { source: 'env', value: 'invite', set: true },
      GOOGLE_CLIENT_ID: { source: 'stored', value: 'g', set: true },
      GOOGLE_CLIENT_SECRET: { source: 'stored', value: null, set: true },
    });
    const draft = initialDraft(fields);
    expect(draft.OIDC_LABEL).toBe('Firmen-Login');
    expect(draft.OIDC_CLIENT_SECRET).toBe('');
    expect(collectChanges(fields, draft, new Set())).toEqual({});

    draft.MS_CLIENT_ID = ' ms-id ';
    draft.MS_CLIENT_SECRET = 'ms-secret';
    draft.SIGNUP = 'open';
    draft.OIDC_LABEL = '';
    expect(
      collectChanges(
        fields,
        draft,
        new Set<SetupKey>(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']),
      ),
    ).toEqual({
      OIDC_LABEL: null,
      MS_CLIENT_ID: 'ms-id',
      MS_CLIENT_SECRET: 'ms-secret',
      GOOGLE_CLIENT_ID: null,
      GOOGLE_CLIENT_SECRET: null,
    });
  });
});
