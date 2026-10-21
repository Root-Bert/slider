import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ListRow, RowList } from './ListRow';

describe('ListRow', () => {
  it('renders list items with title, subtitle, badge and trailing', () => {
    render(
      <RowList aria-label="Anmeldungen">
        <ListRow
          leading={<span data-testid="tile" />}
          title="Microsoft"
          subtitle="a@b.de"
          badge={<span>Synchronisiert</span>}
          trailing={<button type="button">Menü</button>}
        />
      </RowList>,
    );
    const list = screen.getByRole('list', { name: 'Anmeldungen' });
    const item = within(list).getByRole('listitem');
    expect(item.textContent).toContain('Microsoft');
    expect(item.textContent).toContain('a@b.de');
    expect(item.textContent).toContain('Synchronisiert');
    expect(within(item).getByRole('button', { name: 'Menü' })).toBeTruthy();
    expect(within(item).getByTestId('tile')).toBeTruthy();
  });

  it('divided variant separates rows with hairlines', () => {
    render(
      <RowList>
        <ListRow title="A" />
      </RowList>,
    );
    expect(screen.getByRole('list').className).toContain('divide-hairline');
    expect(screen.getByRole('listitem').className).toContain('first:pt-0');
  });

  it('hover variant insets the row and tints it on hover', () => {
    render(
      <RowList variant="hover">
        <ListRow variant="hover" title="Ada" />
      </RowList>,
    );
    expect(screen.getByRole('list').className).toContain('-mx-2');
    const row = screen.getByRole('listitem').className;
    expect(row).toContain('hover:bg-surface-1');
    expect(row).toContain('px-2');
  });

  it('flush variant has no hover; padding md is 10px', () => {
    render(<ListRow variant="flush" padding="md" title="Einladung" as="div" />);
    const row = screen.getByText('Einladung').closest('div')!.className;
    expect(row).not.toContain('hover:');
    expect(row).toContain('p-2.5');
  });

  it('title size, weight and tone are props', () => {
    render(
      <ul>
        <ListRow title="body" size="body" titleWeight="normal" titleTone="subtle" />
      </ul>,
    );
    const title = screen.getByText('body').className;
    expect(title).toContain('text-body');
    expect(title).toContain('text-fg-subtle');
    expect(title).not.toContain('font-medium');
  });

  it('dimmed mutes the title and fades the leading', () => {
    render(
      <ul>
        <ListRow title="Google" dimmed leading={<span data-testid="tile" />} />
      </ul>,
    );
    expect(screen.getByText('Google').className).toContain('text-fg-muted');
    expect(screen.getByTestId('tile').parentElement!.className).toContain('opacity-60');
  });

  it('keeps the 32px action cell even when it is empty', () => {
    const { container } = render(
      <ul>
        <ListRow title="Du" actionSlot={false} />
        <ListRow title="Ada" actionSlot={<button type="button">Entfernen</button>} />
        <ListRow title="Ohne" />
      </ul>,
    );
    const cells = container.querySelectorAll('[data-slot="action"]');
    expect(cells).toHaveLength(2);
    expect(cells[0]!.className).toContain('w-8');
  });

  it('wide and header paddings carry their own radius', () => {
    render(
      <>
        <ListRow variant="flush" padding="wide" title="Kompakt" as="div" />
        <ListRow variant="flush" padding="header" title="Kopf" as="div" />
      </>,
    );
    const wide = screen.getByText('Kompakt').closest('div')!.className;
    expect(wide).toContain('rounded-control');
    expect(wide).not.toContain('rounded-control-sm');
    expect(wide).toContain('px-2.5');
    expect(wide).toContain('py-2');
    const header = screen.getByText('Kopf').closest('div')!.className;
    expect(header).toContain('pt-2');
    expect(header).toContain('pb-2.5');
  });

  it('subtitle can carry a tooltip; textGap tight spaces the two lines', () => {
    render(
      <ul>
        <ListRow
          title="Passkey"
          subtitle="Erstellt gestern"
          subtitleTitle="1.1.2026"
          textGap="tight"
        />
      </ul>,
    );
    const subtitle = screen.getByText('Erstellt gestern');
    expect(subtitle.getAttribute('title')).toBe('1.1.2026');
    expect(subtitle.parentElement!.className).toContain('gap-0.5');
  });
});
