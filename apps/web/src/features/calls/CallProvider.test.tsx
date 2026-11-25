import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountAuthor, CallState, MeResponse } from '@slider/shared';
import { api } from '@/lib/api-client';
import { HAND_OVER_EVENT, handOverName } from '@/lib/call-handover';
import { queryKeys } from '@/lib/api/keys';
import { CallProvider, useCallsOrNull, usePanelForCalls } from './CallProvider';
import type { CallsSnapshot } from './lib/call-client';

const me: AccountAuthor = { id: 'u1', name: 'Robert Hofmann', type: 'owner', color: 'red' };
const anna: AccountAuthor = { id: 'u2', name: 'Anna Beck', type: 'owner', color: 'blue' };

const call: CallState = {
  id: 'c1',
  workspaceId: 'w1',
  channelId: 'ch1',
  areaId: null,
  kind: 'direct',
  title: '',
  people: [me, anna],
  startedBy: me,
  startedAt: '2026-11-23T10:00:00.000Z',
  video: true,
  peers: [
    { peerId: 'p1', author: me, mic: true, camera: false, screen: false, joinedAt: '' },
    { peerId: 'p2', author: anna, mic: true, camera: false, screen: false, joinedAt: '' },
  ],
  ringing: [],
  notes: false,
  agent: null,
  orders: [],
};

const snapshot = (state: CallState): CallsSnapshot => ({
  me: me.id,
  peerId: 'p1',
  calls: new Map([[state.id, state]]),
  active: {
    callId: state.id,
    channelId: state.channelId,
    agentId: null,
    workspaceId: 'w1',
    since: 0,
  },
  joining: null,
  local: { mic: true, camera: false, screen: false },
  own: { camera: null, screen: null },
  remote: new Map(),
  speaking: new Set(),
  saying: false,
});

// The client's stream, microphone and connections stay out: only what the dock is shown matters.
const fake = vi.hoisted(() => ({
  snap: null as unknown,
  listeners: new Set<() => void>(),
  declined: [] as string[],
  taken: [] as string[],
}));
vi.mock('./lib/call-client', () => ({
  CallClient: class {
    subscribe = (listener: () => void) => {
      fake.listeners.add(listener);
      return () => fake.listeners.delete(listener);
    };
    getSnapshot = () => fake.snap;
    setTell() {}
    signedIn() {}
    goingAway() {}
    decline(callId: string) {
      fake.declined.push(callId);
    }
    takeOver(state: CallState) {
      fake.taken.push(state.id);
    }
  },
}));
// A ringing card that breaks on one call („kaputt“), to see the guard around it; no ring tone.
vi.mock('./components/IncomingCall', () => ({
  IncomingCall: ({ call }: { call: CallState }) => {
    if (call.id === 'kaputt') throw new Error('broken card');
    return <p>Klingelt {call.id}</p>;
  },
}));
vi.mock('./lib/sounds', () => ({ ring: () => () => {}, ringBack: () => () => {} }));

afterEach(() => vi.restoreAllMocks());

/** A page with an AI's side panel (closed), and a way to let the call float from its card. */
function PanelPage({ panel }: { panel: boolean }) {
  usePanelForCalls(panel);
  const calls = useCallsOrNull();
  return (
    <button type="button" onClick={() => calls?.setFloating(true)}>
      Schweben
    </button>
  );
}

describe('CallProvider', () => {
  it('shows the call one is in around the router – no router hook in the dock (it blanked the app)', async () => {
    // The workspace's members: oneself, Anna (in the call) and Ben – only Ben can be rung in.
    const member = (person: AccountAuthor) => ({
      userId: person.id,
      name: person.name,
      color: person.color,
    });
    vi.spyOn(api, 'get').mockImplementation((path: string) =>
      Promise.resolve(
        path.endsWith('/members')
          ? [member(me), member(anna), member({ ...anna, id: 'u9', name: 'Ben Wolf' })]
          : [],
      ),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData<Partial<MeResponse>>(queryKeys.me, {
      user: {
        ...me,
        email: 'r@example.test',
        isInstanceAdmin: false,
        showExtensions: false,
        meetingNoticeMinutes: 5,
      },
      workspaces: [],
    } as Partial<MeResponse>);
    fake.snap = snapshot(call);
    // Opened by another window of one's own to take its call over (`windowForApp`).
    window.name = 'slider-call:c1';
    // No <Router> on purpose: the provider sits around it in `App.tsx`.
    const page = (panel: boolean) => (
      <QueryClientProvider client={queryClient}>
        <CallProvider navigate={() => {}} pathname={() => '/'}>
          <p>Seite</p>
          <PanelPage panel={panel} />
        </CallProvider>
      </QueryClientProvider>
    );
    const { rerender } = render(page(false));
    expect(screen.getByText('Seite')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Anruf: Anna Beck' })).toBeTruthy();
    // Taken over once it is heard of, the name read once; a window opened from here takes it on.
    expect(fake.taken).toEqual(['c1']);
    expect(window.name).toBe('');
    expect(handOverName()).toBe('slider-call:c1');
    // The desktop app reads it off the page and names its tab in front later, again and again
    // (`desktop/tabs.mjs`): each naming is one more takeover; unmuted, nothing shared, it may move.
    expect(document.documentElement.dataset.call).toBe('c1');
    expect('callStays' in document.documentElement.dataset).toBe(false);
    act(() => {
      window.name = 'slider-call:c1';
      window.dispatchEvent(new Event(HAND_OVER_EVENT));
    });
    expect(fake.taken).toEqual(['c1', 'c1']);
    expect(window.name).toBe('');
    expect(screen.getByRole('button', { name: 'Auflegen' })).toBeTruthy();
    // „Hinzufügen“: a new agent first, marked on open; then the members not in the call.
    fireEvent.click(screen.getByRole('button', { name: 'Hinzufügen' }));
    await waitFor(() =>
      expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
        'Neuer Agent',
        'Ben Wolf',
      ]),
    );
    expect(document.activeElement?.textContent).toBe('Neuer Agent');
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });

    // An agent brought in: its tile, drawn as the workspace has its agents look.
    fake.snap = snapshot({
      ...call,
      agent: { id: 'a1', title: 'Helfer', state: 'listening', doing: null, invitedBy: anna },
    });
    act(() => fake.listeners.forEach((listener) => listener()));
    expect(screen.getByText('Hört zu – sag „Agent, …“')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Aus dem Anruf entfernen' })).toBeTruthy();
    // With an agent in the call only people are added.
    expect(screen.getByRole('button', { name: 'Person dazuholen' })).toBeTruthy();

    // Twenty in the call (through the server): small, who speaks and how many; large, 4 × 4 a page.
    const guests = Array.from({ length: 18 }, (_, i) => ({
      peerId: `p${i + 3}`,
      author: {
        id: `u${i + 3}`,
        name: `Gast ${i + 3}`,
        type: 'owner' as const,
        color: 'green' as const,
      },
      mic: true,
      camera: false,
      screen: false,
      joinedAt: '',
    }));
    fake.snap = snapshot({ ...call, kind: 'group', peers: [...call.peers, ...guests] });
    act(() => fake.listeners.forEach((listener) => listener()));
    expect(screen.queryAllByText(/^Gast \d+$/)).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: /20 im Anruf/ }));
    expect(screen.getByText('1 / 2')).toBeTruthy();
    expect(screen.queryAllByText(/^Gast \d+$/)).toHaveLength(14);
    fireEvent.click(screen.getByRole('button', { name: 'Nächste Seite' }));
    expect(screen.getByText('2 / 2')).toBeTruthy();
    expect(screen.queryAllByText(/^Gast \d+$/).map((label) => label.textContent)).toEqual([
      'Gast 17',
      'Gast 18',
      'Gast 19',
      'Gast 20',
    ]);

    // A page with the AI's side panel, closed: the call stays in it – no dock over the page, Anna
    // heard all the same. „Schweben lassen“ floats it („In die Seitenleiste“ sends it back,
    // kept); a page without a panel lets it float as before.
    fireEvent.click(screen.getByRole('button', { name: 'Verkleinern' }));
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    fake.snap = {
      ...snapshot(call),
      remote: new Map([
        [
          'p2',
          { audio: new MediaStream(), camera: null, screen: null, state: 'connected' as const },
        ],
      ]),
    };
    act(() => fake.listeners.forEach((listener) => listener()));
    const dock = () => screen.queryByRole('region', { name: 'Anruf: Anna Beck' });
    expect(dock()).toBeTruthy();
    rerender(page(true));
    expect(dock()).toBeNull();
    expect(document.querySelectorAll('audio[data-call-audio]')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Schweben' }));
    expect(dock()).toBeTruthy();
    expect(document.querySelectorAll('audio[data-call-audio]')).toHaveLength(1);
    expect(localStorage.getItem('slider:call-floating')).toBe('1');
    fireEvent.click(screen.getByRole('button', { name: 'In die Seitenleiste' }));
    expect(dock()).toBeNull();
    expect(localStorage.getItem('slider:call-floating')).toBeNull();
    rerender(page(false));
    expect(dock()).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'In die Seitenleiste' })).toBeNull();

    // A ringing card that breaks with no call going on: declined and said – and the next call
    // that rings shows again (the guard once stayed blank for good).
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const ringing = (id: string): CallsSnapshot => ({
      ...snapshot({ ...call, id, peers: [call.peers[1]!], ringing: [me.id] }),
      active: null,
    });
    fake.snap = ringing('kaputt');
    act(() => fake.listeners.forEach((listener) => listener()));
    expect(fake.declined).toEqual(['kaputt']);
    expect(
      screen.getByText('Ein Anruf ließ sich wegen eines Fehlers nicht zeigen und wurde abgelehnt.'),
    ).toBeTruthy();
    fake.snap = ringing('c2');
    act(() => fake.listeners.forEach((listener) => listener()));
    expect(screen.getByText('Klingelt c2')).toBeTruthy();
  });
});
