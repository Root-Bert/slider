import {
  createCipheriv,
  createECDH,
  createPrivateKey,
  hkdfSync,
  randomBytes,
  sign,
  type KeyObject,
} from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import type { PushSubscriptionInput } from '@slider/shared';
import { pushSubscriptions } from '../db/schema';
import type { AppDeps } from '../deps';
import { badRequest } from '../http/errors';

/*
 * Web Push (RFC 8030): Sender tells a browser while no tab of it is open – the service worker
 * (`public/sw.js`) shows the notification. The message is encrypted for the browser (RFC 8291,
 * `aes128gcm`) and the server names itself with VAPID (RFC 8292). Its key pair comes from
 * `SLIDER_SECRET`: nothing to configure, the same after a restart – a new secret means every
 * browser subscribes anew (the page does that by itself when the key it holds differs).
 */

type Deps = Pick<AppDeps, 'db' | 'config' | 'clock' | 'log'>;

/** What the service worker shows: as the page's own notification (`features/sender/lib/notify.ts`). */
export interface PushNotice {
  title: string;
  body: string;
  /** A newer one of the same conversation takes the older one's place. */
  tag: string;
  /** Opened on a click: a path of the app. */
  url: string;
}

interface Vapid {
  /** The public key as the browser takes it (`applicationServerKey`): 65 bytes, base64url. */
  publicKey: string;
  privateKey: KeyObject;
}

const vapidBySecret = new Map<string, Vapid>();

/** The server's VAPID key pair, from its secret. */
export function vapidOf(secret: string): Vapid {
  const known = vapidBySecret.get(secret);
  if (known) return known;
  const d = Buffer.from(hkdfSync('sha256', secret, 'slider-web-push', 'vapid-p256', 32));
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(d);
  const pub = ecdh.getPublicKey();
  const privateKey = createPrivateKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      d: d.toString('base64url'),
      x: pub.subarray(1, 33).toString('base64url'),
      y: pub.subarray(33, 65).toString('base64url'),
    },
    format: 'jwk',
  });
  const vapid = { publicKey: pub.toString('base64url'), privateKey };
  vapidBySecret.set(secret, vapid);
  return vapid;
}

/** `Authorization: vapid …` for one push service, good for 12 hours. */
function vapidHeader(deps: Deps, endpoint: string): string {
  const vapid = vapidOf(deps.config.secret);
  const json = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  // A push service wants a way to reach who runs the server: its address if it is https.
  const origin = deps.config.webOrigin;
  const sub = origin.startsWith('https://') ? origin : 'mailto:push@slider.invalid';
  const unsigned = `${json({ typ: 'JWT', alg: 'ES256' })}.${json({
    aud: new URL(endpoint).origin,
    exp: Math.floor(deps.clock.now().getTime() / 1000) + 12 * 60 * 60,
    sub,
  })}`;
  const signature = sign('sha256', Buffer.from(unsigned), {
    key: vapid.privateKey,
    dsaEncoding: 'ieee-p1363',
  });
  return `vapid t=${unsigned}.${signature.toString('base64url')}, k=${vapid.publicKey}`;
}

/** The message encrypted for the browser (RFC 8291): one record, `aes128gcm`. */
export function encryptFor(p256dh: string, auth: string, plain: Buffer): Buffer {
  const browserKey = Buffer.from(p256dh, 'base64url');
  const authSecret = Buffer.from(auth, 'base64url');
  const ecdh = createECDH('prime256v1');
  const serverKey = ecdh.generateKeys();
  const shared = ecdh.computeSecret(browserKey);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), browserKey, serverKey]);
  const ikm = Buffer.from(hkdfSync('sha256', shared, authSecret, keyInfo, 32));
  const salt = randomBytes(16);
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, 'Content-Encoding: aes128gcm\0', 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, 'Content-Encoding: nonce\0', 12));
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  // 0x02: the last (and only) record.
  const body = Buffer.concat([
    cipher.update(Buffer.concat([plain, Buffer.from([2])])),
    cipher.final(),
  ]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(serverKey.length, 20);
  return Buffer.concat([header, serverKey, body, cipher.getAuthTag()]);
}

/**
 * The browsers' push services – the only places a push goes, so an address someone hands in
 * cannot make the server knock on a host of its own network.
 */
const PUSH_SERVICES = [
  'fcm.googleapis.com',
  'push.services.mozilla.com',
  'push.apple.com',
  'notify.windows.com',
];

/** Whether `endpoint` is a push service's https address. */
export function isPushService(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return (
      url.protocol === 'https:' &&
      url.port === '' &&
      PUSH_SERVICES.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))
    );
  } catch {
    return false;
  }
}

/** A browser lets the caller be told (signed in there as someone else before: it moves). */
export async function subscribePush(
  deps: Deps,
  userId: string,
  input: PushSubscriptionInput,
): Promise<void> {
  if (!isPushService(input.endpoint)) throw badRequest('Kein Push-Dienst eines Browsers.');
  await deps.db
    .insert(pushSubscriptions)
    .values({
      id: crypto.randomUUID(),
      userId,
      endpoint: input.endpoint,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      createdAt: deps.clock.now(),
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { userId, p256dh: input.keys.p256dh, auth: input.keys.auth },
    });
}

/** The browser no longer tells the caller (silenced, signed out). */
export async function unsubscribePush(deps: Deps, userId: string, endpoint: string) {
  await deps.db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)));
}

/**
 * Tells these people on every browser they let – in the background: a push service slow or down
 * holds nothing up. Addresses the service says are gone are dropped.
 */
export function pushTo(deps: Deps, userIds: readonly string[], notice: PushNotice): void {
  if (userIds.length === 0) return;
  void (async () => {
    const rows = await deps.db
      .select()
      .from(pushSubscriptions)
      .where(inArray(pushSubscriptions.userId, [...new Set(userIds)]))
      // Stored before the services were checked: never sent to.
      .then((found) => found.filter((row) => isPushService(row.endpoint)));
    const plain = Buffer.from(JSON.stringify(notice));
    await Promise.all(
      rows.map(async (row) => {
        try {
          const res = await fetch(row.endpoint, {
            method: 'POST',
            headers: {
              authorization: vapidHeader(deps, row.endpoint),
              'content-encoding': 'aes128gcm',
              'content-type': 'application/octet-stream',
              ttl: String(24 * 60 * 60),
              urgency: 'high',
            },
            body: encryptFor(row.p256dh, row.auth, plain),
          });
          if (res.status === 404 || res.status === 410) {
            await deps.db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, row.id));
          } else if (!res.ok) {
            deps.log.warn(`Web Push to ${new URL(row.endpoint).host}: ${res.status}`);
          }
        } catch (error) {
          deps.log.warn(`Web Push to ${new URL(row.endpoint).host}: ${String(error)}`);
        }
      }),
    );
  })().catch((error: unknown) => deps.log.warn(`Web Push: ${String(error)}`));
}
