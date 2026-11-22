import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { CallState, MeResponse } from '@slider/shared';
import { queryKeys } from '@/lib/api/keys';
import { mayNotify } from '@/lib/notify-prefs';
import { Toast, useToast } from '@/ui';
import { CallDock } from './components/CallDock';
import { IncomingCall } from './components/IncomingCall';
import { CallClient, type CallsSnapshot } from './lib/call-client';
import { agentPath, callPath, callTitle } from './lib/names';
import { ring, ringBack } from './lib/sounds';

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
   * A page shows this call itself (the called agent's page, `CallBoxes`): the corner's dock
   * stands back while it does. Returns the undo.
   */
  host: (callId: string) => () => void;
}

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
  const [hosted, setHosted] = useState<string | null>(null);
  const host = useCallback((callId: string) => {
    setHosted(callId);
    return () => setHosted((now) => (now === callId ? null : now));
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

  const ui = useMemo<CallsUi>(
    () => ({
      snap,
      client,
      expanded,
      setExpanded,
      host,
      open: (call) => navigate(callPath(call, pathname())),
      openAgent: (workspaceId, agentId) => navigate(agentPath(workspaceId, agentId, pathname())),
    }),
    [snap, client, expanded, host, navigate, pathname],
  );

  return (
    <Context value={ui}>
      {children}
      {(incoming.length > 0 || active) && (
        <div className="pointer-events-none fixed right-4 bottom-18 z-(--z-popover) flex w-[min(360px,calc(100vw-32px))] flex-col gap-2">
          {incoming.map((call) => (
            <IncomingCall key={call.id} call={call} />
          ))}
          {active && !expanded && active.id !== hosted && <CallDock call={active} />}
        </div>
      )}
      {active && expanded && (
        <div className="fixed inset-3 z-(--z-popover) flex sm:inset-6">
          <CallDock call={active} />
        </div>
      )}
      <Toast toast={toast} />
    </Context>
  );
}

/** The calls of the provider around (inside it only). */
export function useCalls(): CallsUi {
  const ui = use(Context);
  if (!ui) throw new Error('useCalls outside CallProvider');
  return ui;
}
