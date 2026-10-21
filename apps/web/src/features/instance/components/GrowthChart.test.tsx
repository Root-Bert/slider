import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import type { Metric } from '../lib/period';
import { GrowthChart } from './GrowthChart';

const timeline = [1, 4, 0].map((users, index) => ({
  start: new Date(2026, 9, 1 + index).toISOString(),
  users,
  workspaces: index,
  decks: 2 * users,
}));

function Chart() {
  const [metric, setMetric] = useState<Metric>('users');
  return (
    <GrowthChart
      timeline={timeline}
      stretchHours={24}
      view={{
        from: new Date(2026, 9, 1).getTime(),
        to: new Date(2026, 9, 4).getTime(),
        live: true,
        phrase: 'in 3 Tagen',
      }}
      metric={metric}
      onMetricChange={setMetric}
      accent="var(--color-accent-green)"
    />
  );
}

describe('GrowthChart (BER-167)', () => {
  it('one measure at a time, every point with its value on focus and in the table', async () => {
    render(<Chart />);
    expect(screen.getByText('5 neue Personen in 3 Tagen, je Tag.')).toBeTruthy();
    const point = screen.getByRole('button', { name: '2. Okt.: 4 neue Personen' });
    act(() => point.focus());
    // The mark beside the pin, floating above the page.
    expect(document.body.textContent).toContain('4 Personen2. Okt.');
    expect(screen.getByRole('table').textContent).toContain('2. Okt.4');

    await userEvent.click(screen.getByRole('radio', { name: 'Reviews' }));
    expect(screen.getByRole('button', { name: '2. Okt.: 8 neue Reviews' })).toBeTruthy();
  });
});
