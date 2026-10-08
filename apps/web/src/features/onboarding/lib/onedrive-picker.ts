import type { FilePickerSession } from '@slider/shared';

/**
 * Microsoft's OneDrive File Picker v8 (https://aka.ms/OneDrive/file-picker): a page Microsoft
 * hosts, embedded here in an iframe. The page is loaded by POSTing a form with the configuration
 * and a first token into the frame; afterwards it talks to Slider over a MessagePort – it asks
 * for tokens (`authenticate`), hands back the picked file (`pick`) or gives up (`close`).
 * Tokens come from the API.
 */

export interface PickedDriveItem {
  driveId: string;
  itemId: string;
}

function pickerOptions(channelId: string) {
  return {
    sdk: '8.0',
    // Start in "Geteilt": files others shared – the reason this picker exists in Slider.
    entry: { oneDrive: { sharedWithMe: {} } },
    // Present (even empty) → the host answers `authenticate`; required for an iframe.
    authentication: {},
    messaging: { origin: window.location.origin, channelId },
    typesAndSources: {
      mode: 'files',
      filters: ['.pptx'],
      pivots: { oneDrive: true, recent: true, shared: true },
    },
    selection: { mode: 'single' },
    commands: { pick: { label: 'Öffnen' } },
    theme: 'dark',
  };
}

/** Posts the configuration and the first token to Microsoft's picker page inside `frame`. */
function loadPicker(
  frame: HTMLIFrameElement,
  session: FilePickerSession,
  channelId: string,
  token: string,
) {
  const query = new URLSearchParams({
    filePicker: JSON.stringify(pickerOptions(channelId)),
    locale: 'de-de',
  });
  const doc = frame.ownerDocument;
  const form = doc.createElement('form');
  form.setAttribute('action', `${session.pickerUrl}?${query.toString()}`);
  form.setAttribute('method', 'POST');
  form.setAttribute('target', frame.name);
  form.hidden = true;
  const input = doc.createElement('input');
  input.setAttribute('type', 'hidden');
  input.setAttribute('name', 'access_token');
  input.setAttribute('value', token);
  form.appendChild(input);
  doc.body.append(form);
  form.submit();
  form.remove();
}

interface PickerCommand {
  command: string;
  resource?: string;
  items?: { id?: string; parentReference?: { driveId?: string } }[];
}

interface PickerMessage {
  type: string;
  id?: string;
  data?: PickerCommand & { notification?: string };
}

export interface RunPickerOptions {
  frame: HTMLIFrameElement;
  session: FilePickerSession;
  getToken: (resource: string) => Promise<string>;
  /** Aborting (e.g. closing the dialog) ends the picker with `null`. */
  signal: AbortSignal;
  /** The picker page is loaded and can be used. */
  onReady?: () => void;
}

/**
 * Runs the picker in `frame` until the person picks a file (→ its ids), cancels (→ `null`) or
 * `signal` aborts (→ `null`). `getToken` answers the picker's token requests.
 */
export async function runPicker({
  frame,
  session,
  getToken,
  signal,
  onReady,
}: RunPickerOptions): Promise<PickedDriveItem | null> {
  const channelId = crypto.randomUUID();
  const firstToken = await getToken(session.baseUrl);
  if (signal.aborted) return null;
  loadPicker(frame, session, channelId, firstToken);

  return new Promise((resolve) => {
    let port: MessagePort | null = null;
    let done = false;

    const finish = (result: PickedDriveItem | null) => {
      if (done) return;
      done = true;
      window.removeEventListener('message', onWindowMessage);
      signal.removeEventListener('abort', onAbort);
      port?.close();
      resolve(result);
    };
    const onAbort = () => finish(null);

    const reply = (id: string | undefined, data: Record<string, unknown>) =>
      port?.postMessage({ type: 'result', id, data });

    const onCommand = async (message: PickerMessage) => {
      const command = message.data;
      port?.postMessage({ type: 'acknowledge', id: message.id });
      switch (command?.command) {
        case 'authenticate':
          try {
            const token = await getToken(command.resource ?? session.baseUrl);
            reply(message.id, { result: 'token', token });
          } catch (error) {
            reply(message.id, {
              result: 'error',
              error: { code: 'unableToObtainToken', message: (error as Error).message },
            });
          }
          break;
        case 'pick': {
          const item = command.items?.[0];
          const driveId = item?.parentReference?.driveId;
          if (!item?.id || !driveId) {
            reply(message.id, {
              result: 'error',
              error: { code: 'unusableItem', message: 'Keine Datei ausgewählt.' },
            });
            break;
          }
          reply(message.id, { result: 'success' });
          finish({ driveId, itemId: item.id });
          break;
        }
        case 'close':
          finish(null);
          break;
        default:
          reply(message.id, {
            result: 'error',
            error: { code: 'unsupportedCommand', message: command?.command ?? '' },
          });
      }
    };

    // The picker announces itself on the window, then talks over the port it hands over.
    function onWindowMessage(event: MessageEvent) {
      if (!frame.contentWindow || event.source !== frame.contentWindow) return;
      const message = event.data as { type?: string; channelId?: string };
      if (message.type !== 'initialize' || message.channelId !== channelId) return;
      port = event.ports[0] ?? null;
      if (!port) return;
      port.addEventListener('message', (portEvent: MessageEvent<PickerMessage>) => {
        const data = portEvent.data;
        if (data.type === 'command') void onCommand(data);
        else if (data.type === 'notification' && data.data?.notification === 'page-loaded') {
          onReady?.();
        }
      });
      port.start();
      port.postMessage({ type: 'activate' });
    }

    window.addEventListener('message', onWindowMessage);
    signal.addEventListener('abort', onAbort);
  });
}
