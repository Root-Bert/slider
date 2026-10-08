import type { FilePickerSession } from '@slider/shared';

/**
 * Microsoft's OneDrive File Picker v8 (https://aka.ms/OneDrive/file-picker): a page Microsoft
 * hosts, opened here in a popup. The page is loaded by POSTing a form with the configuration;
 * afterwards it talks to Slider over a MessagePort – it asks for tokens (`authenticate`), hands
 * back the picked file (`pick`) or gives up (`close`). Tokens come from the API.
 */

export interface PickedDriveItem {
  driveId: string;
  itemId: string;
}

/** Recommended maximum size of the picker window. */
const WIDTH = 1080;
const HEIGHT = 680;
const CLOSED_POLL_MS = 500;

/** Opens the (still empty) popup. Must run inside the click handler, or browsers block it. */
export function openPickerWindow(): Window | null {
  const left = Math.max(0, window.screenX + (window.outerWidth - WIDTH) / 2);
  const top = Math.max(0, window.screenY + (window.outerHeight - HEIGHT) / 2);
  return window.open(
    '',
    'slider-onedrive-picker',
    `popup,width=${WIDTH},height=${HEIGHT},left=${Math.round(left)},top=${Math.round(top)}`,
  );
}

function pickerOptions(channelId: string) {
  return {
    sdk: '8.0',
    // Start in "Geteilt": files others shared – the reason this picker exists in Slider.
    entry: { oneDrive: { sharedWithMe: {} } },
    // Present (even empty) → the host answers `authenticate` and gets full item data.
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

/** Posts the configuration to Microsoft's picker page inside `popup`. */
function loadPicker(popup: Window, session: FilePickerSession, channelId: string, token: string) {
  const query = new URLSearchParams({
    filePicker: JSON.stringify(pickerOptions(channelId)),
    locale: 'de-de',
  });
  const doc = popup.document;
  const form = doc.createElement('form');
  form.setAttribute('action', `${session.pickerUrl}?${query.toString()}`);
  form.setAttribute('method', 'POST');
  const input = doc.createElement('input');
  input.setAttribute('type', 'hidden');
  input.setAttribute('name', 'access_token');
  input.setAttribute('value', token);
  form.appendChild(input);
  doc.body.append(form);
  form.submit();
}

interface PickerCommand {
  command: string;
  resource?: string;
  items?: { id?: string; parentReference?: { driveId?: string } }[];
}

interface PickerMessage {
  type: string;
  id?: string;
  data?: PickerCommand;
}

/**
 * Runs the picker in `popup` until the person picks a file (→ its ids) or closes it (→ `null`).
 * `getToken` answers the picker's token requests; the first token loads the page.
 */
export async function runPicker(
  popup: Window,
  session: FilePickerSession,
  getToken: (resource: string) => Promise<string>,
): Promise<PickedDriveItem | null> {
  const channelId = crypto.randomUUID();
  loadPicker(popup, session, channelId, await getToken(session.baseUrl));

  return new Promise((resolve) => {
    let port: MessagePort | null = null;
    let done = false;

    const finish = (result: PickedDriveItem | null) => {
      if (done) return;
      done = true;
      window.removeEventListener('message', onWindowMessage);
      window.clearInterval(closedPoll);
      port?.close();
      if (!popup.closed) popup.close();
      resolve(result);
    };

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
      if (event.source !== popup) return;
      const message = event.data as { type?: string; channelId?: string };
      if (message.type !== 'initialize' || message.channelId !== channelId) return;
      port = event.ports[0] ?? null;
      if (!port) return;
      port.addEventListener('message', (portEvent: MessageEvent<PickerMessage>) => {
        if (portEvent.data.type === 'command') void onCommand(portEvent.data);
      });
      port.start();
      port.postMessage({ type: 'activate' });
    }

    window.addEventListener('message', onWindowMessage);
    // Closing the window with the browser's own button sends no `close` command.
    const closedPoll = window.setInterval(() => {
      if (popup.closed) finish(null);
    }, CLOSED_POLL_MS);
  });
}
