import { useId, useState } from 'react';
import type { LegalTexts, SetupStatus } from '@slider/shared';
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
import { GapList } from './GapList';
import { fillTemplate } from './lib/legal-template';
import { TemplateFiller } from './TemplateFiller';
import privacyTemplate from './templates/datenschutz.md?raw';
import imprintTemplate from './templates/impressum.md?raw';

type Settings = NonNullable<SetupStatus['settings']>;

const FIELDS = [
  { kind: 'imprint', label: 'Impressum', to: routes.imprint() },
  {
    kind: 'privacy',
    label: 'Datenschutzerklärung',
    to: routes.privacy(),
  },
] as const;

/**
 * Instance admin, on `/einrichtung`: writes imprint and privacy policy (BER-141), shown at
 * `/impressum` and `/datenschutz` and linked under every public page and mail. The templates are
 * filled in a form – the operator's details once, what this instance uses switched on from its
 * settings – and what is left as `[…]` is set gap by gap.
 */
export function LegalTextsSection({
  settings,
  onNotify,
}: {
  settings?: Settings | undefined;
  onNotify: ShowToast;
}) {
  const stored = useLegalTexts();
  return (
    <Section
      title="Impressum & Datenschutz"
      description="Erscheinen unter /impressum und /datenschutz und werden auf der Anmeldeseite, in den Einstellungen und unter jeder Mail verlinkt. Die Vorlagen füllst du in einem Formular aus – was diese Instanz nutzt, ist schon eingestellt. Bitte vor dem Veröffentlichen lesen und prüfen."
    >
      {stored.isPending ? (
        <Spinner size={20} className="text-fg-subtle" />
      ) : stored.isError ? (
        <ErrorText>{stored.error.message}</ErrorText>
      ) : (
        <LegalTextsEditor stored={stored.data} settings={settings} onNotify={onNotify} />
      )}
    </Section>
  );
}

/** Starts from the saved texts; after saving, they are the new saved ones. */
function LegalTextsEditor({
  stored,
  settings,
  onNotify,
}: {
  stored: LegalTexts;
  settings: Settings | undefined;
  onNotify: ShowToast;
}) {
  const save = useSaveLegalTexts();
  const [draft, setDraft] = useState<LegalTexts>(stored);
  const empty = !draft.imprint?.trim() && !draft.privacy?.trim();
  const [filling, setFilling] = useState(empty);
  const changed =
    (draft.privacy ?? '') !== (stored.privacy ?? '') ||
    (draft.imprint ?? '') !== (stored.imprint ?? '');

  return (
    <>
      {filling ? (
        <TemplateFiller
          settings={settings}
          replaces={!empty}
          onClose={() => setFilling(false)}
          onFill={(values, options) => {
            setDraft({
              imprint: fillTemplate(imprintTemplate, values, options),
              privacy: fillTemplate(privacyTemplate, values, options),
            });
            setFilling(false);
          }}
        />
      ) : (
        <div>
          <Button variant="secondary" size="sm" icon="article" onClick={() => setFilling(true)}>
            Vorlagen ausfüllen
          </Button>
        </div>
      )}
      {FIELDS.map((field) => (
        <LegalField
          key={field.kind}
          label={field.label}
          value={draft[field.kind] ?? ''}
          onChange={(text) => setDraft((current) => ({ ...current, [field.kind]: text }))}
          viewTo={stored[field.kind] ? field.to : null}
        />
      ))}
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
  viewTo,
}: {
  label: string;
  value: string;
  onChange: (text: string) => void;
  viewTo: string | null;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-xs font-medium text-fg">
          {label}
        </label>
        {viewTo && (
          <TextLink to={viewTo} className="text-xs">
            Ansehen
          </TextLink>
        )}
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
      <GapList text={value} onChange={onChange} />
    </div>
  );
}
