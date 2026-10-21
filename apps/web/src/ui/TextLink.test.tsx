import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { textLinkClasses } from './text-link-classes';
import { BackLink, TextLink } from './TextLink';

const classes = (element: Element) => element.getAttribute('class')!.split(/\s+/);

describe('TextLink', () => {
  it('renders a router link for `to`', () => {
    render(
      <MemoryRouter>
        <TextLink to="/reviews" variant="underline" size="sm">
          Zu meinen Reviews
        </TextLink>
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: 'Zu meinen Reviews' });
    expect(link.getAttribute('href')).toBe('/reviews');
    expect(classes(link)).toEqual(
      expect.arrayContaining(['underline', 'underline-offset-4', 'text-sm', 'text-fg-muted']),
    );
  });

  it('renders an anchor for `href`', () => {
    render(
      <TextLink href="https://example.com" target="_blank" rel="noopener" variant="inline">
        Hilfe
      </TextLink>,
    );
    const link = screen.getByRole('link', { name: 'Hilfe' });
    expect(link.getAttribute('target')).toBe('_blank');
    expect(classes(link)).toEqual(expect.arrayContaining(['underline-offset-2', 'text-fg']));
  });

  it('renders a type=button without `to` or `href`', async () => {
    const onClick = vi.fn();
    render(
      <TextLink onClick={onClick} icon="check" size="xs">
        Kopieren
      </TextLink>,
    );
    const button = screen.getByRole('button', { name: 'Kopieren' });
    expect(button.getAttribute('type')).toBe('button');
    expect(classes(button)).toEqual(expect.arrayContaining(['inline-flex', 'gap-1', 'text-xs']));
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('maps variants and tones', () => {
    expect(textLinkClasses().split(' ')).toContain('text-fg-subtle');
    expect(textLinkClasses({ tone: 'muted' }).split(' ')).toContain('text-fg-muted');
    expect(textLinkClasses({ variant: 'mention' }).split(' ')).toContain('text-mention');
    expect(textLinkClasses({ weight: 'medium' }).split(' ')).toContain('font-medium');
  });
});

describe('BackLink', () => {
  it('links back with the default label and an arrow', () => {
    render(
      <MemoryRouter>
        <BackLink to="/reviews" />
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: 'Zurück zu den Reviews' });
    expect(link.getAttribute('href')).toBe('/reviews');
    expect(classes(link)).toEqual(expect.arrayContaining(['text-body', 'text-fg-subtle']));
    expect(link.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('takes a custom label', () => {
    render(
      <MemoryRouter>
        <BackLink to="/" label="Zurück" />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Zurück' })).toBeTruthy();
  });
});
