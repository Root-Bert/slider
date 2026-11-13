import {
  DESKTOP_SCHEME,
  type CloudSignInStart,
  type CloudStatus,
  type DeckEditState,
  type DesktopCode,
} from '@slider/shared';
import { useEffect, useRef } from 'react';
import { hashKey, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiRequest } from '../api-client';
import { desktopBridge, type DesktopState } from '../desktop-bridge';
import { askForFile, fileChangedElsewhere, webFilesSupported, writeDeckFile } from '../web-files';
import { queryKeys } from './keys';

/*
 * The desktop app and its Slider server (BER-201). On the server: `/desktop-anmelden` asks for a
 * one-time code and hands it to the app. In the app: the local server's sign-in to that server.
 */

const cloudKey = ['desktop', 'cloud'] as const;

/** On the server: the code for the app, then back to it through `slider://auth`. */
export async function handCodeToDesktop(challenge: string, state: string): Promise<string> {
  const { code } = await api.post<DesktopCode>('/auth/desktop/code', { challenge });
  return `${DESKTOP_SCHEME}://auth?${new URLSearchParams({ code, state }).toString()}`;
}

/**
 * In the app: the server it signs in to and the account, if signed in. Asked again when the
 * window comes back to the front – after signing in in the browser – and every few seconds while
 * signed in: the account's decks and workspaces are kept here as copies (BER-201), and when a
 * pass changed some, the lists are loaded again.
 */
export const useCloudStatus = (enabled: boolean) => {
  const client = useQueryClient();
  const seen = useRef<string | null | undefined>(undefined);
  const query = useQuery({
    queryKey: cloudKey,
    queryFn: () => api.get<CloudStatus>('/desktop/cloud'),
    enabled,
    refetchOnWindowFocus: 'always',
    refetchInterval: (q) => (q.state.data?.account ? 5_000 : false),
  });
  const changedAt = query.data?.sync?.changedAt ?? null;
  useEffect(() => {
    if (seen.current !== undefined && seen.current !== changedAt) {
      void client.invalidateQueries({ predicate: (q) => q.queryKey[0] !== cloudKey[0] });
    }
    seen.current = changedAt;
  }, [changedAt, client]);
  return query;
};

/** „Jetzt synchronisieren“: a pass now. */
export const useCloudSyncNow = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<CloudStatus>('/desktop/cloud/sync'),
    onSuccess: (status) => client.setQueryData(cloudKey, status),
  });
};

/**
 * „Anmelden“: opens the server's sign-in page in the system browser – the one signed in to last,
 * or `server`, a self-hosted one („Anderer Server“, like Bitwarden).
 */
export const useStartCloudSignIn = () =>
  useMutation({
    mutationFn: (server?: string) =>
      api.post<CloudSignInStart>('/desktop/cloud/start', server ? { server } : undefined),
    // Another origin: the desktop app opens it in the browser, not in a tab.
    onSuccess: ({ url }) => window.open(url, '_blank', 'noopener'),
  });

/** „Abmelden“: forgets the account here and ends its session on the server. */
export const useCloudSignOut = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => apiRequest<CloudStatus>('/desktop/cloud', { method: 'DELETE' }),
    onSuccess: (status) => {
      client.setQueryData(cloudKey, status);
      // The account's copies left this machine.
      void client.invalidateQueries({ predicate: (q) => q.queryKey[0] !== cloudKey[0] });
    },
  });
};

const bridgeKey = ['desktop', 'bridge'] as const;

/**
 * In the desktop app, on this computer's pages and the server's alike: what this computer adds
 * (`lib/desktop-bridge`). In the browser: `null`, nothing asked.
 */
export const useDesktopState = () => {
  const bridge = desktopBridge();
  return (
    useQuery({
      queryKey: bridgeKey,
      queryFn: () => bridge!.state(),
      enabled: bridge !== null,
      refetchOnWindowFocus: 'always',
      refetchInterval: 5_000,
    }).data ?? null
  );
};

/**
 * One deck as this computer has it: `kept` – one of the account's decks brought here, kept after
 * signing out or not (`undefined`: made here, or none); `file` – it is a file here.
 */
export const useDesktopDeck = (deckId: string) => {
  const state = useDesktopState();
  return {
    platform: state?.platform,
    kept: state?.kept[deckId],
    file: state?.files[deckId] ?? null,
  };
};

/** The bridge's state asked again (after saving as a file). */
export const useRefreshDesktopState = () => {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: bridgeKey });
};

/**
 * „Auf diesem Computer behalten“ for one of the account's decks brought here: it stays after
 * signing out. Instant: the state changes at once, a refusal puts it back.
 */
export const useKeepOnComputer = () => {
  const client = useQueryClient();
  const setKeep = (deckId: string, keep: boolean) =>
    client.setQueryData<DesktopState | null>(bridgeKey, (state) =>
      state ? { ...state, kept: { ...state.kept, [deckId]: keep } } : state,
    );
  return useMutation({
    mutationFn: async ({ deckId, keep }: { deckId: string; keep: boolean }) => {
      const done = await desktopBridge()?.keep(deckId, keep);
      if (!done) throw new Error('Das hat nicht geklappt.');
    },
    onMutate: ({ deckId, keep }) => setKeep(deckId, keep),
    onError: (_error, { deckId, keep }) => setKeep(deckId, !keep),
  });
};

/**
 * In the viewer: the deck's file on this computer was changed elsewhere (LibreOffice, a sync
 * folder) and came in as a new version – said once, when it happens.
 */
export const useFileChangedElsewhere = (deckId: string, notify: (text: string) => void) => {
  const changedAt = useDesktopDeck(deckId).file?.changedAt ?? null;
  const seen = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (seen.current !== undefined && changedAt && changedAt !== seen.current) {
      notify('Die Datei wurde außerhalb von Slider geändert. Ihre neue Version ist da.');
    }
    seen.current = changedAt;
  }, [changedAt, notify]);
};

/** A step written into the deck's file once editing has rested this long. */
const FILE_SETTLE_MS = 1500;

/**
 * In the viewer, in the browser (`web-files.ts`): a deck that is a file on this computer is
 * written once editing rests and when the page loses the front; a change made to the file
 * elsewhere comes in as a new version when it comes back. After a reload the browser lets
 * Slider at the file again on the first click or key press.
 */
export const useWebFile = (deckId: string, notify: (text: string, tone?: 'danger') => void) => {
  const client = useQueryClient();
  useEffect(() => {
    if (desktopBridge() || !webFilesSupported()) return;
    let timer: number | undefined;
    const write = () => {
      window.clearTimeout(timer);
      timer = undefined;
      void writeDeckFile(deckId).catch(() => {});
    };
    const flush = () => {
      if (timer !== undefined) write();
    };
    // A step the server took, this tab's or anyone's: `seq` moves on.
    const editKey = hashKey(queryKeys.edit(deckId));
    let seq = client.getQueryData<DeckEditState>(queryKeys.edit(deckId))?.seq;
    const unsubscribe = client.getQueryCache().subscribe((event) => {
      if (event.query.queryHash !== editKey) return;
      const next = (event.query.state.data as DeckEditState | undefined)?.seq;
      if (next === undefined || next === seq) return;
      const known = seq !== undefined;
      seq = next;
      if (!known) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(write, FILE_SETTLE_MS);
    });
    const lookAtFile = () =>
      void fileChangedElsewhere(deckId)
        .then(async (file) => {
          if (!file) return;
          const form = new FormData();
          form.append('file', file);
          await api.post(`/decks/${encodeURIComponent(deckId)}/revisions`, form);
          notify(
            'Die Datei wurde außerhalb von Slider geändert. Ihre neue Version wird übernommen.',
          );
        })
        .catch((error: unknown) => {
          if (error instanceof Error) notify(error.message, 'danger');
        });
    const ask = () =>
      void askForFile(deckId).then(
        (kept) => kept && lookAtFile(),
        () => {},
      );
    const hidden = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('blur', flush);
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('focus', lookAtFile);
    window.addEventListener('pointerdown', ask, { capture: true, once: true });
    window.addEventListener('keydown', ask, { capture: true, once: true });
    lookAtFile();
    return () => {
      unsubscribe();
      flush();
      window.removeEventListener('blur', flush);
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('focus', lookAtFile);
      window.removeEventListener('pointerdown', ask, { capture: true });
      window.removeEventListener('keydown', ask, { capture: true });
    };
  }, [client, deckId, notify]);
};
