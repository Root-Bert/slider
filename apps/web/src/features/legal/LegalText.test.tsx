import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { LegalText } from './LegalText';
import privacyTemplate from './templates/datenschutz.md?raw';

const renderText = (markdown: string) =>
  render(
    <MemoryRouter>
      <LegalText markdown={markdown} />
    </MemoryRouter>,
  );

describe('LegalText (BER-141)', () => {
  it('renders headings, address lines, lists, bold and links', () => {
    renderText(
      '# Impressum\n\nAnna Becker\nHauptstr. 1\n\n## Kontakt\n\n- **E-Mail:** [schreib uns](mailto:a@b.de)\n- https://slider.firma.de',
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Impressum' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Kontakt' })).toBeTruthy();
    expect(screen.getByText(/Anna Becker/).innerHTML).toContain('<br>');
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'schreib uns' }).getAttribute('href')).toBe(
      'mailto:a@b.de',
    );
    expect(screen.getByText('E-Mail:').tagName).toBe('STRONG');
  });

  it('never turns the text into HTML', () => {
    const { container } = renderText('<img src=x onerror=alert(1)> [x](javascript:alert(1))');
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
  });

  it('renders the privacy template with its sections', () => {
    renderText(privacyTemplate);
    expect(screen.getByRole('heading', { level: 1, name: 'Datenschutzerklärung' })).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 2 }).length).toBeGreaterThanOrEqual(10);
  });
});
