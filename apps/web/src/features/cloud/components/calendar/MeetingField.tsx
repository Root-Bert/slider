import type { AccountAuthor, EventMeeting, SenderChannel } from '@slider/shared';
import { meetingUrlSchema } from '@slider/shared';
import { useState } from 'react';
import { useOpenSenderDirect, useSenderHome } from '@/lib/api';
import { useCallsOrNull } from '@/features/calls';
import { Avatar, Button, Icon, MenuDivider, MenuItem } from '@/ui';
import { useCloud } from '../../hooks/useCloud';
import { AreaMark } from '../AreaMark';
import { Picker } from '../todos/TodoList';

/** Where a meeting is held, as one says it: Sender's conversation by name, a link by its host. */
export function meetingPlace(meeting: EventMeeting, channel: SenderChannel | undefined): string {
  if (meeting.kind === 'link') return hostOf(meeting.url);
  return channel ? `Anruf in ${channel.name}` : 'Anruf in Sender';
}

/** Hosts whose links are meetings: one typed or pasted into the place becomes the meeting. */
const MEETING_HOSTS = [
  'zoom.us',
  'zoom.com',
  'meet.google.com',
  'teams.microsoft.com',
  'teams.live.com',
  'webex.com',
  'meet.jit.si',
  'whereby.com',
  'gotomeeting.com',
  'gotomeet.me',
  'meet.goto.com',
  'chime.aws',
  'facetime.apple.com',
  'join.skype.com',
];

/**
 * A meeting's link in what was typed as the place („Raum 3 zoom.us/j/123“): the link, made whole,
 * and the place without it. `null` where no word is a meeting's link.
 */
export function meetingLinkIn(text: string): { url: string; rest: string } | null {
  for (const word of text.split(/\s+/)) {
    const url = /^https?:\/\//i.test(word) ? word : `https://${word}`;
    let host: string;
    try {
      host = new URL(url).host.toLowerCase().replace(/^www\./, '');
    } catch {
      continue;
    }
    if (!MEETING_HOSTS.some((each) => host === each || host.endsWith(`.${each}`))) continue;
    const parsed = meetingUrlSchema.safeParse(url);
    if (!parsed.success) continue;
    return { url: parsed.data, rest: text.replace(word, ' ').replace(/\s+/g, ' ').trim() };
  }
  return null;
}

/** „zoom.us“, „meet.google.com“ – a link's host, the whole link if it has none. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Opens a meeting's link outside (the desktop apps hand it to the system's browser). */
export function openMeetingLink(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer');
}

/**
 * Every conversation of Sender one may call in: the areas' channels (not of an area one only
 * views – the server refuses a meeting there), groups, direct ones.
 */
export function useCallPlaces(workspaceId: string, enabled = true) {
  const ui = useCloud();
  const home = useSenderHome(workspaceId);
  const data = enabled ? home.data : undefined;
  const viewOnly = (areaId: string) =>
    ui.home?.areas.find((each) => each.id === areaId)?.access === 'view';
  const areas = (data?.areas ?? []).flatMap((area) =>
    viewOnly(area.id)
      ? []
      : area.channels.filter((channel) => channel.canWrite).map((channel) => ({ area, channel })),
  );
  // Named wherever seen, even where one may not set a call.
  const all: SenderChannel[] = [
    ...(data?.areas ?? []).flatMap((area) => area.channels),
    ...(data?.groups ?? []),
    ...(data?.direct ?? []),
  ];
  return {
    areas,
    groups: data?.groups ?? [],
    direct: data?.direct ?? [],
    people: data?.people ?? [],
    byId: (id: string) => all.find((channel) => channel.id === id),
  };
}

/** A conversation's mark: an area's own channel the area's, a channel a bubble, a group, a person. */
function PlaceMark({ channel }: { channel: SenderChannel }) {
  const ui = useCloud();
  if (channel.person) return <Avatar author={channel.person} size={18} nativeTitle={false} />;
  if (channel.kind === 'group') return <Icon name="groups" size="sm" />;
  if (channel.kind === 'channel') return <Icon name="chatBubble" size="sm" />;
  const area = ui.home?.areas.find((each) => each.id === channel.areaId);
  return area ? <AreaMark area={area} /> : <Icon name="call" size="sm" />;
}

/**
 * „Beitreten“ for a meeting: a call in Sender joined where one is (while one is in it: „Im
 * Anruf“, which brings the call up), a link opened outside.
 */
export function JoinMeeting({
  meeting,
  size = 'sm',
  variant = 'primary',
}: {
  meeting: EventMeeting;
  size?: 'xs' | 'sm';
  variant?: 'primary' | 'soft';
}) {
  const calls = useCallsOrNull();
  if (meeting.kind === 'link') {
    return (
      <Button
        size={size}
        variant={variant}
        icon="videocam"
        onClick={() => openMeetingLink(meeting.url)}
      >
        Beitreten
      </Button>
    );
  }
  if (!calls?.snap.me) return null;
  const { snap, client, setExpanded } = calls;
  if (snap.active?.channelId === meeting.channelId) {
    return (
      <Button size={size} variant="soft" icon="call" onClick={() => setExpanded(true)}>
        Im Anruf
      </Button>
    );
  }
  return (
    <Button
      size={size}
      variant={variant}
      icon="videocam"
      disabled={snap.joining !== null}
      onClick={() => void client.join(meeting.channelId, { video: true })}
    >
      Beitreten
    </Button>
  );
}

/**
 * An event's meeting, a line of the panel: none or a call in one of Sender's conversations (an
 * area's channel, a group, a person – a direct one opened where none is yet) – only the
 * workspace's own. A link elsewhere (Zoom, Meet, Teams) is not picked here: typed or pasted as the
 * place it is taken out of it (`meetingLinkIn`), shown here by its host and changed in place.
 * „Beitreten“ beside it.
 */
export function MeetingField({
  meeting,
  canEdit,
  callsAllowed,
  onChange,
}: {
  meeting: EventMeeting | null;
  canEdit: boolean;
  /** A mailbox's calendar keeps links only. */
  callsAllowed: boolean;
  onChange: (meeting: EventMeeting | null) => void;
}) {
  const ui = useCloud();
  const places = useCallPlaces(ui.workspace.id, canEdit || meeting?.kind === 'call');
  const openDirect = useOpenSenderDirect(ui.workspace.id);
  // The link being changed, kept on leaving the field (emptied: the meeting goes).
  const [typing, setTyping] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const channel = meeting?.kind === 'call' ? places.byId(meeting.channelId) : undefined;
  const linkShown = meeting?.kind === 'link';
  const keepLink = () => {
    if (typing === null) return;
    const text = typing.trim();
    setTyping(null);
    if (!text) {
      if (meeting?.kind === 'link') onChange(null);
      return;
    }
    const url = /^[a-z][\w+.-]*:/i.test(text) ? text : `https://${text}`;
    const parsed = meetingUrlSchema.safeParse(url);
    if (!parsed.success)
      return ui.notify(parsed.error.issues[0]?.message ?? 'Kein Link.', 'danger');
    if (meeting?.kind !== 'link' || meeting.url !== parsed.data) {
      onChange({ kind: 'link', url: parsed.data });
    }
  };
  const words = filter.trim().toLocaleLowerCase('de');
  const fits = (name: string) => !words || name.toLocaleLowerCase('de').includes(words);
  const directWith = new Set(
    places.direct.flatMap((each) => (each.person ? [each.person.id] : [])),
  );
  const others = places.people.filter(
    (person) => person.id !== ui.userId && !directWith.has(person.id) && fits(person.name),
  );
  const callWith = (person: AccountAuthor) =>
    openDirect.mutateAsync(person.id).then(
      (made) => onChange({ kind: 'call', channelId: made.id }),
      (error: Error) => ui.notify(error.message, 'danger'),
    );
  const label = meeting ? meetingPlace(meeting, channel) : 'Kein Meeting';

  // Nothing to pick where no call may be set (a mailbox's calendar): its link comes as the place.
  if (!meeting && (!canEdit || !callsAllowed)) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <Icon name="videocam" size="sm" className="shrink-0 text-fg-subtle" />
        <Picker
          wide
          fluid
          label={`Meeting: ${label}`}
          disabled={!canEdit}
          trigger={
            <>
              {channel && (
                <span className="flex size-5 shrink-0 items-center justify-center">
                  <PlaceMark channel={channel} />
                </span>
              )}
              <span className={meeting ? 'truncate text-fg' : 'truncate text-fg-faint'}>
                {label}
              </span>
            </>
          }
        >
          {(close) => {
            const pick = (next: EventMeeting | null) => {
              close();
              setFilter('');
              onChange(next);
            };
            return (
              <div className="-m-1 flex max-h-96 flex-col overflow-y-auto p-1">
                <MenuItem
                  role="menuitemradio"
                  aria-checked={!meeting}
                  selected={!meeting}
                  icon="close"
                  onClick={() => {
                    setTyping(null);
                    if (meeting) pick(null);
                    else close();
                  }}
                >
                  Kein Meeting
                </MenuItem>
                {meeting?.kind === 'link' && (
                  <MenuItem
                    role="menuitemradio"
                    aria-checked
                    selected
                    icon="link"
                    truncate
                    onClick={close}
                  >
                    {hostOf(meeting.url)}
                  </MenuItem>
                )}
                {callsAllowed && (
                  <>
                    <MenuDivider />
                    <label className="flex h-8 items-center gap-2 px-2 text-sm">
                      <Icon name="search" size="sm" className="shrink-0 text-fg-subtle" />
                      <input
                        value={filter}
                        placeholder="Bereich, Gruppe oder Person …"
                        aria-label="Wo angerufen wird"
                        onChange={(event) => setFilter(event.target.value)}
                        onKeyDown={(event) => {
                          // Typed letters stay in the field; Esc closes the picker as anywhere.
                          if (event.key !== 'Escape') event.stopPropagation();
                        }}
                        className="min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-fg-faint"
                      />
                    </label>
                    {[
                      ...places.areas.map((each) => each.channel),
                      ...places.groups,
                      ...places.direct,
                    ]
                      .filter((each) => fits(each.name))
                      .map((each) => (
                        <MenuItem
                          key={each.id}
                          role="menuitemradio"
                          aria-checked={meeting?.kind === 'call' && meeting.channelId === each.id}
                          selected={meeting?.kind === 'call' && meeting.channelId === each.id}
                          icon={
                            <span className="flex size-5 items-center justify-center">
                              <PlaceMark channel={each} />
                            </span>
                          }
                          truncate
                          onClick={() => {
                            setTyping(null);
                            pick({ kind: 'call', channelId: each.id });
                          }}
                        >
                          {each.name}
                        </MenuItem>
                      ))}
                    {others.map((person) => (
                      <MenuItem
                        key={person.id}
                        role="menuitemradio"
                        aria-checked={false}
                        icon={
                          <span className="flex size-5 items-center justify-center">
                            <Avatar author={person} size={18} nativeTitle={false} />
                          </span>
                        }
                        truncate
                        onClick={() => {
                          close();
                          setFilter('');
                          setTyping(null);
                          void callWith(person);
                        }}
                      >
                        {person.name}
                      </MenuItem>
                    ))}
                  </>
                )}
              </div>
            );
          }}
        </Picker>
        {meeting && <span className="ml-auto shrink-0">{<JoinMeeting meeting={meeting} />}</span>}
      </div>
      {linkShown && (
        <div className="flex items-center gap-2 pl-6">
          <input
            value={typing ?? (meeting?.kind === 'link' ? meeting.url : '')}
            readOnly={!canEdit}
            onFocus={() => {
              if (typing === null && meeting?.kind === 'link') setTyping(meeting.url);
            }}
            onChange={(event) => setTyping(event.target.value)}
            onBlur={keepLink}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
            }}
            inputMode="url"
            placeholder="https://zoom.us/j/…"
            aria-label="Link zum Meeting"
            className="h-7 min-w-0 flex-1 rounded-control-sm bg-transparent px-2 text-sm text-fg outline-none placeholder:text-fg-faint hover:bg-hover focus:bg-hover"
          />
        </div>
      )}
    </div>
  );
}
