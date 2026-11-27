import { useState } from 'react';
import type { EventRepeat, EventScope } from '@slider/shared';
import { ConfirmDialog, Icon, MenuItem, cn } from '@/ui';
import { Picker } from '../todos/TodoList';
import { at } from './days';
import { MonthGrid } from './MonthGrid';

/** What „Wiederholen“ offers – a series made elsewhere (every 3 weeks) is named as it is. */
const CHOICES: { label: string; repeat: Omit<EventRepeat, 'until'> | null }[] = [
  { label: 'Nie', repeat: null },
  { label: 'Täglich', repeat: { freq: 'daily', interval: 1 } },
  { label: 'Werktags', repeat: { freq: 'weekly', interval: 1, days: [0, 1, 2, 3, 4] } },
  { label: 'Wöchentlich', repeat: { freq: 'weekly', interval: 1 } },
  { label: 'Alle 2 Wochen', repeat: { freq: 'weekly', interval: 2 } },
  { label: 'Monatlich', repeat: { freq: 'monthly', interval: 1 } },
  { label: 'Jährlich', repeat: { freq: 'yearly', interval: 1 } },
];

const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const UNITS = { daily: 'Tage', weekly: 'Wochen', monthly: 'Monate', yearly: 'Jahre' } as const;

const daysOf = (repeat: Pick<EventRepeat, 'days'>) =>
  [...new Set(repeat.days ?? [])].sort((a, b) => a - b).join(',');
const sameRule = (a: Omit<EventRepeat, 'until'> | null, b: EventRepeat | null) =>
  a === null || b === null
    ? a === b
    : a.freq === b.freq && a.interval === b.interval && daysOf(a) === daysOf(b);

/** „Wöchentlich“, „Alle 3 Wochen (Mo, Mi)“ – how a series repeats, in words. */
export function repeatLabel(repeat: EventRepeat | null): string {
  const named = CHOICES.find((choice) => sameRule(choice.repeat, repeat));
  if (named || !repeat) return named?.label ?? 'Nie';
  const base =
    repeat.interval === 1
      ? (CHOICES.find((choice) => choice.repeat?.freq === repeat.freq && !choice.repeat.days)
          ?.label ?? '')
      : `Alle ${repeat.interval} ${UNITS[repeat.freq]}`;
  const days = repeat.days?.length
    ? ` (${[...repeat.days]
        .sort((a, b) => a - b)
        .map((day) => WEEKDAYS[day])
        .join(', ')})`
    : '';
  return `${base}${days}`;
}

const dayLabel = new Intl.DateTimeFormat('de-DE', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/**
 * „Wiederholen“ under an event's times: how often (a pick closes it), and – repeating – until
 * which day („ohne Ende“ else), as Apple's calendar asks it.
 */
export function RepeatField({
  repeat,
  firstDay,
  disabled,
  onChange,
}: {
  repeat: EventRepeat | null;
  /** The (first) one's day: its end lies on or after it. */
  firstDay: string;
  disabled: boolean;
  onChange: (repeat: EventRepeat | null) => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 text-sm">
      <Icon name="repeat" size="sm" className="shrink-0 text-fg-subtle" />
      <Picker
        label={`Wiederholen: ${repeatLabel(repeat)}`}
        disabled={disabled}
        trigger={
          <span className={repeat ? 'text-fg' : 'text-fg-faint'}>
            {repeat ? repeatLabel(repeat) : 'Nicht wiederholen'}
          </span>
        }
      >
        {(close) => (
          <div className="-m-1 flex flex-col p-1">
            {CHOICES.map((choice) => {
              const picked = sameRule(choice.repeat, repeat);
              return (
                <MenuItem
                  key={choice.label}
                  role="menuitemradio"
                  aria-checked={picked}
                  selected={picked}
                  onClick={() => {
                    close();
                    if (!picked) {
                      onChange(choice.repeat && { ...choice.repeat, until: repeat?.until ?? null });
                    }
                  }}
                >
                  {choice.label}
                </MenuItem>
              );
            })}
          </div>
        )}
      </Picker>
      {repeat && (
        <Picker
          label={`Endet: ${repeat.until ? dayLabel.format(at(repeat.until)) : 'nie'}`}
          calendar
          disabled={disabled}
          trigger={
            <span className="text-fg tabular-nums">
              {repeat.until ? `bis ${dayLabel.format(at(repeat.until))}` : 'ohne Ende'}
            </span>
          }
        >
          {(close) => (
            <div className="flex flex-col gap-1">
              <MenuItem
                role="menuitemradio"
                aria-checked={!repeat.until}
                selected={!repeat.until}
                onClick={() => {
                  close();
                  if (repeat.until) onChange({ ...repeat, until: null });
                }}
              >
                Ohne Ende
              </MenuItem>
              <MonthGrid
                value={repeat.until ?? firstDay}
                onPick={(day) => {
                  close();
                  onChange({ ...repeat, until: day < firstDay ? firstDay : day });
                }}
              />
            </div>
          )}
        </Picker>
      )}
    </div>
  );
}

/**
 * Which of a series a change or „Löschen“ means – asked once as one changes it, the answer kept
 * while its panel stays open. A change of how it repeats is for the ones after or all.
 */
export function ScopeDialog({
  title,
  deleting,
  wholeOnly,
  onClose,
  onPick,
}: {
  title: string;
  deleting: boolean;
  wholeOnly: boolean;
  onClose: () => void;
  onPick: (scope: EventScope) => void;
}) {
  const options = [
    ...(wholeOnly ? [] : [{ scope: 'one' as const, label: 'Nur diesen Termin' }]),
    { scope: 'following' as const, label: 'Diesen und alle folgenden' },
    { scope: 'all' as const, label: 'Alle Termine der Serie' },
  ];
  const [scope, setScope] = useState<EventScope>(options[0]!.scope);
  return (
    <ConfirmDialog
      onClose={onClose}
      title={`„${title}“ ${deleting ? 'löschen' : 'ändern'}?`}
      description="Der Termin wiederholt sich."
      confirmLabel={deleting ? 'Löschen' : 'Ändern'}
      confirmIcon={deleting ? 'delete' : undefined}
      tone={deleting ? 'danger' : 'primary'}
      onConfirm={() => onPick(scope)}
    >
      <div role="radiogroup" aria-label="Welche Termine" className="flex flex-col gap-1">
        {options.map((option) => (
          <button
            key={option.scope}
            type="button"
            role="radio"
            aria-checked={option.scope === scope}
            onClick={() => setScope(option.scope)}
            className={cn(
              'flex items-center gap-3 rounded-control px-3 py-2 text-left text-sm transition-colors focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none',
              option.scope === scope ? 'bg-selected text-fg' : 'text-fg-muted hover:bg-hover',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'grid size-4 shrink-0 place-items-center rounded-full border',
                option.scope === scope ? 'border-border-focus' : 'border-hairline-strong',
              )}
            >
              {option.scope === scope && <span className="size-2 rounded-full bg-fg" />}
            </span>
            {option.label}
          </button>
        ))}
      </div>
    </ConfirmDialog>
  );
}
