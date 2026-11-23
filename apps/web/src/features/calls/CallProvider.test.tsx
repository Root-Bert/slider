import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountAuthor, CallState, MeResponse } from '@slider/shared';
import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/api/keys';
import { CallProvider } from './CallProvider';
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
const fake = vi.hoisted(() => ({ snap: null as unknown, listeners: new Set<() => void>() }));
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
  },
}));

afterEach(() => vi.restoreAllMocks());

describe('CallProvider', () => {
  it('shows the call one is in around the router – no router hook in the dock (it blanked the app)', () => {
    vi.spyOn(api, 'get').mockResolvedValue([]);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData<Partial<MeResponse>>(queryKeys.me, {
      user: { ...me, email: 'r@example.test', isInstanceAdmin: false },
      workspaces: [],
    } as Partial<MeResponse>);
    fake.snap = snapshot(call);
    // No <Router> on purpose: the provider sits around it in `App.tsx`.
    render(
      <QueryClientProvider client={queryClient}>
        <CallProvider navigate={() => {}} pathname={() => '/'}>
          <p>Seite</p>
        </CallProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByText('Seite')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Anruf: Anna Beck' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Agent dazuholen' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Auflegen' })).toBeTruthy();

    // An agent brought in: its tile, drawn as the workspace has its agents look.
    fake.snap = snapshot({
      ...call,
      agent: { id: 'a1', title: 'Helfer', state: 'listening', doing: null, invitedBy: anna },
    });
    act(() => fake.listeners.forEach((listener) => listener()));
    expect(screen.getByText('Hört zu – sag „Agent, …“')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Aus dem Anruf entfernen' })).toBeTruthy();

    // Twenty in the call (through the server): small, who speaks and how many; large, 4 × 4 a page.
    const guests = Array.from({ length: 18 }, (_, i) => ({
      peerId: `p${i + 3}`,
      author: { id: `u${i + 3}`, name: `Gast ${i + 3}`, type: 'owner' as const, color: 'green' as const },
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
  });
});
