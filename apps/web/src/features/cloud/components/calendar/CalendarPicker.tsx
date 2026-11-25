import type { Calendar } from '@slider/shared';
import { GoogleMark, Icon, MenuHeading, MenuItem, MicrosoftMark } from '@/ui';
import { useCloud } from '../../hooks/useCloud';
import { AreaMark } from '../AreaMark';
import { MeAvatar, Picker } from '../todos/TodoList';
import { useCalendarAccounts } from './CalendarAccounts';
import { colorOf } from './entries';

/**
 * What stands before a calendar's name, as everywhere its place is named: an area's own calendar
 * its area's mark (the workspace's its logo), one's private one one's picture, a mailbox's its
 * provider's sign; a sub-calendar its colour.
 */
export function CalendarMark({ calendar }: { calendar: Calendar }) {
  const ui = useCloud();
  const accounts = useCalendarAccounts(ui.workspace.id, [calendar]);
  const area = calendar.areaId ? ui.home?.areas.find((each) => each.id === calendar.areaId) : null;
  let mark;
  if (calendar.kind === 'mail') {
    const signIn = accounts?.find((each) => each.id === calendar.mailAccountId)?.signIn;
    mark =
      signIn === 'google' ? (
        <GoogleMark size={14} />
      ) : signIn === 'microsoft' ? (
        <MicrosoftMark size={14} />
      ) : (
        <Icon name="mail" size="sm" className="text-fg-subtle" />
      );
  } else if (calendar.parentId) {
    mark = (
      <span
        aria-hidden
        className="size-2.5 rounded-full"
        style={{ backgroundColor: colorOf(calendar.color) }}
      />
    );
  } else if (area) {
    mark = <AreaMark area={area} />;
  } else {
    mark = <MeAvatar />;
  }
  return <span className="flex size-5 shrink-0 items-center justify-center">{mark}</span>;
}

/**
 * The calendar an event stands in, picked as the to-do's place is: grouped as beside the calendar
 * (the workspace's areas, „Meine Kalender“, each mailbox), each with its mark.
 */
export function CalendarPicker({
  value,
  calendars,
  disabled,
  onPick,
}: {
  value: string;
  /** The ones to pick from (those one may fill). */
  calendars: readonly Calendar[];
  disabled: boolean;
  onPick: (calendarId: string) => void;
}) {
  const ui = useCloud();
  const accounts = useCalendarAccounts(ui.workspace.id, calendars) ?? [];
  const here = calendars.find((each) => each.id === value);
  const areaOrder = (calendar: Calendar) => {
    const index = (ui.home?.areas ?? []).findIndex((area) => area.id === calendar.areaId);
    return index < 0 ? 1e6 : index;
  };
  /** Under its parent, as beside the calendar: depth by its chain of parents. */
  const ordered = (list: Calendar[]) => {
    const out: { calendar: Calendar; depth: number }[] = [];
    const walk = (parentId: string | null, depth: number) => {
      for (const calendar of list.filter((each) => each.parentId === parentId)) {
        out.push({ calendar, depth });
        walk(calendar.id, depth + 1);
      }
    };
    const roots = list
      .filter((each) => !each.parentId || !list.some((other) => other.id === each.parentId))
      .sort((a, b) => areaOrder(a) - areaOrder(b));
    for (const root of roots) {
      out.push({ calendar: root, depth: 0 });
      walk(root.id, 1);
    }
    return out;
  };
  const groups = [
    { title: ui.workspace.name, list: ordered(calendars.filter((each) => each.kind === 'area')) },
    {
      title: 'Meine Kalender',
      list: ordered(calendars.filter((each) => each.kind === 'private')),
    },
    ...accounts.map((account) => ({
      title: account.name,
      list: ordered(calendars.filter((each) => each.mailAccountId === account.id)),
    })),
  ].filter((group) => group.list.length > 0);
  return (
    <Picker
      wide
      fluid
      label={`Kalender: ${here?.name ?? ''}`}
      disabled={disabled}
      trigger={
        <>
          {here && <CalendarMark calendar={here} />}
          <span className="truncate text-fg">{here?.name}</span>
        </>
      }
    >
      {(close) => (
        <div className="-m-1 flex max-h-80 flex-col overflow-y-auto p-1">
          {groups.map((group) => (
            <div key={group.title} role="group" aria-label={group.title} className="flex flex-col">
              <MenuHeading className="truncate normal-case">{group.title}</MenuHeading>
              {group.list.map(({ calendar, depth }) => (
                <MenuItem
                  key={calendar.id}
                  role="menuitemradio"
                  aria-checked={calendar.id === value}
                  selected={calendar.id === value}
                  icon={<CalendarMark calendar={calendar} />}
                  truncate
                  style={{ paddingLeft: 8 + depth * 16 }}
                  onClick={() => {
                    close();
                    if (calendar.id !== value) onPick(calendar.id);
                  }}
                >
                  {calendar.name}
                </MenuItem>
              ))}
            </div>
          ))}
        </div>
      )}
    </Picker>
  );
}
