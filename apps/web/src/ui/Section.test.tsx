import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Section } from './Section';

describe('Section', () => {
  it('is a region named by its heading, with the description and content', () => {
    render(
      <Section id="einladen" title="Mitglieder" description="Wer mitmacht." aside={<span>3</span>}>
        <p>Inhalt</p>
      </Section>,
    );
    const region = screen.getByRole('region', { name: 'Mitglieder' });
    expect(region.id).toBe('einladen');
    expect(screen.getByRole('heading', { level: 2, name: 'Mitglieder' })).toBeTruthy();
    expect(region.textContent).toContain('Wer mitmacht.');
    expect(region.textContent).toContain('3');
    expect(region.textContent).toContain('Inhalt');
  });

  it('works without children', () => {
    render(<Section title="Diese Slider-Instanz" aside={<a href="/einrichtung">Einrichtung</a>} />);
    expect(screen.getByRole('region', { name: 'Diese Slider-Instanz' })).toBeTruthy();
  });

  it('danger tone colours the heading and swaps the edge for a danger ring', () => {
    render(<Section title="Löschen" tone="danger" />);
    const region = screen.getByRole('region', { name: 'Löschen' });
    expect(region.className).toContain('inset-ring-danger/30');
    expect(screen.getByRole('heading').className).toContain('text-danger');
  });

  it('density compact tightens gap and padding', () => {
    render(<Section title="Beitreten" density="compact" />);
    const classes = screen.getByRole('region').className.split(' ');
    expect(classes).toEqual(expect.arrayContaining(['gap-4', 'p-6']));
    expect(classes).not.toContain('gap-5');
  });

  it('renders a decorative leading icon in the heading', () => {
    render(<Section title="Organisation beitreten" icon="personAdd" />);
    const heading = screen.getByRole('heading', { name: 'Organisation beitreten' });
    const svg = heading.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
  });
});
