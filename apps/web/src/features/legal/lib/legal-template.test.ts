import { describe, expect, it } from 'vitest';
import privacyTemplate from '../templates/datenschutz.md?raw';
import imprintTemplate from '../templates/impressum.md?raw';
import {
  fillGap,
  fillTemplate,
  findGaps,
  TEMPLATE_FIELDS,
  TEMPLATE_OPTIONS,
  templateDefaults,
  type TemplateOptions,
  type TemplateValues,
} from './legal-template';

const allOptions = (on: boolean) =>
  Object.fromEntries(TEMPLATE_OPTIONS.map((option) => [option.key, on])) as TemplateOptions;
const allValues = Object.fromEntries(
  TEMPLATE_FIELDS.map((field) => [field.key, `<${field.key}>`]),
) as TemplateValues;

describe('legal templates', () => {
  it('leave neither markers nor gaps once every field is filled', () => {
    for (const on of [true, false]) {
      for (const template of [privacyTemplate, imprintTemplate]) {
        const text = fillTemplate(template, allValues, allOptions(on));
        expect(text).not.toMatch(/\{\{|\}\}/);
        expect(findGaps(text)).toEqual([]);
      }
    }
  });

  it('drop what the instance does not use', () => {
    const off = fillTemplate(privacyTemplate, allValues, allOptions(false));
    for (const word of [
      'Unsplash',
      'Stripe',
      'Cloudflare',
      'Microsoft',
      'Nextcloud',
      '/datenanfrage',
      '18 Monate',
    ]) {
      expect(off).not.toContain(word);
    }
    const on = fillTemplate(privacyTemplate, allValues, allOptions(true));
    for (const word of [
      'Unsplash',
      'Stripe',
      'Cloudflare',
      'Microsoft',
      'Nextcloud',
      '/datenanfrage',
      '18 Monate',
    ]) {
      expect(on).toContain(word);
    }
  });

  it('keep the login methods one list', () => {
    const text = fillTemplate(privacyTemplate, allValues, allOptions(true));
    expect(text).toContain('- Microsoft-Konto (Microsoft Ireland Operations Ltd.)\n- Google-Konto');
    expect(text).toContain('Ireland Ltd.)\n- Firmen-Login (SSO) über <oidcProvider>\n');
  });

  it('show an empty field as a gap and take optional parts out', () => {
    const text = fillTemplate(imprintTemplate, {}, {});
    expect(findGaps(text)).toEqual([
      '[Name oder Firma]',
      '[Straße und Hausnummer]',
      '[PLZ und Ort]',
      '[E-Mail-Adresse]',
    ]);
    expect(text).not.toContain('Telefon');
    expect(text).not.toContain('Umsatzsteuer');
    expect(text).toContain('E-Mail: [E-Mail-Adresse]\n\n## Verbraucherstreitbeilegung');
  });

  it('keep the line break after a block kept inline', () => {
    const text = fillTemplate(imprintTemplate, { phone: '0123', vatId: 'DE1' }, {});
    expect(text).toContain(
      'Telefon: 0123\n\n## Umsatzsteuer\n\nUmsatzsteuer-Identifikationsnummer nach § 27a UStG: DE1\n\n## Verbraucher',
    );
  });
});

describe('gaps', () => {
  it('are found once each, never a link', () => {
    expect(findGaps('[A] und [B], wieder [A], [Link](https://x.de)')).toEqual(['[A]', '[B]']);
  });

  it('are filled everywhere, or taken out with their empty line', () => {
    expect(fillGap('E-Mail: [E]\nWieder [E]', '[E]', ' a@b.de ')).toBe(
      'E-Mail: a@b.de\nWieder a@b.de',
    );
    expect(fillGap('Eins\n\n[Hinweis]\n\nZwei', '[Hinweis]', '')).toBe('Eins\n\nZwei\n');
  });
});

describe('defaults', () => {
  it('follow the instance', () => {
    const field = (value: string | null) => ({
      source: 'stored' as const,
      value,
      set: value !== null,
    });
    const { options, values } = templateDefaults({
      url: 'https://slider.example',
      restart: 'automatic',
      redirectUris: { microsoft: '', google: '', oidc: '', nextcloud: '' },
      features: { payments: true, stockPhotos: false },
      fields: {
        MS_CLIENT_ID: field('id'),
        GOOGLE_CLIENT_ID: field(null),
        OIDC_ISSUER: field(null),
        OIDC_LABEL: field(null),
        NEXTCLOUD_URL: field('https://cloud.example.de/'),
        SMTP_URL: field('smtps://a@b'),
        SIGNUP: field('invite'),
        DELETE_UNUSED: field('0'),
      } as never,
    });
    expect(options).toMatchObject({
      microsoft: true,
      google: false,
      nextcloud: true,
      mail: true,
      domains: false,
      deleteUnused: false,
      payments: true,
      stockPhotos: false,
    });
    expect(values.nextcloudOperator).toBe('cloud.example.de');
  });
});
