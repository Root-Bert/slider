import { useState } from 'react';
import type { SetupStatus } from '@slider/shared';
import { Button, TextField, Toggle } from '@/ui';
import {
  TEMPLATE_FIELDS,
  TEMPLATE_OPTIONS,
  templateDefaults,
  type TemplateOptions,
  type TemplateValues,
} from './lib/legal-template';

/**
 * Fills both templates at once: the operator's details once for imprint and privacy policy,
 * and what this instance uses – switched on as it is set up – instead of crossing out by hand.
 * Only fills the drafts; „Speichern“ still saves them.
 */
export function TemplateFiller({
  settings,
  replaces,
  onFill,
  onClose,
}: {
  settings: NonNullable<SetupStatus['settings']> | undefined;
  /** Something is written already that the templates replace. */
  replaces: boolean;
  onFill: (values: TemplateValues, options: TemplateOptions) => void;
  onClose: () => void;
}) {
  const [{ values, options }, setForm] = useState(() => templateDefaults(settings));
  const setValue = (key: keyof TemplateValues, value: string) =>
    setForm((form) => ({ ...form, values: { ...form.values, [key]: value } }));
  const setOption = (key: keyof TemplateOptions, on: boolean) =>
    setForm((form) => ({ ...form, options: { ...form.options, [key]: on } }));

  return (
    <div className="field-well flex flex-col gap-4 rounded-control p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {TEMPLATE_FIELDS.filter((field) => !('when' in field) || options[field.when]).map(
          (field) => (
            <TextField
              key={field.key}
              size="md"
              label={'optional' in field ? `${field.label} (optional)` : field.label}
              hint={'hint' in field ? field.hint : undefined}
              value={values[field.key]}
              onChange={(event) => setValue(field.key, event.target.value)}
            />
          ),
        )}
      </div>
      <div className="flex flex-col gap-3">
        <p className="text-xs font-medium text-fg">Was diese Instanz nutzt</p>
        {TEMPLATE_OPTIONS.map((option) => (
          <Toggle
            key={option.key}
            size="sm"
            label={option.label}
            description={'description' in option ? option.description : undefined}
            checked={options[option.key]}
            onChange={(on) => setOption(option.key, on)}
          />
        ))}
      </div>
      <p className="text-xs text-fg-subtle">
        Leere Felder bleiben als [Lücke] stehen und lassen sich unten einzeln setzen.
        {replaces && ' Ersetzt, was in Impressum und Datenschutzerklärung steht.'} Gespeichert wird
        erst mit „Speichern“.
      </p>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" onClick={() => onFill(values, options)}>
          {replaces ? 'Texte ersetzen' : 'Texte erzeugen'}
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Abbrechen
        </Button>
      </div>
    </div>
  );
}
