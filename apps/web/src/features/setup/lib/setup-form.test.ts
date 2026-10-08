import { SETUP_KEYS, type SetupField, type SetupKey } from '@slider/shared';
import { describe, expect, it } from 'vitest';
import { collectChanges, initialDraft, smtpUrl } from './setup-form';

const empty: SetupField = { source: null, value: null, set: false };
const fieldsWith = (overrides: Partial<Record<SetupKey, SetupField>>) =>
  ({
    ...Object.fromEntries(SETUP_KEYS.map((key) => [key, empty])),
    ...overrides,
  }) as Record<SetupKey, SetupField>;

describe('smtpUrl', () => {
  it('builds smtps:// for port 465 and smtp:// (STARTTLS) otherwise, URL-encoding the login', () => {
    expect(
      smtpUrl({ host: 'smtp.resend.com', port: '465', user: 'resend', password: 're_a/b@c' }),
    ).toBe('smtps://resend:re_a%2Fb%40c@smtp.resend.com:465');
    expect(
      smtpUrl({ host: 'mail.firma.de', port: '587', user: 'slider@firma.de', password: 'x' }),
    ).toBe('smtp://slider%40firma.de:x@mail.firma.de:587');
    expect(smtpUrl({ host: 'relay.intern', port: '', user: '', password: '' })).toBe(
      'smtps://relay.intern:465',
    );
    expect(smtpUrl({ host: '  ', port: '465', user: 'a', password: 'b' })).toBe('');
  });
});

describe('collectChanges', () => {
  it('sends edited values, typed secrets and removals – never environment values', () => {
    const fields = fieldsWith({
      MAIL_FROM: { source: 'stored', value: 'Slider <a@b.de>', set: true },
      SMTP_URL: { source: 'stored', value: null, set: true },
      SIGNUP: { source: 'env', value: 'invite', set: true },
      GOOGLE_CLIENT_ID: { source: 'stored', value: 'g', set: true },
      GOOGLE_CLIENT_SECRET: { source: 'stored', value: null, set: true },
    });
    const draft = initialDraft(fields);
    expect(draft.MAIL_FROM).toBe('Slider <a@b.de>');
    expect(draft.SMTP_URL).toBe('');
    expect(collectChanges(fields, draft, new Set())).toEqual({});

    draft.MS_CLIENT_ID = ' ms-id ';
    draft.MS_CLIENT_SECRET = 'ms-secret';
    draft.SIGNUP = 'open';
    draft.MAIL_FROM = '';
    expect(
      collectChanges(
        fields,
        draft,
        new Set<SetupKey>(['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']),
      ),
    ).toEqual({
      MAIL_FROM: null,
      MS_CLIENT_ID: 'ms-id',
      MS_CLIENT_SECRET: 'ms-secret',
      GOOGLE_CLIENT_ID: null,
      GOOGLE_CLIENT_SECRET: null,
    });
  });
});
