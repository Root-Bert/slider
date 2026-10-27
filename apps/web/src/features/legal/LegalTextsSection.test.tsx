import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { LegalTexts } from '@slider/shared';
import { LegalTextsSection } from './LegalTextsSection';

const saved: LegalTexts[] = [];
vi.mock('@/lib/api', () => ({
  useLegalTexts: () => ({
    isPending: false,
    isError: false,
    data: { imprint: null, privacy: null },
  }),
  useSaveLegalTexts: () => ({
    isPending: false,
    error: null,
    mutate: (texts: LegalTexts) => saved.push(texts),
  }),
}));

function setup() {
  const router = createMemoryRouter([
    { path: '/', element: <LegalTextsSection onNotify={() => {}} /> },
  ]);
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
  });
});
