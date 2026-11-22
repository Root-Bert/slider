import { useCallback, useEffect, useRef, useState } from 'react';
import { API_PREFIX, type MailMessage } from '@slider/shared';
import { Button, cn, Icon } from '@/ui';
import { useMailListLook } from '../../hooks/useMailListLook';

/** The mails whose pictures from outside were asked for – in this tab, until it is closed. */
const withPictures = new Set<string>();

/** Keys that go on to the app (from the frame, as if it had them): Esc, ↑/↓ … also in a mail's page. */
const KEY_FIELDS = ['key', 'code', 'metaKey', 'ctrlKey', 'altKey', 'shiftKey', 'repeat'] as const;

/**
 * A mail as it looks (its HTML): a page of its own (`services/mail-html.ts`, sanitized, its own
 * CSP) in a frame that runs nothing (`sandbox` without scripts; same origin only so its height can
 * be fitted and the pictures come with the session), on a white sheet as mail is designed for –
 * also in dark mode. Pictures from outside only on „Bilder laden“ – or at once where that is set
 * (`/einstellungen` › Mail) – through Slider's server.
 */
export function MailHtml({ threadId, message }: { threadId: string; message: MailMessage }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [asked, setAsked] = useState(() => withPictures.has(message.id));
  const [look] = useMailListLook();
  const pictures = asked || look.pictures === 'always';
  const [leftOut, setLeftOut] = useState(0);
  const [height, setHeight] = useState(0);
  const src = `${API_PREFIX}/mail/threads/${encodeURIComponent(threadId)}/messages/${encodeURIComponent(message.id)}/html${pictures ? '?bilder=1' : ''}`;

  // As tall as the mail; a mail wider than the sheet zoomed out to fit, as mail apps on a phone do.
  const fit = useCallback(() => {
    const frame = frameRef.current;
    const page = frame?.contentDocument;
    if (!frame || !page?.body) return;
    page.body.style.zoom = '';
    const room = frame.clientWidth;
    const wide = page.documentElement.scrollWidth;
    if (room > 0 && wide > room + 1) page.body.style.zoom = String(room / wide);
    setHeight(Math.ceil(page.body.getBoundingClientRect().bottom));
  }, []);

  // The frame's load comes once its pictures are in: measured then, and again when it gets wider.
  const loaded = () => {
    const page = frameRef.current?.contentDocument;
    if (!page) return;
    setLeftOut(
      Number(page.querySelector('meta[name="slider-remote-images"]')?.getAttribute('content')) || 0,
    );
    page.addEventListener('keydown', (event) => {
      const init = Object.fromEntries(KEY_FIELDS.map((field) => [field, event[field]]));
      frameRef.current?.dispatchEvent(new KeyboardEvent('keydown', { ...init, bubbles: true }));
    });
    // The wheel too: the mail around it scrolls as one with its reply (`MailCards`).
    page.addEventListener(
      'wheel',
      (event) => {
        const { deltaX, deltaY, deltaMode, ctrlKey } = event;
        const passed = new WheelEvent('wheel', {
          deltaX,
          deltaY,
          deltaMode,
          ctrlKey,
          bubbles: true,
          cancelable: true,
        });
        if (frameRef.current && !frameRef.current.dispatchEvent(passed)) event.preventDefault();
      },
      { passive: false },
    );
    fit();
  };

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const observer = new ResizeObserver(fit);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [fit]);

  return (
    <div className="flex grow flex-col gap-2">
      {!pictures && leftOut > 0 && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 text-xs text-fg-muted">
          <Icon name="image" size={14} className="shrink-0" />
          <span>Bilder von außen werden nicht geladen</span>
          <Button
            size="xs"
            variant="soft"
            onClick={() => {
              withPictures.add(message.id);
              setAsked(true);
            }}
          >
            Bilder laden
          </Button>
        </p>
      )}
      <iframe
        ref={frameRef}
        src={src}
        title={message.subject || 'Mail'}
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
        onLoad={loaded}
        // Until it is measured, a sheet of a few lines, unseen – it fades in at its height, no jump.
        style={{ height: height || 120 }}
        // To the frame's edges (`MailCards` cuts it to the frame's round corners); its own top
        // corners as round as the frame's, a sheet laid in under the sender.
        // Grows where the latest mail does: the page's own background fills the rest.
        className={cn(
          'block w-full shrink-0 grow rounded-t-panel border-0 bg-white transition-opacity duration-150 motion-reduce:transition-none',
          !height && 'opacity-0',
        )}
      />
    </div>
  );
}
