import { useSyncExternalStore } from 'react';
import { createStoredStore } from '@/lib/storage';

/** „Abstand“ between the mails of a list: Gmail's three, Normal the list as it always was. */
export const MAIL_SPACINGS = ['compact', 'normal', 'airy'] as const;
export type MailSpacing = (typeof MAIL_SPACINGS)[number];

/**
 * „Vorschau“: the lines under the sender – none (the subject alone), one (subject – words, as it
 * always was), two or three (the subject on its own line, the words below it).
 */
export const MAIL_PREVIEWS = [0, 1, 2, 3] as const;
export type MailPreview = (typeof MAIL_PREVIEWS)[number];

/**
 * „Bilder von außen“ in an open mail: asked for each mail (as it always was), or loaded at once –
 * through Slider's server either way, but loading tells the sender the mail was opened.
 */
export const MAIL_PICTURES = ['ask', 'always'] as const;
export type MailPictures = (typeof MAIL_PICTURES)[number];

/**
 * „Senden verzögern“: seconds a written mail waits in the outbox (on the server) before it really
 * goes – taken back meanwhile („Rückgängig“), it never does.
 */
export const MAIL_DELAYS = [0, 10, 30, 60, 300] as const;
export type MailDelay = (typeof MAIL_DELAYS)[number];

export interface MailListLook {
  spacing: MailSpacing;
  preview: MailPreview;
  pictures: MailPictures;
  delay: MailDelay;
}

const FALLBACK: MailListLook = { spacing: 'normal', preview: 1, pictures: 'ask', delay: 10 };

const lookStore = createStoredStore<MailListLook>({
  key: 'slider.mail.list',
  parse: (value) => {
    const said = (value ?? {}) as Partial<Record<keyof MailListLook, unknown>>;
    return {
      spacing: MAIL_SPACINGS.find((each) => each === said.spacing) ?? FALLBACK.spacing,
      preview: MAIL_PREVIEWS.find((each) => each === said.preview) ?? FALLBACK.preview,
      pictures: MAIL_PICTURES.find((each) => each === said.pictures) ?? FALLBACK.pictures,
      delay: MAIL_DELAYS.find((each) => each === said.delay) ?? FALLBACK.delay,
    };
  },
  fallback: FALLBACK,
  // Settings open in another tab or window: the list follows at once.
  crossTab: true,
});

/**
 * How the mail list looks (Sender's and Cloud's, also beside an open mail) and whether a mail's
 * pictures from outside load at once: set in
 * `/einstellungen` › Mail, kept in this browser.
 */
export function useMailListLook() {
  const look = useSyncExternalStore(lookStore.subscribe, lookStore.getSnapshot);
  const update = (patch: Partial<MailListLook>) =>
    lookStore.set({ ...lookStore.getSnapshot(), ...patch });
  return [look, update] as const;
}
