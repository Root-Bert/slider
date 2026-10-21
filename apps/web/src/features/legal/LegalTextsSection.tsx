import { useId, useState } from 'react';
import type { LegalTexts } from '@slider/shared';
import { useLegalTexts, useSaveLegalTexts } from '@/lib/api';
import { routes } from '@/lib/routes';
import {
  AutosizeTextarea,
  Button,
  ErrorText,
  Section,
  Spinner,
  TextLink,
  type ShowToast,
} from '@/ui';
import privacyTemplate from './templates/datenschutz.md?raw';
import imprintTemplate from './templates/impressum.md?raw';

const FIELDS = [
  { kind: 'imprint', label: 'Impressum', template: imprintTemplate, to: routes.imprint() },
  {
    kind: 'privacy',
    label: 'Datenschutzerklärung',
    template: privacyTemplate,
    to: routes.privacy(),
  },
] as const;

/**
 * Instance admin, on `/einrichtung`: writes imprint and privacy policy (BER-141), shown at
 * `/impressum` and `/datenschutz` and linked under every public page and mail. The templates fit
 * a setup like slider.bertro.dev (Hetzner, Cloudflare, Brevo, Microsoft, Google): fill in the
 * `[…]` and drop what this instance doesn't use.
 */
export function LegalTextsSection({ onNotify }: { onNotify: ShowToast }) {
  const stored = useLegalTexts();
  return (
    <Section
      title="Impressum & Datenschutz"
      description="Erscheinen unter /impressum und /datenschutz und werden auf der Anmeldeseite, in den Einstellungen und unter jeder Mail verlinkt. Die Vorlagen passen zu einer Instanz mit Hetzner, Cloudflare, Brevo, Microsoft- und Google-Anmeldung: Platzhalter in [eckigen Klammern] ausfüllen, Nicht-Zutreffendes streichen."
    >
      {stored.isPending ? (
        <Spinner size={20} className="text-fg-subtle" />
      ) : stored.isError ? (
        <ErrorText>{stored.error.message}</ErrorText>
      ) : (
        <LegalTextsEditor stored={stored.data} onNotify={onNotify} />
      )}
    </Section>
  );
}

/** Starts from the saved texts; after saving, they are the new saved ones. */
function LegalTextsEditor({ stored, onNotify }: { stored: LegalTexts; onNotify: ShowToast }) {
  const save = useSaveLegalTexts();
  const [draft, setDraft] = useState<LegalTexts>(stored);
  const changed =
    (draft.privacy ?? '') !== (stored.privacy ?? '') ||
    (draft.imprint ?? '') !== (stored.imprint ?? '');
  const placeholders = [draft.imprint, draft.privacy].some((text) => text?.includes('['));

  return (
    <>
      {FIELDS.map((field) => (
        <LegalField
          key={field.kind}
          label={field.label}
          value={draft[field.kind] ?? ''}
          onChange={(text) => setDraft({ ...draft, [field.kind]: text })}
          onTemplate={() => setDraft({ ...draft, [field.kind]: field.template })}
          viewTo={stored[field.kind] ? field.to : null}
        />
      ))}
      {placeholders && (
        <p className="text-xs text-warning">Noch Platzhalter in [eckigen Klammern] übrig.</p>
      )}
      {save.error && <ErrorText>{save.error.message}</ErrorText>}
      <div>
        <Button
          variant="secondary"
          disabled={!changed}
          loading={save.isPending}
          onClick={() =>
            save.mutate(draft, { onSuccess: () => onNotify('Impressum & Datenschutz gespeichert') })
          }
        >
          Speichern
        </Button>
      </div>
    </>
  );
}

function LegalField({
  label,
  value,
  onChange,
  onTemplate,
  viewTo,
}: {
  label: string;
  value: string;
  onChange: (text: string) => void;
  onTemplate: () => void;
  viewTo: string | null;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-xs font-medium text-fg">
          {label}
        </label>
        <span className="flex gap-3 text-xs">
          {!value.trim() && <TextLink onClick={onTemplate}>Vorlage einfügen</TextLink>}
          {viewTo && <TextLink to={viewTo}>Ansehen</TextLink>}
        </span>
      </div>
      <div className="field-well focus-field rounded-control px-3.5 py-2">
        <AutosizeTextarea
          id={id}
          value={value}
          rows={4}
          maxHeight={480}
          className="w-full font-mono text-xs leading-5"
          placeholder="Markdown: # Überschrift, - Liste, **fett**, [Link](https://…)"
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
    </div>
  );
}
