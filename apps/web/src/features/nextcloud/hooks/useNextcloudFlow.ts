import { useCallback, useEffect, useRef, useState } from 'react';
import type { NextcloudLoginStart } from '@slider/shared';

/** Nextcloud's own advice is to poll the login flow every few seconds. */
export const NEXTCLOUD_POLL_MS = 2000;
/** Polls after the popup was closed before giving up (the grant may land just then). */
const POLLS_AFTER_CLOSE = 2;

export type NextcloudConnectState =
  | { status: 'idle' }
  /** `code`: what Nextcloud's grant page shows next to "Slider" (sign-in only). */
  | { status: 'waiting'; code?: string }
  | { status: 'error'; message: string };

type Unfinished = { status: 'pending' } | { status: 'expired' };

const POPUP_BLOCKED_MESSAGE =
  'Das Anmeldefenster wurde blockiert. Erlaube Popups für Slider und versuch es noch einmal.';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A Nextcloud Login Flow v2 from the browser's side (BER-135): Nextcloud's login page opens in a
 * popup – SSO and MFA happen there – while Slider asks the API every two seconds whether access
 * was granted. The app password never reaches the browser. Used to connect files
 * ({@link useNextcloudConnect}) and to sign in with any Nextcloud.
 */
export function useNextcloudFlow<Poll extends { status: string }>(
  start: (server?: string) => Promise<NextcloudLoginStart>,
  poll: (id: string) => Promise<Poll | Unfinished>,
  onFinished: (result: Exclude<Poll, Unfinished>) => void | Promise<void>,
) {
  const [state, setState] = useState<NextcloudConnectState>({ status: 'idle' });
  const run = useRef(0);
  const popupRef = useRef<Window | null>(null);
  const calls = useRef({ start, poll, onFinished });
  calls.current = { start, poll, onFinished };
  // Ends the running flow; its login popup would otherwise stay open with nobody waiting for it.
  const stop = useCallback(() => {
    run.current += 1;
    popupRef.current?.close();
    popupRef.current = null;
  }, []);
  useEffect(() => stop, [stop]);

  const connect = async (server?: string) => {
    const current = ++run.current;
    // Opened inside the click: a popup opened after an await is blocked by browsers.
    const popup = window.open('', 'slider-nextcloud', 'popup,width=520,height=720');
    // Blocked: a later window.open fails too, and polling would wait for a login nobody sees.
    if (!popup) {
      setState({ status: 'error', message: POPUP_BLOCKED_MESSAGE });
      return;
    }
    popup.opener = null;
    popupRef.current = popup;
    setState({ status: 'waiting' });
    try {
      const { id, loginUrl, code } = await calls.current.start(server);
      if (run.current !== current) return;
      if (code) setState({ status: 'waiting', code });
      popup.location.href = loginUrl;
      let afterClose = 0;
      for (;;) {
        await sleep(NEXTCLOUD_POLL_MS);
        if (run.current !== current) return;
        const result = await calls.current.poll(id);
        if (run.current !== current) return;
        if (result.status === 'expired') {
          throw new Error('Die Anmeldung ist abgelaufen. Bitte versuch es noch einmal.');
        }
        if (result.status !== 'pending') {
          popup.close();
          await calls.current.onFinished(result as Exclude<Poll, Unfinished>);
          if (run.current === current) setState({ status: 'idle' });
          return;
        }
        if (popup.closed && ++afterClose > POLLS_AFTER_CLOSE) {
          setState({ status: 'error', message: 'Anmeldung bei Nextcloud abgebrochen.' });
          return;
        }
      }
    } catch (error) {
      popup.close();
      if (run.current !== current) return;
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Verbinden fehlgeschlagen.',
      });
    }
  };

  const cancel = () => {
    stop();
    setState({ status: 'idle' });
  };

  return { state, connect, cancel };
}
