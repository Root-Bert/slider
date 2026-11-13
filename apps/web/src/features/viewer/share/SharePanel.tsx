import {
  memo,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import type { ExportFormat, Slide } from '@slider/shared';
import { Stars, stars } from '@/features/workspaces';
import { isEmailAddress } from '@/lib/format';
import { editedFileUrl, useDownloadEditedPdf, useDownloadSlide, useSendExport } from '@/lib/api';
import {
  AutosizeTextarea,
  Button,
  cn,
  Icon,
  IconButton,
  SegmentedControl,
  Spinner,
  TextField,
  usePointerSpot,
} from '@/ui';
import { SidePanel, SidePanelHeader } from '../components/SidePanel';
import { useEditing } from '../editing/editing-context';
import { useRestoreFocus } from '../hooks/useRestoreFocus';
import { useViewerData } from '../state/viewer-data';
import { useViewerDispatch, useViewerState } from '../state/viewer-state';
import { useViewerToast } from '../state/viewer-toast';

/**
 * „Exportieren“ (S, the button in the deck pill) in the side panel – for whoever can edit the
 * deck: its file as it is now (a template as `.otp`), a PDF of it, and the slide shown alone as
 * a PDF or a picture. Featured cards like „Neue Präsentation“ (`BlankDeckCard`), a little
 * see-through: the space with its stars, the pointer's light, and the deck's own slides on the
 * right – fanned out for the file, stacked as pages for the PDF, the one slide for itself. Each
 * downloads, or – where the server sends mail – goes to someone as an attachment („Senden“).
 */
export function SharePanel() {
  const { sharePanelOpen } = useViewerState();
  const { available } = useEditing();
  const dispatch = useViewerDispatch();
  // S opens it for anyone; without editing there is nothing to export.
  useEffect(() => {
    if (sharePanelOpen && !available) dispatch({ type: 'sharePanelSet', open: false });
  }, [sharePanelOpen, available, dispatch]);
  if (!sharePanelOpen || !available) return null;
  return <SharePanelView />;
}

type CardId = 'file' | 'pdf' | 'slide';

/** What every card needs to offer „Senden“: whose form is open (one at a time). */
interface Sending {
  /** The server sends mail – else the cards only download. */
  available: boolean;
  open: CardId | null;
  setOpen: (card: CardId | null) => void;
}

function SharePanelView() {
  const dispatch = useViewerDispatch();
  const { deck, slides, slideIndex } = useViewerData();
  const { activeSlideId } = useViewerState();
  const { state } = useEditing();
  const panelRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const template = deck.template !== null;
  const [open, setOpen] = useState<CardId | null>(null);
  const sending: Sending = { available: state?.mail ?? false, open, setOpen };
  const activeIndex = activeSlideId === null ? undefined : slideIndex.get(activeSlideId);

  useRestoreFocus();
  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <SidePanel ref={panelRef} data-share-panel aria-labelledby={titleId}>
      <SidePanelHeader gap="sm">
        <div className="flex items-center gap-2">
          <Icon name="iosShare" size={20} className="shrink-0 text-fg-muted" />
          <h2 id={titleId} className="min-w-0 flex-1 truncate text-base font-semibold text-fg">
            Exportieren
          </h2>
          <IconButton
            icon="close"
            label="Schließen (Esc)"
            size="sm"
            onClick={() => dispatch({ type: 'sharePanelSet', open: false })}
          />
        </div>
        <p className="text-xs leading-4 text-fg-subtle">
          {template
            ? 'Die Vorlage mit allen Layouts, wie sie jetzt ist.'
            : 'Die Präsentation mit allen Änderungen, wie sie jetzt ist.'}
        </p>
      </SidePanelHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-3 pb-6">
        <FileCard slides={slides} template={template} sending={sending} />
        <PdfCard slides={slides} sending={sending} />
        {activeIndex !== undefined && (
          <SlideCard slide={slides[activeIndex]!} number={activeIndex + 1} sending={sending} />
        )}
      </div>
    </SidePanel>
  );
}

/**
 * „Senden“ of one card: mails its export, told by the viewer even once the panel closed
 * meanwhile (`mutate`'s own callbacks would not). The form closes at once; the card shows it is
 * at work until the server has sent it.
 */
function useSend(card: CardId, sending: Sending) {
  const { deck } = useViewerData();
  const send = useSendExport(deck.id);
  const showToast = useViewerToast();
  return {
    pending: send.isPending,
    props: sending.available
      ? {
          open: sending.open === card,
          onToggle: () => sending.setOpen(sending.open === card ? null : card),
          onSend: (to: string, note: string, format: ExportFormat, slideId?: string) => {
            sending.setOpen(null);
            void send
              .mutateAsync({ to, note: note || undefined, format, slideId })
              .then(() => showToast(`Gesendet an ${to}`))
              .catch((error: Error) => showToast(error.message, 'danger'));
          },
        }
      : null,
  };
}

function FileCard({
  slides,
  template,
  sending,
}: {
  slides: readonly Slide[];
  template: boolean;
  sending: Sending;
}) {
  const { deck } = useViewerData();
  const send = useSend('file', sending);
  return (
    <ExportCard
      title={template ? 'Als Vorlage' : 'Als Präsentation'}
      description="Zum Weiterbearbeiten."
      format={<FormatBadge>{template ? 'OTP' : 'ODP'}</FormatBadge>}
      meta={slideCount(slides.length, 'Folie', 'Folien')}
      sky={SKY_FILE}
      art={<FannedSlides slides={slides} />}
      busy={send.pending}
      busyLabel="Wird gesendet …"
      onDownload={() => window.location.assign(editedFileUrl(deck.id))}
      send={
        send.props && { ...send.props, onSend: (to, note) => send.props!.onSend(to, note, 'file') }
      }
    />
  );
}

function PdfCard({ slides, sending }: { slides: readonly Slide[]; sending: Sending }) {
  const { deck } = useViewerData();
  const download = useDownloadEditedPdf(deck.id);
  const send = useSend('pdf', sending);
  const showToast = useViewerToast();
  const making = download.isPending;
  const busy = making || send.pending;
  return (
    <ExportCard
      title="Als PDF"
      description="Zum Verschicken und Drucken."
      format={<FormatBadge>PDF</FormatBadge>}
      meta={slideCount(slides.length, 'Seite', 'Seiten')}
      sky={SKY_PDF}
      art={<StackedPages slides={slides} busy={busy} />}
      busy={busy}
      busyLabel={making ? 'PDF wird erstellt …' : 'Wird gesendet …'}
      // Told by the viewer even once the panel closed meanwhile (`mutate`'s own callbacks would not).
      onDownload={() => {
        if (busy) return;
        void download
          .mutateAsync(`${deck.title}.pdf`)
          .catch((error: Error) => showToast(error.message, 'danger'));
      }}
      send={
        send.props && { ...send.props, onSend: (to, note) => send.props!.onSend(to, note, 'pdf') }
      }
    />
  );
}

const SLIDE_FORMATS = [
  { value: 'pdf', label: 'PDF' },
  { value: 'png', label: 'PNG' },
] as const;

/** „Nur diese Folie“: the slide shown, alone – as a one-page PDF or as its picture. */
function SlideCard({ slide, number, sending }: { slide: Slide; number: number; sending: Sending }) {
  const { deck } = useViewerData();
  const [format, setFormat] = useState<'pdf' | 'png'>('pdf');
  const download = useDownloadSlide(deck.id);
  const send = useSend('slide', sending);
  const showToast = useViewerToast();
  const making = download.isPending;
  const busy = making || send.pending;
  return (
    <ExportCard
      title="Nur diese Folie"
      description={`Folie ${number} als PDF oder Bild.`}
      format={null}
      meta={null}
      sky={SKY_SLIDE}
      art={<OneSlide slide={slide} page={format === 'pdf'} busy={busy} />}
      artControl={
        <SegmentedControl
          label="Format"
          size="xs"
          track="soft"
          segments={SLIDE_FORMATS}
          value={format}
          onChange={setFormat}
        />
      }
      busy={busy}
      busyLabel={
        making
          ? format === 'pdf'
            ? 'PDF wird erstellt …'
            : 'Bild wird erstellt …'
          : 'Wird gesendet …'
      }
      onDownload={() => {
        if (busy) return;
        void download
          .mutateAsync({
            slideId: slide.id,
            format,
            fallbackName: `${deck.title} – Folie ${number}.${format}`,
          })
          .catch((error: Error) => showToast(error.message, 'danger'));
      }}
      send={
        send.props && {
          ...send.props,
          onSend: (to, note) =>
            send.props!.onSend(to, note, format === 'pdf' ? 'slidePdf' : 'slidePng', slide.id),
        }
      }
    />
  );
}

const slideCount = (count: number, one: string, many: string) =>
  count === 0 ? null : `${count} ${count === 1 ? one : many}`;

const SKY_FILE = stars(22, 376, 148, 7);
const SKY_PDF = stars(22, 376, 148, 23);
const SKY_SLIDE = stars(22, 376, 148, 41);

/** The card's sky: faint stars, a few twinkling – decorative only. */
const Sky = memo(function Sky({ sky }: { sky: ReturnType<typeof stars> }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 376 148"
      preserveAspectRatio="xMidYMid slice"
      className="pointer-events-none absolute inset-0 size-full"
    >
      <Stars sky={sky} opacity={0.35} />
    </svg>
  );
});

function FormatBadge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-mark bg-surface-2 px-1.5 py-px text-[10px] leading-4 font-semibold tracking-wider text-fg-muted ring-1 ring-hairline">
      {children}
    </span>
  );
}

/** The card's two buttons, „Herunterladen“ and „Senden“: the same pill, one height. */
const pill =
  'flex h-8 items-center gap-1.5 rounded-control px-3 text-sm font-medium outline-none transition-[background-color,color,box-shadow] duration-200';
/** A pill at rest – primary only while pointed at or focused itself, never with the card. */
const pillIdle = cn(
  'cursor-pointer bg-surface-2 text-fg ring-1 ring-hairline',
  'hover:bg-primary hover:text-on-primary hover:shadow-glow hover:ring-transparent',
  'focus-visible:bg-primary focus-visible:text-on-primary focus-visible:shadow-glow focus-visible:ring-transparent',
);
const pillLit = 'bg-primary text-on-primary shadow-glow ring-transparent';

/**
 * One way out, as a featured card (`BlankDeckCard`'s look): the card glows under the pointer and
 * a click anywhere on it downloads; its two pills light up only when pointed at themselves –
 * „Herunterladen“, and „Senden“, which opens a small form in the card (lit while open). While
 * busy „Herunterladen“ stays lit and focusable (`aria-disabled`): a disabled button would drop
 * the focus.
 */
function ExportCard({
  title,
  description,
  format,
  meta,
  sky,
  art,
  artControl,
  busy = false,
  busyLabel,
  onDownload,
  send,
}: {
  title: string;
  description: string;
  format: ReactNode | null;
  meta: string | null;
  sky: ReturnType<typeof stars>;
  art: ReactNode;
  /** A control under the picture on the right (the slide's format). */
  artControl?: ReactNode;
  busy?: boolean;
  busyLabel?: string;
  onDownload: () => void;
  send: {
    open: boolean;
    onToggle: () => void;
    onSend: (to: string, note: string) => void;
  } | null;
}) {
  const followPointer = usePointerSpot();
  const formId = useId();
  // The card as a whole downloads – not a click on one of its own controls.
  const onCardClick = (event: MouseEvent<HTMLDivElement>) => {
    if (send?.open || busy) return;
    if ((event.target as Element).closest('button, input, textarea, [role="radiogroup"]')) return;
    onDownload();
  };
  return (
    <div
      onClick={onCardClick}
      onPointerMove={followPointer}
      aria-busy={busy || undefined}
      className={cn(
        'group hero-glow relative flex w-full shrink-0 flex-col overflow-hidden rounded-panel text-left shadow-card-rest [--hero-alpha:78%]',
        'transition-[scale,box-shadow] duration-500 ease-emphasized',
        'hover:shadow-card-glow has-focus-visible:shadow-card-glow',
        !send?.open && 'cursor-pointer motion-safe:hover:scale-[1.008]',
        busy && 'shadow-card-glow cursor-progress',
      )}
    >
      {/* First, so the positioned content after it paints on top. */}
      <Sky sky={sky} />
      <span
        className={cn(
          'pointer-light pointer-events-none absolute inset-0 transition-opacity duration-500',
          busy
            ? 'opacity-100'
            : 'opacity-0 group-hover:opacity-100 group-has-focus-visible:opacity-100',
        )}
      />
      <span className="pointer-rim pointer-events-none absolute inset-0 rounded-panel opacity-0 transition-opacity duration-500 group-hover:opacity-100 group-has-focus-visible:opacity-100" />
      {/* While the file is made or sent: a light sweeping across the card. */}
      {busy && (
        <span className="pointer-events-none absolute inset-0 overflow-hidden rounded-panel motion-reduce:hidden">
          <span className="absolute inset-y-0 -left-1/2 w-1/2 animate-export-sweep bg-linear-to-r from-transparent via-fg/8 to-transparent" />
        </span>
      )}

      <div className="relative flex h-37 w-full">
        <div className="flex min-w-0 flex-1 flex-col justify-between gap-3 p-5 pr-0">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex items-center gap-2">
              <h3 className="text-lg leading-6 font-semibold tracking-tight text-fg">{title}</h3>
              {format}
            </div>
            <p className="text-xs leading-4 text-fg-subtle">{description}</p>
            {meta && <p className="text-caption text-fg-muted">{meta}</p>}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => !busy && onDownload()}
              aria-disabled={busy || undefined}
              className={cn(
                pill,
                busy ? cn(pillLit, 'cursor-progress') : cn(pillIdle, 'group/download'),
              )}
            >
              {busy ? (
                <Spinner size={16} label={busyLabel} />
              ) : (
                <Icon
                  name="download"
                  size={18}
                  className="transition-transform duration-300 ease-overshoot group-hover/download:translate-y-0.5"
                />
              )}
              {busy ? busyLabel : 'Herunterladen'}
            </button>
            {send && !busy && (
              <button
                type="button"
                aria-label="Senden"
                title="Per Mail senden"
                aria-expanded={send.open}
                aria-controls={send.open ? formId : undefined}
                onClick={send.onToggle}
                className={cn(pill, send.open ? cn(pillLit, 'cursor-pointer') : pillIdle)}
              >
                <Icon name="send" size={18} />
              </button>
            )}
          </div>
        </div>

        <span aria-hidden className="pointer-events-none relative w-38 shrink-0 max-[360px]:hidden">
          {art}
        </span>
        {artControl && (
          <div className="absolute right-6 bottom-5 flex w-30 justify-center max-[360px]:hidden">
            {artControl}
          </div>
        )}
      </div>

      {send?.open && <SendForm id={formId} onSend={send.onSend} onCancel={send.onToggle} />}
    </div>
  );
}

/**
 * „Senden“, inside the card: to whom, and a note if wanted. Enter in the address (⌘↵ in the
 * note) sends, Esc closes it.
 */
function SendForm({
  id,
  onSend,
  onCancel,
}: {
  id: string;
  onSend: (to: string, note: string) => void;
  onCancel: () => void;
}) {
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');
  const [touched, setTouched] = useState(false);
  const valid = isEmailAddress(to);
  const submit = () => {
    setTouched(true);
    if (valid) onSend(to.trim(), note.trim());
  };
  const onKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if (event.key === 'Escape') {
      // Only the form closes, not the panel.
      event.preventDefault();
      onCancel();
    } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
    }
  };
  return (
    <form
      id={id}
      noValidate
      aria-label="Per Mail senden"
      onKeyDown={onKeyDown}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="relative flex animate-pop-in flex-col gap-2 px-5 pb-5"
    >
      <TextField
        type="email"
        aria-label="E-Mail-Adresse"
        icon="at"
        placeholder="name@firma.de"
        autoFocus
        value={to}
        error={touched && !valid ? 'Gib eine gültige E-Mail-Adresse ein.' : null}
        onChange={(event) => setTo(event.target.value)}
      />
      <div className="glass focus-field flex rounded-control px-3 py-2.5">
        <AutosizeTextarea
          aria-label="Nachricht"
          placeholder="Nachricht (optional)"
          value={note}
          maxLength={2000}
          maxHeight={120}
          rows={2}
          onChange={(event) => setNote(event.target.value)}
          className="min-w-0 flex-1 resize-none bg-transparent text-sm text-fg outline-none placeholder:text-fg-subtle"
        />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Abbrechen
        </Button>
        <Button type="submit" size="sm" icon="send">
          Senden
        </Button>
      </div>
    </form>
  );
}

/** A slide picture, or – before there is one – a blank white slide. */
function SlidePicture({ slide, className }: { slide: Slide | undefined; className?: string }) {
  return (
    <span className={cn('absolute inset-0 overflow-hidden rounded-thumb bg-white', className)}>
      {slide && (
        <img
          src={slide.thumbnailUrl}
          alt=""
          decoding="async"
          draggable={false}
          className="size-full object-cover"
        />
      )}
    </span>
  );
}

const card = 'transition-transform duration-500 ease-emphasized';

/** A slide as a printed page: white margin around it. */
function Page({ slide, className }: { slide: Slide | undefined; className?: string }) {
  return (
    <span className={cn('absolute inset-0 rounded-[3px] bg-white p-1 shadow-float', className)}>
      <span className="relative block size-full overflow-hidden rounded-[1px]">
        <SlidePicture slide={slide} className="rounded-none" />
      </span>
    </span>
  );
}

/** The file: the deck's first three slides fanned out like „Neue Präsentation“'s, more on hover. */
function FannedSlides({ slides }: { slides: readonly Slide[] }) {
  return (
    <span className="absolute top-1/2 right-6 aspect-video w-30 -translate-y-1/2">
      <span
        className={cn(
          'absolute inset-0',
          card,
          'rotate-[-10deg] -translate-x-5 translate-y-1.5 group-hover:rotate-[-16deg] group-hover:-translate-x-10 group-hover:translate-y-3',
        )}
      >
        <SlidePicture slide={slides[2]} className="opacity-55 ring-hairline-strong" />
      </span>
      <span
        className={cn(
          'absolute inset-0',
          card,
          'rotate-[-5deg] -translate-x-2.5 translate-y-0.5 group-hover:rotate-[-8deg] group-hover:-translate-x-5 group-hover:translate-y-1.5',
        )}
      >
        <SlidePicture slide={slides[1]} className="opacity-80 ring-hairline-strong" />
      </span>
      <span
        className={cn(
          'absolute inset-0',
          card,
          'rotate-3 group-hover:-translate-y-2 group-hover:rotate-0',
        )}
      >
        <SlidePicture slide={slides[0]} className="shadow-float" />
      </span>
    </span>
  );
}

/**
 * The PDF: the same slides as pages, lying straight on top of each other with a white margin
 * like printed sheets; they spread downwards on hover, and breathe while the PDF is made.
 */
function StackedPages({ slides, busy }: { slides: readonly Slide[]; busy: boolean }) {
  return (
    <span
      className={cn(
        'absolute top-1/2 right-6 aspect-video w-30 -translate-y-[62%]',
        busy && 'motion-safe:animate-export-breathe',
      )}
    >
      <span
        className={cn(
          'absolute inset-0',
          card,
          'translate-x-3 translate-y-3 group-hover:translate-x-4 group-hover:translate-y-6',
        )}
      >
        <Page slide={slides[2]} className="opacity-55" />
      </span>
      <span
        className={cn(
          'absolute inset-0',
          card,
          'translate-x-1.5 translate-y-1.5 group-hover:translate-x-2 group-hover:translate-y-3',
        )}
      >
        <Page slide={slides[1]} className="opacity-80" />
      </span>
      <span className={cn('absolute inset-0', card, 'group-hover:-translate-y-1.5')}>
        <Page slide={slides[0]} />
      </span>
    </span>
  );
}

/**
 * The one slide, alone: as a page with its white margin for the PDF, as the bare picture for
 * the PNG; lifted a little on hover, breathing while it is made.
 */
function OneSlide({ slide, page, busy }: { slide: Slide; page: boolean; busy: boolean }) {
  return (
    <span
      className={cn(
        'absolute top-[42%] right-6 aspect-video w-30 -translate-y-1/2',
        busy && 'motion-safe:animate-export-breathe',
      )}
    >
      <span
        className={cn(
          'absolute inset-0',
          card,
          '-rotate-2 group-hover:-translate-y-1.5 group-hover:rotate-0 group-hover:scale-105',
        )}
      >
        {page ? <Page slide={slide} /> : <SlidePicture slide={slide} className="shadow-float" />}
      </span>
    </span>
  );
}
