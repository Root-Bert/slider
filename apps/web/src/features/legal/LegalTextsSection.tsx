import { useId, useState } from 'react';
import type { LegalTexts, SetupStatus } from '@slider/shared';
import { routes } from '@/lib/routes';
import { AutosizeTextarea, Button, ErrorText, Section, Spinner, TextLink } from '@/ui';
import { GapList } from './GapList';
import { LEGAL_LABELS, type LegalTextsDraft } from './lib/legal-draft';
import { fillTemplate } from './lib/legal-template';
import { TemplateFiller } from './TemplateFiller';
import privacyTemplate from './templates/datenschutz.md?raw';
import imprintTemplate from './templates/impressum.md?raw';

type Settings = NonNullable<SetupStatus['settings']>;

const FIELDS = [
  { kind: 'imprint', label: LEGAL_LABELS.imprint, to: routes.imprint() },
  { kind: 'privacy', label: LEGAL_LABELS.privacy, to: routes.privacy() },
] as const;

/**
 * Instance admin, on `/einrichtung`: writes imprint and privacy policy (BER-141), shown at
 * `/impressum` and `/datenschutz` and linked under every public page and mail. The templates are
 * filled in a form – the operator's details once, what this instance uses switched on from its
 * settings – and what is left as `[…]` is set gap by gap. Saved with the page's other settings.
 */
export function LegalTextsSection({
  legal,
  settings,
}: {
  legal: LegalTextsDraft;
  settings?: Settings | undefined;
}) {
  const { stored } = legal;
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
        <LegalTextsEditor legal={legal} stored={stored.data} settings={settings} />
      )}
    </Section>
  );
}

/** Mounted once the saved texts are there: with none yet, the form opens on its own. */
function LegalTextsEditor({
  legal,
  stored,
  settings,
}: {
  legal: LegalTextsDraft;
  stored: LegalTexts;
  settings: Settings | undefined;
}) {
  const { draft, update } = legal;
  const empty = !draft.imprint?.trim() && !draft.privacy?.trim();
  const [filling, setFilling] = useState(empty);

  return (
    <>
      {filling ? (
        <TemplateFiller
          settings={settings}
          replaces={!empty}
          onClose={() => setFilling(false)}
          onFill={(values, options) => {
            update({
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
          onChange={(text) => update({ [field.kind]: text })}
          viewTo={stored[field.kind] ? field.to : null}
        />
      ))}
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
