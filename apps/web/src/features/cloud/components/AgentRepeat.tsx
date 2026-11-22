import { useId, useState } from 'react';
import { MAX_MATERIAL_CHAT_MESSAGE, type CloudAgentDetail } from '@slider/shared';
import { useRepeatCloudAgent } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import {
  AutosizeTextarea,
  Button,
  cn,
  Icon,
  iconButtonClasses,
  PopoverPanel,
  SegmentedControl,
  Select,
  TextField,
  Tooltip,
  usePopover,
} from '@/ui';
import { useCloud } from '../hooks/useCloud';
import { repeatWords, WEEKDAYS } from '../lib/kinds';

const RHYTHMS = [
  { value: 'day', label: 'Täglich' },
  { value: 'weekdays', label: 'Werktags' },
  { value: 'week', label: 'Wöchentlich' },
] as const;
type Rhythm = (typeof RHYTHMS)[number]['value'];
/** Monday first, as the week is read here. */
const DAYS = [1, 2, 3, 4, 5, 6, 0].map((day) => ({ value: String(day), label: WEEKDAYS[day]! }));

/**
 * „Wiederholen“: the agent takes an order up again by itself – every day, on weekdays or once a
 * week, at a time on its owner's clock. Each time is a message of theirs in the first chat; what
 * it then makes lies on the desk as ever. Its owner's alone.
 */
export function AgentRepeat({
  agent,
  edit = false,
}: {
  agent: CloudAgentDetail;
  /** Beside the repeated order itself („Arbeitet von selbst“): a small pencil to change it. */
  edit?: boolean;
}) {
  const ui = useCloud();
  const save = useRepeatCloudAgent(ui.workspace.id, agent.id);
  const { open, close, wrapperRef, triggerProps, panelRef, panelId } = usePopover({
    hasPopup: 'dialog',
  });
  const titleId = useId();
  const textId = useId();
  const set = agent.repeat;
  // The order to start from: the one repeated now, else what the agent was first asked.
  const first = agent.chats[0]?.messages.find((each) => each.role === 'user')?.text ?? '';
  const [every, setEvery] = useState<Rhythm>(set?.every ?? 'day');
  const [day, setDay] = useState(String(set?.day ?? 1));
  const [at, setAt] = useState(set?.at ?? '08:00');
  const [text, setText] = useState(set?.text ?? first);
  const label = edit
    ? 'Zeit und Auftrag ändern'
    : set
      ? `Wiederholt sich: ${repeatWords(set)}`
      : 'Wiederholen';
  const refused = (error: Error) => ui.notify(error.message, 'danger');
  return (
    <div ref={wrapperRef} className={cn('relative shrink-0', open && 'z-(--z-raised)')}>
      <Tooltip label={label} decorative disabled={open}>
        <button
          type="button"
          aria-label={label}
          {...triggerProps}
          className={cn(
            iconButtonClasses({ variant: 'subtle', size: edit ? 'compact' : undefined }),
            set && !edit && 'text-fg',
          )}
        >
          <Icon name={edit ? 'edit' : set ? 'replay' : 'schedule'} size={edit ? 16 : undefined} />
        </button>
      </Tooltip>
      {open && (
        <PopoverPanel
          ref={panelRef}
          id={panelId}
          as="section"
          role="dialog"
          aria-labelledby={titleId}
          align="end"
          padding="lg"
          className="flex w-80 max-w-[calc(100vw-32px)] flex-col gap-3"
        >
          <div className="flex flex-col gap-1">
            <h2 id={titleId} className="text-sm font-medium text-fg">
              Wiederholen
            </h2>
            <p className="text-xs leading-4 text-fg-muted">
              Der Agent nimmt den Auftrag von selbst wieder auf. Was er dabei macht, steht auf
              seinem Schreibtisch – von dort nimmst du es zurück.
            </p>
          </div>
          <SegmentedControl
            label="Rhythmus"
            size="sm"
            track="soft"
            segments={RHYTHMS}
            value={every}
            onChange={setEvery}
            className="self-start"
          />
          <div className="flex items-end gap-2">
            {every === 'week' && (
              <Select
                aria-label="Wochentag"
                value={day}
                onChange={setDay}
                options={DAYS}
                className="min-w-0 flex-1"
              />
            )}
            <TextField
              aria-label="Uhrzeit"
              type="time"
              required
              value={at}
              onChange={(event) => setAt(event.target.value)}
              className={every === 'week' ? 'w-28 shrink-0' : 'flex-1'}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={textId} className="text-xs text-fg-subtle">
              Auftrag
            </label>
            <div className="field-well focus-field rounded-control px-3 py-2">
              <AutosizeTextarea
                id={textId}
                maxLength={MAX_MATERIAL_CHAT_MESSAGE}
                maxHeight={140}
                rows={2}
                value={text}
                onChange={(event) => setText(event.target.value)}
                className="w-full text-body text-fg"
              />
            </div>
          </div>
          {set && (
            <p className="text-caption text-fg-subtle">
              Nächstes Mal: {formatDateTime(set.nextRunAt)}
            </p>
          )}
          <div className="flex items-center justify-end gap-2">
            {set && (
              <Button
                variant="ghost"
                size="sm"
                disabled={save.isPending}
                onClick={() => save.mutate(null, { onSuccess: close, onError: refused })}
              >
                Nicht mehr wiederholen
              </Button>
            )}
            <Button
              variant="primary"
              size="sm"
              disabled={save.isPending || !text.trim() || !/^\d\d:\d\d$/.test(at)}
              onClick={() =>
                save.mutate(
                  {
                    every,
                    at,
                    ...(every === 'week' ? { day: Number(day) } : {}),
                    zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                    text: text.trim(),
                  },
                  { onSuccess: close, onError: refused },
                )
              }
            >
              {set ? 'Speichern' : 'Wiederholen'}
            </Button>
          </div>
        </PopoverPanel>
      )}
    </div>
  );
}
