import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FilePickerSession } from '@slider/shared';
import { runPicker } from './onedrive-picker';

// No DOM in these tests: a fake host window and document, a fake iframe and Node's real
// MessageChannel.

const SESSION: FilePickerSession = {
  account: 'business',
  baseUrl: 'https://contoso-my.sharepoint.com',
  pickerUrl: 'https://contoso-my.sharepoint.com/_layouts/15/FilePicker.aspx',
};

interface FakeElement {
  attributes: Record<string, string>;
  children: FakeElement[];
  hidden: boolean;
  submitted: boolean;
  removed: boolean;
  setAttribute(name: string, value: string): void;
  appendChild(child: FakeElement): void;
  submit(): void;
  remove(): void;
}

function fakeFrame() {
  const forms: FakeElement[] = [];
  const element = (): FakeElement => {
    const node: FakeElement = {
      attributes: {},
      children: [],
      hidden: false,
      submitted: false,
      removed: false,
      setAttribute: (name, value) => {
        node.attributes[name] = value;
      },
      appendChild: (child) => node.children.push(child),
      submit: () => {
        node.submitted = true;
      },
      remove: () => {
        node.removed = true;
      },
    };
    return node;
  };
  const contentWindow = {};
  const frame = {
    name: 'slider-onedrive-picker',
    contentWindow,
    ownerDocument: {
      createElement: element,
      body: { append: (form: FakeElement) => forms.push(form) },
    },
  };
  return { frame: frame as unknown as HTMLIFrameElement, contentWindow, forms };
}

let host: EventTarget;
beforeEach(() => {
  host = Object.assign(new EventTarget(), { location: { origin: 'http://localhost:5173' } });
  vi.stubGlobal('window', host);
});
afterEach(() => vi.unstubAllGlobals());

/** The picker page announcing itself, as Microsoft's page does after loading. */
function initialize(source: object, channelId: string) {
  const channel = new MessageChannel();
  const event = Object.assign(new Event('message'), {
    source,
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
    const { frame, contentWindow, forms } = fakeFrame();
    const getToken = vi.fn(async (resource: string) => `token for ${resource}`);
    const onReady = vi.fn();
    const result = runPicker({
      frame,
      session: SESSION,
      getToken,
      signal: new AbortController().signal,
      onReady,
    });
    await tick();

    const form = forms[0]!;
    expect(form.submitted).toBe(true);
    expect(form.removed).toBe(true);
    expect(form.attributes['method']).toBe('POST');
    expect(form.attributes['target']).toBe('slider-onedrive-picker');
    const action = new URL(form.attributes['action']!);
    expect(`${action.origin}${action.pathname}`).toBe(SESSION.pickerUrl);
    const options = JSON.parse(action.searchParams.get('filePicker') ?? '{}');
    expect(options.entry).toEqual({ oneDrive: { sharedWithMe: {} } });
    expect(options.typesAndSources.filters).toEqual(['.pptx']);
    expect(options.messaging.origin).toBe('http://localhost:5173');
    expect(form.children[0]!.attributes['value']).toBe(`token for ${SESSION.baseUrl}`);

    const { port, received } = initialize(contentWindow, options.messaging.channelId);
    await tick();
    expect(received).toEqual([{ type: 'activate' }]);

    port.postMessage({ type: 'notification', data: { notification: 'page-loaded' } });
    await tick();
    expect(onReady).toHaveBeenCalled();

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
  });

  it('ignores messages from other windows', async () => {
    const { frame } = fakeFrame();
    const controller = new AbortController();
    void runPicker({
      frame,
      session: SESSION,
      getToken: async () => 't',
      signal: controller.signal,
    });
    await tick();
    const { received } = initialize({}, 'whatever');
    await tick();
    expect(received).toEqual([]);
    controller.abort();
  });

  it('resolves with null on "Abbrechen" and when the dialog closes', async () => {
    const { frame, contentWindow, forms } = fakeFrame();
    const cancelled = runPicker({
      frame,
      session: SESSION,
      getToken: async () => 't',
      signal: new AbortController().signal,
    });
    await tick();
    const channelId = JSON.parse(
      new URL(forms[0]!.attributes['action']!).searchParams.get('filePicker')!,
    ).messaging.channelId;
    const { port } = initialize(contentWindow, channelId);
    await tick();
    port.postMessage({ type: 'command', id: 'c1', data: { command: 'close' } });
    expect(await cancelled).toBeNull();

    const controller = new AbortController();
    const aborted = runPicker({
      frame: fakeFrame().frame,
      session: SESSION,
      getToken: async () => 't',
      signal: controller.signal,
    });
    await tick();
    controller.abort();
    expect(await aborted).toBeNull();
  });
});
