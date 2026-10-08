import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FilePickerSession } from '@slider/shared';
import { runPicker } from './onedrive-picker';

// No DOM in these tests: a fake host window, a fake popup and Node's real MessageChannel.

const SESSION: FilePickerSession = {
  account: 'business',
  baseUrl: 'https://contoso-my.sharepoint.com',
  pickerUrl: 'https://contoso-my.sharepoint.com/_layouts/15/FilePicker.aspx',
};

interface FakeForm {
  attributes: Record<string, string>;
  children: { attributes: Record<string, string> }[];
  submitted: boolean;
}

function fakePopup() {
  const forms: FakeForm[] = [];
  const element = () => {
    const node = {
      attributes: {} as Record<string, string>,
      children: [] as { attributes: Record<string, string> }[],
      submitted: false,
      setAttribute(name: string, value: string) {
        node.attributes[name] = value;
      },
      appendChild(child: { attributes: Record<string, string> }) {
        node.children.push(child);
      },
      submit() {
        node.submitted = true;
      },
    };
    return node;
  };
  const popup = {
    closed: false,
    close: vi.fn(() => {
      popup.closed = true;
    }),
    document: {
      createElement: element,
      body: { append: (form: FakeForm) => forms.push(form) },
    },
  };
  return { popup, forms };
}

let host: EventTarget;
beforeEach(() => {
  host = Object.assign(new EventTarget(), {
    location: { origin: 'http://localhost:5173' },
    setInterval: (fn: () => void, ms: number) => setInterval(fn, ms),
    clearInterval: (id: ReturnType<typeof setInterval>) => clearInterval(id),
  });
  vi.stubGlobal('window', host);
});
afterEach(() => vi.unstubAllGlobals());

/** The picker page announcing itself, as Microsoft's page does after loading. */
function initialize(popup: object, channelId: string) {
  const channel = new MessageChannel();
  const event = Object.assign(new Event('message'), {
    source: popup,
    data: { type: 'initialize', channelId },
    ports: [channel.port2],
  });
  host.dispatchEvent(event);
  const received: { type: string; id?: string; data?: Record<string, unknown> }[] = [];
  channel.port1.onmessage = (message) => received.push(message.data as (typeof received)[number]);
  return { port: channel.port1, received };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

describe('runPicker', () => {
  it('loads the picker in "Geteilt", answers token requests and returns the picked file', async () => {
    const { popup, forms } = fakePopup();
    const getToken = vi.fn(async (resource: string) => `token for ${resource}`);
    const result = runPicker(popup as unknown as Window, SESSION, getToken);
    await tick();

    const form = forms[0]!;
    expect(form.submitted).toBe(true);
    expect(form.attributes['method']).toBe('POST');
    const action = new URL(form.attributes['action']!);
    expect(`${action.origin}${action.pathname}`).toBe(SESSION.pickerUrl);
    const options = JSON.parse(action.searchParams.get('filePicker') ?? '{}');
    expect(options.entry).toEqual({ oneDrive: { sharedWithMe: {} } });
    expect(options.typesAndSources.filters).toEqual(['.pptx']);
    expect(options.messaging.origin).toBe('http://localhost:5173');
    expect(form.children[0]!.attributes['value']).toBe(`token for ${SESSION.baseUrl}`);

    const { port, received } = initialize(popup, options.messaging.channelId);
    await tick();
    expect(received).toEqual([{ type: 'activate' }]);

    port.postMessage({
      type: 'command',
      id: 'c1',
      data: { command: 'authenticate', resource: 'https://contoso.sharepoint.com' },
    });
    await tick();
    expect(received.slice(1)).toEqual([
      { type: 'acknowledge', id: 'c1' },
      {
        type: 'result',
        id: 'c1',
        data: { result: 'token', token: 'token for https://contoso.sharepoint.com' },
      },
    ]);

    port.postMessage({
      type: 'command',
      id: 'c2',
      data: { command: 'pick', items: [{ id: 'ITEM!1', parentReference: { driveId: 'b!d' } }] },
    });
    expect(await result).toEqual({ driveId: 'b!d', itemId: 'ITEM!1' });
    expect(popup.close).toHaveBeenCalled();
  });

  it('ignores messages from other windows or channels', async () => {
    const { popup } = fakePopup();
    void runPicker(popup as unknown as Window, SESSION, async () => 'token');
    await tick();
    const { received } = initialize({}, 'whatever');
    await tick();
    expect(received).toEqual([]);
    popup.close();
  });

  it('resolves with null when the person closes the window', async () => {
    const { popup } = fakePopup();
    const result = runPicker(popup as unknown as Window, SESSION, async () => 'token');
    await tick();
    popup.closed = true;
    expect(await result).toBeNull();
  });
});
