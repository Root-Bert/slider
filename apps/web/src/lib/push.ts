import { api, apiRequest } from './api-client';

/*
 * Web Push: Sender tells while no tab of it is open – the service worker (`public/sw.js`) shows
 * what the server pushes (`services/web-push.ts`). Only where the worker runs (builds, not Vite's
 * dev server) and not in Sender's desktop app, whose window tells by itself while it runs.
 */

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || window.senderDesktop) {
    return null;
  }
  return (await navigator.serviceWorker.getRegistration()) ?? null;
}

const toBase64Url = (buffer: ArrayBuffer | null) =>
  buffer
    ? btoa(String.fromCharCode(...new Uint8Array(buffer)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '')
    : '';

const fromBase64Url = (text: string) =>
  Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0));

/**
 * Pushes on (notifications allowed and not silenced here) or off. On: this browser is the signed
 * in account's – subscribed anew when the server's key changed. Off: it is told nothing more.
 */
export async function syncPush(on: boolean): Promise<void> {
  try {
    const worker = await registration();
    if (!worker) return;
    let current = await worker.pushManager.getSubscription();
    if (!on) {
      if (!current) return;
      const { endpoint } = current;
      await current.unsubscribe();
      await apiRequest<void>('/push/subscription', { method: 'DELETE', body: { endpoint } });
      return;
    }
    const { publicKey } = await api.get<{ publicKey: string }>('/push/key');
    if (current && toBase64Url(current.options.applicationServerKey) !== publicKey) {
      await current.unsubscribe();
      current = null;
    }
    const subscription =
      current ??
      (await worker.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: fromBase64Url(publicKey),
      }));
    const { endpoint, keys } = subscription.toJSON();
    await api.put<void>('/push/subscription', { endpoint, keys });
  } catch {
    // No push service (a private window, blocked): the open page still tells.
  }
}

/** Signed out or switched: this browser tells the account that left nothing more. */
export async function dropPush(): Promise<void> {
  try {
    await (await (await registration())?.pushManager.getSubscription())?.unsubscribe();
  } catch {
    // Nothing subscribed.
  }
}
