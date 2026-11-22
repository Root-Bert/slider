import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { LegalTexts } from '@slider/shared';
import { LegalTextsSection } from './LegalTextsSection';
import { useLegalTextsDraft } from './lib/legal-draft';

const saved: LegalTexts[] = [];
vi.mock('@/lib/api', () => ({
  // What was saved last comes back, as the query does after saving.
  useLegalTexts: () => ({
    isPending: false,
    isError: false,
    data: saved.at(-1) ?? { imprint: null, privacy: null, template: null },
  }),
  useSaveLegalTexts: () => ({
    isPending: false,
    error: null,
    mutateAsync: async (texts: LegalTexts) => saved.push(texts),
  }),
}));

/** The setup page's „Speichern“ stands for the page's own button. */
function Page() {
  const legal = useLegalTextsDraft();
  return (
    <>
      <LegalTextsSection legal={legal} />
      <button type="button" onClick={() => void legal.commit()}>
        Speichern
      </button>
    </>
  );
}

function setup() {
  const router = createMemoryRouter([{ path: '/', element: <Page /> }]);
  render(<RouterProvider router={router} />);
}

describe('LegalTextsSection', () => {
  it('fills both texts from the form, then sets what was left open', async () => {
    const user = userEvent.setup();
    setup();
    // Nothing written yet: the form is open.
    await user.type(screen.getByLabelText('Name oder Firma'), 'Erika Muster');
    await user.click(screen.getByRole('button', { name: 'Texte erzeugen' }));

    const imprint = screen.getByLabelText('Impressum') as HTMLTextAreaElement;
    const privacy = screen.getByLabelText('Datenschutzerklärung') as HTMLTextAreaElement;
    expect(imprint.value).toContain('Erika Muster\n[Straße und Hausnummer]');
    expect(privacy.value).toContain('## 1. Verantwortlicher\n\nErika Muster');
    expect(privacy.value).not.toContain('{{');

    // The same gap in both texts is set in each from its own list.
    const [street] = screen.getAllByLabelText('Straße und Hausnummer');
    await user.type(street!, 'Hauptstraße 1{Enter}');
    expect(imprint.value).toContain('Erika Muster\nHauptstraße 1\n');
    expect(imprint.value).not.toContain('[Straße und Hausnummer]');

    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(saved.at(-1)?.imprint).toContain('Hauptstraße 1');
    // The form's values are saved with them, the gap set by hand too.
    expect(saved.at(-1)?.template?.values).toMatchObject({
      name: 'Erika Muster',
      street: 'Hauptstraße 1',
    });

    // „Vorlage bearbeiten“ opens the form on them …
    expect(screen.queryByRole('button', { name: 'Vorlagen ausfüllen' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Vorlage bearbeiten' }));
    expect(screen.getByLabelText('Name oder Firma')).toHaveProperty('value', 'Erika Muster');
    await user.click(screen.getByRole('button', { name: 'Abbrechen' }));

    // … „Vorlage aktualisieren“ fills the templates again without asking.
    await user.click(screen.getByRole('button', { name: 'Vorlage aktualisieren' }));
    const refreshed = screen.getByLabelText('Impressum') as HTMLTextAreaElement;
    expect(refreshed.value).toContain('Erika Muster\nHauptstraße 1\n');
    expect(refreshed.value).toContain('[PLZ und Ort]');
  });
});
