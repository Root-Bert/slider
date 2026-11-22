import { formatDay } from '@/lib/format';

/** How calls that are over read: when, how long. */

const time = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });

/** „3 Min.“ – a call of a few seconds is one minute. */
export const callMinutes = (call: { startedAt: string; endedAt: string }) =>
  `${Math.max(1, Math.round((Date.parse(call.endedAt) - Date.parse(call.startedAt)) / 60_000))} Min.`;

/** „20. Nov., 14:03“ – when a call began. */
export const callWhen = (startedAt: string) =>
  `${formatDay(startedAt)}, ${time.format(new Date(startedAt))}`;

/** „14:03“ – a turn's time. */
export const callTime = (at: string) => time.format(new Date(at));
