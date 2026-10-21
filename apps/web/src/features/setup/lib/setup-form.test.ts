import { SETUP_KEYS, type SetupField, type SetupKey } from '@slider/shared';
import { describe, expect, it } from 'vitest';
import {
  cleanSetupToken,
  collectChanges,
  initialDraft,
  smtpParts,
  smtpUrl,
  sourceOf,
} from './setup-form';

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

describe('cleanSetupToken', () => {
  it('takes the token as pasted from the log line', () => {
    expect(cleanSetupToken('  abc_DEF-123 ')).toBe('abc_DEF-123');
    expect(cleanSetupToken('Setup token: abc_DEF-123')).toBe('abc_DEF-123');
    expect(cleanSetupToken('   ')).toBe('');
  });
});

describe('smtpParts', () => {
  it('reads server, port and user back from a saved URL – the way smtpUrl writes it', () => {
    const parts = { host: 'smtp.firma.de', port: '587', user: 'a@firma.de', password: '' };
    expect(smtpParts(smtpUrl(parts))).toEqual(parts);
    expect(smtpParts('smtps://smtp.firma.de')).toEqual({
      host: 'smtp.firma.de',
      port: '465',
      user: '',
      password: '',
    });
    expect(smtpParts(null).host).toBe('');
    expect(smtpParts('kein url').host).toBe('');
  });
});

describe('sourceOf', () => {
  it('env only when everything set comes from the environment', () => {
    const keys: SetupKey[] = ['MS_CLIENT_ID', 'MS_CLIENT_SECRET', 'MS_TENANT'];
    expect(sourceOf(fieldsWith({}), keys)).toBeNull();
    const env: SetupField = { source: 'env', value: 'x', set: true };
    const stored: SetupField = { source: 'stored', value: 'y', set: true };
    expect(sourceOf(fieldsWith({ MS_CLIENT_ID: env, MS_CLIENT_SECRET: env }), keys)).toBe('env');
    expect(sourceOf(fieldsWith({ MS_CLIENT_ID: env, MS_TENANT: stored }), keys)).toBe('stored');
  });
});
