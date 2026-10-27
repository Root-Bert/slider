import { useState } from 'react';
import { Button, TextField } from '@/ui';
import { fillGap, findGaps } from './lib/legal-template';

/**
 * The `[…]` left in a legal text, each with a field: what is typed goes in everywhere the gap
 * stands, „Streichen“ takes it out – also the notes of older templates („nur wenn …“).
 */
export function GapList({ text, onChange }: { text: string; onChange: (text: string) => void }) {
  const gaps = findGaps(text);
  const [typed, setTyped] = useState<Record<string, string>>({});
  if (gaps.length === 0) return null;

  const fill = (gap: string, value: string) => {
    onChange(fillGap(text, gap, value));
    setTyped(({ [gap]: _, ...rest }) => rest);
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-warning">
        {gaps.length === 1 ? 'Noch 1 Lücke' : `Noch ${gaps.length} Lücken`} – hier setzen oder im
        Text ändern:
      </p>
      {gaps.map((gap) => {
        const value = typed[gap] ?? '';
        const label = gap.slice(1, -1);
        return (
          <form
            key={gap}
            className="flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (value.trim()) fill(gap, value);
            }}
          >
            <TextField
              className="min-w-0 flex-1"
              label={label.length > 80 ? `${label.slice(0, 80)}…` : label}
              title={label}
              value={value}
              onChange={(event) => setTyped({ ...typed, [gap]: event.target.value })}
            />
            <Button type="submit" variant="secondary" size="field" disabled={!value.trim()}>
              Einsetzen
            </Button>
            <Button variant="ghost" size="field" onClick={() => fill(gap, '')}>
              Streichen
            </Button>
          </form>
        );
      })}
    </div>
  );
}
