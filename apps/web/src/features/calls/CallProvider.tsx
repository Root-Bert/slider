import {
  Component,
  createContext,
  use,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { CallState, MeResponse } from '@slider/shared';
import { queryKeys } from '@/lib/api/keys';
import { holdReload } from '@/lib/app-version';
import {
  HAND_OVER_EVENT,
  setCallStays,
  setCallToHandOver,
  takeHandOver,
} from '@/lib/call-handover';
import { mayNotify } from '@/lib/notify-prefs';
import { Toast, useToast } from '@/ui';
import { CallDock } from './components/CallDock';
import { CallAudio } from './components/CallTile';
import { IncomingCall } from './components/IncomingCall';
import { CallClient, type CallsSnapshot } from './lib/call-client';
import { agentPath, callPath, callTitle } from './lib/names';
import { ring, ringBack } from './lib/sounds';
import { wakeVoice } from './lib/speaker';

interface CallsUi {
  snap: CallsSnapshot;
  client: CallClient;
  /** Opens a call's conversation (Sender, or Cloud while one is there). */
  open: (call: CallState) => void;
  /** Opens an agent (one sent off from the call) – in Cloud while one is there, else in Sender. */
  openAgent: (workspaceId: string, agentId: string) => void;
  /** The dock fills the window. */
  expanded: boolean;
  setExpanded: (expanded: boolean) => void;
  /**
   * A page shows this call itself (the called agent's page, `CallBoxes`) – or the AI's side
   * panel does (`panel`): the corner's dock stands back while one does. Returns the undo.
   */
  host: (callId: string, place?: CallHost) => () => void;
  /** A page (not a panel) shows this call: a panel opened over it does not show it twice. */
  onPage: (callId: string) => boolean;
  /**
   * The page has an AI's side panel (open or closed – `usePanelForCalls`): the call one is in
   * stays in it and never floats over the page, unless one lets it float. Returns the undo.
   */
  panelPlace: () => () => void;
  /** The page has an AI's side panel the call can stay in. */
  panelHere: boolean;
  /** The call floats in the corner (as before) instead of staying in the side panel – kept. */
  floating: boolean;
  setFloating: (floating: boolean) => void;
  /** The call goes on in the side panel while it is closed: ✨ says so (`useCallInBackground`). */
  inBackground: boolean;
}

/** Where a call is shown instead of the corner's dock. */
export type CallHost = 'page' | 'panel';

const Context = createContext<CallsUi | null>(null);

/** The calls – `null` outside the provider (tests of single pages). */
export const useCallsOrNull = (): CallsUi | null => use(Context);

/** The calls that ring at oneself right now, the newest first. */
export const ringingAt = (snap: CallsSnapshot): CallState[] =>
  [...snap.calls.values()]
    .filter(
      (call) => !!snap.me && call.ringing.includes(snap.me) && call.id !== snap.active?.callId,
    )
    .reverse();

/** One request to take a call over – the same call handed back later is a new one. */
interface HandOver {
  callId: string;
}

const toHandOver = (callId: string | null): HandOver | null => (callId ? { callId } : null);

/** A window opened by a page (presenting): it neither rings nor calls – its opener does. */
const isPopup = () => typeof window !== 'undefined' && !!window.opener;

/**
 * Calls everywhere: around the whole app (all routes, every app of the family), so a call rings
 * on whatever page is open and goes on while one moves through Slider, Cloud, Writer or Sender.
 * It reads who is signed in from the `/me` already asked for by the page – it asks for nothing
 * itself, so pages without a login stay without a stream.
 */
export function CallProvider({
  navigate,
  pathname,
  children,
}: {
  navigate: (to: string) => void;
  /** Where the app is right now (read when a link is followed). */
  pathname: () => string;
  children: ReactNode;
}) {
  const [client] = useState(() => new CallClient());
  const snap = useSyncExternalStore(client.subscribe, client.getSnapshot);
  // Read from the cache, not observed as a query: an observer without a fetch of its own (a
  // `skipToken` one) became the query's options, and every refetch of /me then failed.
  const queryClient = useQueryClient();
  const meChanged = useCallback(
    (changed: () => void) => queryClient.getQueryCache().subscribe(changed),
    [queryClient],
  );
  const me = useSyncExternalStore(meChanged, () =>
    queryClient.getQueryData<MeResponse>(queryKeys.me),
  );
  const userId = isPopup() ? null : (me?.user?.id ?? null);
  const [toast, notify] = useToast();
  const [expanded, setExpanded] = useState(false);
  const [hosts, setHosts] = useState<readonly { callId: string; place: CallHost }[]>([]);
  const host = useCallback((callId: string, place: CallHost = 'page') => {
    const entry = { callId, place };
    setHosts((now) => [...now, entry]);
    return () => setHosts((now) => now.filter((each) => each !== entry));
  }, []);
  const onPage = useCallback(
    (callId: string) => hosts.some((each) => each.callId === callId && each.place === 'page'),
    [hosts],
  );
  const [panelPlaces, setPanelPlaces] = useState(0);
  const panelPlace = useCallback(() => {
    setPanelPlaces((now) => now + 1);
    return () => setPanelPlaces((now) => now - 1);
  }, []);
  const [floating, setFloatingState] = useState(loadFloating);
  const setFloating = useCallback((next: boolean) => {
    setFloatingState(next);
    storeFloating(next);
  }, []);

  useEffect(() => client.setTell(notify), [client, notify]);
  useEffect(() => client.signedIn(userId), [client, userId]);
  useEffect(() => () => client.signedIn(null), [client]);
  useEffect(() => {
    const away = () => client.goingAway();
    window.addEventListener('pagehide', away);
    return () => window.removeEventListener('pagehide', away);
  }, [client]);
  // A new call opens small.
  const callId = snap.active?.callId ?? null;
  // A new release waits for the call to end – a reload would leave it.
  useEffect(() => (callId ? holdReload() : undefined), [callId]);
  // A window opened for another app from here takes this call over (`windowForApp`).
  useEffect(() => {
    setCallToHandOver(callId);
    return () => setCallToHandOver(null);
  }, [callId]);
  // The desktop app leaves the call in this tab while it would lose something taken over.
  const stays = !callId
    ? null
    : !snap.local.mic
      ? 'muted'
      : snap.local.screen || snap.local.camera
        ? 'sharing'
        : null;
  useEffect(() => {
    setCallStays(stays);
    return () => setCallStays(null);
  }, [stays]);
  // Opened to take over a call (Cloud opened a presentation in Slider's window): once this window
  // hears of it, it is joined here and the other window steps out. The desktop app names its tab
  // in front later, and again each time it comes in front – each naming is one handover.
  const [handOver, setHandOver] = useState(() => toHandOver(takeHandOver()));
  // In the task of the first render: a naming comes before it (read above) or is heard.
  useLayoutEffect(() => {
    const named = () => {
      const next = toHandOver(takeHandOver());
      if (next) setHandOver(next);
    };
    window.addEventListener(HAND_OVER_EVENT, named);
    return () => window.removeEventListener(HAND_OVER_EVENT, named);
  }, []);
  const takenOver = useRef<HandOver | null>(null);
  const toTake = handOver ? snap.calls.get(handOver.callId) : undefined;
  useEffect(() => {
    if (!toTake || takenOver.current === handOver) return;
    takenOver.current = handOver;
    void client.takeOver(toTake);
    // No click here started the sound: the first one (or a key) wakes the voices that wait.
    const wake = () => {
      wakeVoice();
      for (const audio of document.querySelectorAll<HTMLAudioElement>('audio[data-call-audio]'))
        if (audio.paused) void audio.play().catch(() => {});
    };
    window.addEventListener('pointerdown', wake, { capture: true, once: true });
    window.addEventListener('keydown', wake, { capture: true, once: true });
  }, [client, toTake, handOver]);
  const [shownCall, setShownCall] = useState(callId);
  if (shownCall !== callId) {
    setShownCall(callId);
    setExpanded(false);
  }

  const incoming = ringingAt(snap);
  const ringingHere = incoming.length > 0;
  useEffect(() => (ringingHere ? ring() : undefined), [ringingHere]);
  const active = snap.active ? snap.calls.get(snap.active.callId) : undefined;
  const waiting = !!active && active.ringing.length > 0 && active.peers.length < 2;
  useEffect(() => (waiting ? ringBack() : undefined), [waiting]);

  // Not looked at: the system says who calls (once per call, if allowed already).
  const told = useRef(new Set<string>());
  useEffect(() => {
    for (const call of incoming) {
      if (told.current.has(call.id)) continue;
      told.current.add(call.id);
      if (document.hasFocus() || typeof Notification === 'undefined') continue;
      if (!mayNotify()) continue;
      const note = new Notification(`${call.startedBy.name} ruft an`, {
        body:
          call.kind === 'direct' ? (call.video ? 'Videoanruf' : 'Anruf') : callTitle(call, snap.me),
        tag: `call:${call.id}`,
        requireInteraction: true,
      });
      note.addEventListener('click', () => {
        window.focus();
        note.close();
      });
    }
  }, [incoming, snap.me]);

  // The call's own parts broke: hung up and said – never a call going on unseen, never one ringing
  // where it cannot be answered (declined, so its caller is not left waiting).
  const activeId = active?.id ?? null;
  const shown = [...(activeId ? [activeId] : []), ...incoming.map((call) => call.id)];
  const crashed = useCallback(
    (callIds: readonly string[]) => {
      if (callIds.length === 0) return;
      if (activeId && callIds.includes(activeId)) void client.leave();
      for (const id of callIds) if (id !== activeId) client.decline(id);
      notify(
        activeId
          ? 'Der Anruf wurde wegen eines Fehlers beendet.'
          : 'Ein Anruf ließ sich wegen eines Fehlers nicht zeigen und wurde abgelehnt.',
        'danger',
      );
    },
    [activeId, client, notify],
  );

  const panelHere = panelPlaces > 0;
  const hosted = !!active && hosts.some((each) => each.callId === active.id);
  // In the side panel while it is closed: nothing floats over the page – heard all the same.
  const inBackground = !!active && !expanded && !hosted && panelHere && !floating;
  const docked = !!active && !expanded && !hosted && (floating || !panelHere);

  const ui = useMemo<CallsUi>(
    () => ({
      snap,
      client,
      expanded,
      setExpanded,
      host,
      onPage,
      panelPlace,
      panelHere,
      floating,
      setFloating,
      inBackground,
      open: (call) => navigate(callPath(call, pathname())),
      openAgent: (workspaceId, agentId) => navigate(agentPath(workspaceId, agentId, pathname())),
    }),
    [
      snap,
      client,
      expanded,
      host,
      onPage,
      panelPlace,
      panelHere,
      floating,
      setFloating,
      inBackground,
      navigate,
      pathname,
    ],
  );

  return (
    <Context value={ui}>
      {children}
      <CallGuard calls={shown} onCrash={crashed}>
        {(incoming.length > 0 || active) && (
          // Beside an AI's side panel that is open, not over it.
          <div className="pointer-events-none fixed right-4 bottom-18 z-(--z-popover) flex w-[min(360px,calc(100vw-32px))] flex-col gap-2 md:[body:has([data-ai-panel])_&]:right-[424px]">
            {incoming.map((call) => (
              <IncomingCall key={call.id} call={call} />
            ))}
            {active && docked && <CallDock call={active} />}
          </div>
        )}
        {inBackground &&
          [...snap.remote].map(([peerId, media]) =>
            media.audio ? <CallAudio key={peerId} stream={media.audio} /> : null,
          )}
        {active && expanded && (
          <div className="fixed inset-3 z-(--z-popover) flex sm:inset-6">
            <CallDock call={active} />
          </div>
        )}
      </CallGuard>
      <Toast toast={toast} />
    </Context>
  );
}

const FLOATING_KEY = 'slider:call-floating';

/** Per browser: once let float, calls float until sent back to the side panel. */
function loadFloating(): boolean {
  try {
    return localStorage.getItem(FLOATING_KEY) === '1';
  } catch {
    return false;
  }
}

function storeFloating(floating: boolean) {
  try {
    if (floating) localStorage.setItem(FLOATING_KEY, '1');
    else localStorage.removeItem(FLOATING_KEY);
  } catch {
    // Without storage it holds for this page only.
  }
}

/**
 * Catches what breaks in the dock or the ringing cards: the page goes on, the calls shown are hung
 * up or declined (`onCrash`). Once the calls shown change, they show again.
 */
class CallGuard extends Component<
  { calls: readonly string[]; onCrash: (callIds: readonly string[]) => void; children: ReactNode },
  { broken: boolean; key: string }
> {
  override state = { broken: false, key: this.props.calls.join(' ') };

  /** Broken stays broken for the calls it showed; any other set (or none) is shown again. */
  static getDerivedStateFromProps(
    props: { calls: readonly string[] },
    state: { broken: boolean; key: string },
  ) {
    const key = props.calls.join(' ');
    if (key === state.key) return null;
    return { broken: false, key };
  }

  static getDerivedStateFromError() {
    return { broken: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Calls: the call broke', error, info.componentStack);
    this.props.onCrash(this.props.calls);
  }

  override render() {
    return this.state.broken ? null : this.props.children;
  }
}

/** Where an AI's side panel can show (open or closed): the call stays in it, not floating. */
export function usePanelForCalls(enabled = true): void {
  const panelPlace = use(Context)?.panelPlace;
  // Before paint: the corner's dock never flashes up as the page comes.
  useLayoutEffect(() => (enabled && panelPlace ? panelPlace() : undefined), [enabled, panelPlace]);
}

/** The call one is in goes on in the closed side panel – ✨ turns into its sign. */
export const useCallInBackground = (): boolean => use(Context)?.inBackground ?? false;

/** The calls of the provider around (inside it only). */
export function useCalls(): CallsUi {
  const ui = use(Context);
  if (!ui) throw new Error('useCalls outside CallProvider');
  return ui;
}
