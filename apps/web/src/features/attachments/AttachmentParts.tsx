import { useRef, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  API_PREFIX,
  CLOUD_FOLDER_TYPE,
  cloudFileType,
  cloudPaths,
  isCloudReference,
  isAudioAttachment,
  isPictureAttachment,
  isVideoAttachment,
  type Attachment,
} from '@slider/shared';
import { attachmentUrl } from '@/lib/api';
import { api } from '@/lib/api-client';
import { AudioPlayer } from '@/features/viewer';
import { useActiveWorkspace } from '@/features/workspaces';
import { formatFileSize } from '@/lib/format';
import { cn, ErrorText, Icon, IconButton, PageStrip } from '@/ui';
import type { Attachments, FieldAttachment } from './useAttachments';
import { referenceRoute } from './useFileDrop';

/** A file's chip symbol: a Cloud folder or file pointed to, else the clip. */
const chipIcon = (one: Pick<Attachment, 'type' | 'nodeId'>) =>
  !isCloudReference(one) ? 'attachFile' : one.type === CLOUD_FOLDER_TYPE ? 'folder' : 'description';

const CHIP =
  'relative inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 overflow-hidden rounded-chip bg-surface-2 pr-1 pl-2 text-body text-fg';
const THUMB = 'block h-9 w-16 rounded-badge bg-glass-solid object-cover ring-hairline-strong';

/**
 * The clip of a field: picks files (pictures only where only they mean something) – pasting
 * into the field works too. The focus stays in the field.
 */
export function AttachButton({
  files,
  size = 'compact',
  disabled = false,
}: {
  files: Attachments;
  size?: 'sm' | 'compact';
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  if (!files.enabled) return null;
  const pictures = files.accept === 'pictures';
  const picked = (event: ChangeEvent<HTMLInputElement>) => {
    const list = [...(event.target.files ?? [])];
    // The same files can be picked again.
    event.target.value = '';
    files.add(list);
  };
  const off = disabled || files.room === 0;
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={pictures ? 'image/png,image/jpeg,image/gif,image/webp' : undefined}
        multiple
        hidden
        tabIndex={-1}
        aria-hidden
        onChange={picked}
      />
      <IconButton
        icon="attachFile"
        label={pictures ? 'Bilder anhängen' : 'Datei anhängen'}
        title={`${pictures ? 'Bilder' : 'Dateien'} anhängen – oder direkt ins Textfeld einfügen`}
        size={size}
        // `aria-disabled`, not `disabled`: a disabled button would drop the focus.
        aria-disabled={off || undefined}
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => {
          if (!off) input.current?.click();
        }}
        className={cn(off && 'cursor-default opacity-40')}
      />
    </>
  );
}

/**
 * Over a conversation while files are dragged onto it (`useFileDrop`): where letting go puts them
 * on the message – as over a mail being written. Its box needs `relative` (or another position).
 */
export function FileDropHint({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-panel border-2 border-dashed border-primary bg-surface/80 text-body font-semibold text-fg',
        className,
      )}
    >
      <span className="flex items-center gap-2">
        <Icon name="attachFile" size={18} />
        Zum Anhängen loslassen
      </span>
    </div>
  );
}

/**
 * The files on a field being written, under its words: pictures as small previews, other files
 * as chips with their size – each with ✕; one on its way up fills as it goes (✕ stops it).
 */
export function AttachmentChips({ files, className }: { files: Attachments; className?: string }) {
  if (files.items.length === 0 && !files.error) return null;
  const chip = (one: FieldAttachment) => {
    const going = one.progress !== null;
    // A picture's preview: from the file itself, or – put back after a refusal – from the server.
    const pointed = !!one.attachment && isCloudReference(one.attachment);
    const src =
      one.preview ??
      (one.attachment && !pointed && isPictureAttachment(one.type)
        ? attachmentUrl(one.attachment.id)
        : null);
    const percent = going ? `${Math.round((one.progress ?? 0) * 100)} %` : null;
    const off = (
      <button
        type="button"
        aria-label={going ? `${one.name} nicht anhängen` : `${one.name} entfernen`}
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => files.remove(one.key)}
        className={cn(
          'flex size-5 shrink-0 items-center justify-center rounded-full text-fg-subtle hover:bg-selected hover:text-fg',
          src &&
            'glass-dark absolute -top-1.5 -right-1.5 opacity-0 group-hover/thumb:opacity-100 focus-visible:opacity-100 max-sm:opacity-100',
        )}
      >
        <Icon name="close" size={14} />
      </button>
    );
    if (src) {
      return (
        <li key={one.key} className="group/thumb relative" aria-busy={going || undefined}>
          <img src={src} alt={one.name} title={one.name} className={THUMB} />
          {going && (
            <span className="glass-dark absolute inset-0 flex items-center justify-center rounded-badge text-xs text-fg">
              {percent}
            </span>
          )}
          {off}
        </li>
      );
    }
    return (
      <li key={one.key} className={CHIP} aria-busy={going || undefined}>
        {going && (
          <span
            aria-hidden
            style={{ width: percent ?? undefined }}
            className="absolute inset-y-0 left-0 bg-selected transition-[width] duration-200"
          />
        )}
        <Icon
          name={one.attachment ? chipIcon(one.attachment) : 'attachFile'}
          size={14}
          className="relative shrink-0 text-fg-subtle"
        />
        <span className="relative truncate" title={pointed ? `${one.name} – aus Cloud` : undefined}>
          {one.name}
        </span>
        {(going || one.type !== CLOUD_FOLDER_TYPE) && (
          <span className="relative shrink-0 text-xs text-fg-subtle">
            {percent ?? formatFileSize(one.size)}
          </span>
        )}
        <span className="relative">{off}</span>
      </li>
    );
  };
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      {files.items.length > 0 && (
        <ul aria-label="Anhänge" className="flex min-w-0 flex-wrap items-center gap-1.5">
          {files.items.map(chip)}
        </ul>
      )}
      {files.error && (
        <ErrorText role="alert" size="xs">
          {files.error}
        </ErrorText>
      )}
    </div>
  );
}

/**
 * The files of something written and sent, under its words: pictures as previews that open in
 * full, other files as chips that download; Cloud files and folders it points to as chips that
 * open them in Cloud.
 */
export function SentAttachments({
  attachments,
  className,
  onDelete,
  pages = false,
}: {
  attachments: readonly Attachment[] | undefined;
  className?: string;
  /** Where they stay on what is kept (a to-do): each with ✕ – it asks first. */
  onDelete?: (one: Attachment) => void;
  /** A document (PDF, office file) shows its pages over its chip, as in Cloud (Sender). */
  pages?: boolean;
}) {
  const workspace = useActiveWorkspace();
  if (!attachments?.length) return null;
  const off = (one: Attachment, onPicture: boolean) =>
    onDelete && (
      <button
        type="button"
        aria-label={`${one.name} löschen`}
        title="Löschen"
        onClick={() => onDelete(one)}
        className={cn(
          'flex size-5 shrink-0 items-center justify-center rounded-full text-fg-subtle hover:bg-selected hover:text-fg',
          onPicture &&
            'glass-dark absolute -top-1.5 -right-1.5 opacity-0 group-hover/thumb:opacity-100 focus-visible:opacity-100 max-sm:opacity-100',
        )}
      >
        <Icon name="close" size={14} />
      </button>
    );
  const pictures = attachments.filter(
    (one) => isPictureAttachment(one.type) && !isCloudReference(one),
  );
  const videos = attachments.filter((one) => isVideoAttachment(one.type) && !isCloudReference(one));
  const voices = attachments.filter((one) => isAudioAttachment(one.type) && !isCloudReference(one));
  const others = attachments.filter(
    (one) =>
      (!isPictureAttachment(one.type) &&
        !isVideoAttachment(one.type) &&
        !isAudioAttachment(one.type)) ||
      isCloudReference(one),
  );
  const documents = pages ? others.filter(hasPages) : [];
  const files = others.filter((one) => !documents.includes(one));
  const chipOf = (one: Attachment) => (
    <>
      {isCloudReference(one) && workspace ? (
        <Link
          to={referenceRoute(workspace.id, one)}
          title={`${one.name} in Cloud öffnen`}
          className={cn(CHIP, 'pr-2 hover:bg-selected', onDelete && 'rounded-r-none')}
        >
          <Icon name={chipIcon(one)} size={14} className="shrink-0 text-fg-subtle" />
          <span className="truncate">{one.name}</span>
          {one.type !== CLOUD_FOLDER_TYPE && (
            <span className="shrink-0 text-xs text-fg-subtle">{formatFileSize(one.size)}</span>
          )}
        </Link>
      ) : (
        <a
          href={attachmentUrl(one.id, true)}
          download={one.name}
          title={`${one.name} laden`}
          className={cn(CHIP, 'pr-2 hover:bg-selected', onDelete && 'rounded-r-none')}
        >
          <Icon name="attachFile" size={14} className="shrink-0 text-fg-subtle" />
          <span className="truncate">{one.name}</span>
          <span className="shrink-0 text-xs text-fg-subtle">{formatFileSize(one.size)}</span>
        </a>
      )}
      {onDelete && (
        <span className="flex h-7 items-center rounded-r-chip bg-surface-2 pr-1">
          {off(one, false)}
        </span>
      )}
    </>
  );
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      {pictures.length > 0 && (
        <ul aria-label="Bilder" className="flex flex-wrap gap-1.5">
          {pictures.map((one) => (
            <li key={one.id} className="group/thumb relative">
              <a
                href={attachmentUrl(one.id)}
                target="_blank"
                rel="noreferrer"
                title={one.name}
                className="block rounded-badge focus-visible:ring-focus"
              >
                <img
                  src={attachmentUrl(one.id)}
                  alt={one.name}
                  loading="lazy"
                  className={cn(
                    'block max-h-60 max-w-full rounded-badge bg-glass-solid object-contain ring-hairline',
                    pictures.length > 1 && 'size-28 object-cover',
                  )}
                />
              </a>
              {off(one, true)}
            </li>
          ))}
        </ul>
      )}
      {videos.map((one) => (
        <div key={one.id} className="group/thumb relative w-full max-w-md">
          {/* Safari draws a video on its own layer, past the radius: a clipping wrapper rounds it. */}
          <div className="relative isolate overflow-hidden rounded-control bg-canvas ring-hairline [transform:translateZ(0)]">
            <video
              aria-label={one.name}
              // Safari draws no first frame for `metadata` alone; a start just past 0 makes it.
              src={`${attachmentUrl(one.id)}#t=0.001`}
              controls
              playsInline
              preload="metadata"
              // Its room held before it loads: the conversation stays scrolled to its end.
              className="block aspect-video max-h-80 w-full bg-canvas object-contain"
            />
          </div>
          {off(one, true)}
        </div>
      ))}
      {voices.map((one) => (
        <div key={one.id} className="group/thumb relative w-full max-w-xs">
          <VoiceMessage one={one} />
          {off(one, true)}
        </div>
      ))}
      {documents.map((one) => (
        <div key={one.id} className="flex min-w-0 flex-col items-start gap-1">
          <DocumentPages one={one} />
          <div className="flex max-w-full min-w-0 items-center">{chipOf(one)}</div>
        </div>
      ))}
      {files.length > 0 && (
        <ul aria-label="Dateien" className="flex min-w-0 flex-wrap gap-1">
          {files.map((one) => (
            <li key={one.id} className="flex max-w-full min-w-0 items-center">
              {chipOf(one)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Whether a sent file may show as its pages: a PDF or an office file, not a folder. */
function hasPages(one: Attachment): boolean {
  if (one.type === CLOUD_FOLDER_TYPE) return false;
  const kind = cloudFileType(one.name, one.type);
  return kind === 'pdf' || kind === 'document' || kind === 'presentation' || kind === 'spreadsheet';
}

/** A document's preview in a message: an upright page this tall, a slide this wide at most. */
const PAGES_HEIGHT = 400;
const PAGES_WIDTH = 512;

/** Bars only for a recording's size (5 minutes of voice are ~2 MB): a long song stays flat. */
const VOICE_BARS_UP_TO_BYTES = 4 * 1024 * 1024;
const VOICE_BARS = 64;

/** Its length as the browser reads it from the file's head – a recorded WebM may not say. */
function lengthOf(url: string): Promise<number> {
  return new Promise((resolve) => {
    const audio = new Audio();
    audio.preload = 'metadata';
    const done = () => resolve(Number.isFinite(audio.duration) ? audio.duration * 1000 : 0);
    audio.addEventListener('loadedmetadata', done, { once: true });
    audio.addEventListener('error', () => resolve(0), { once: true });
    audio.src = url;
  });
}

/**
 * How long a voice message is and how loud along the way – an attachment keeps neither. Decoded
 * where it is small enough; else (or where this browser cannot decode it) the length alone.
 */
async function voiceShape(
  url: string,
  size: number,
): Promise<{ durationMs: number; peaks: number[] }> {
  if (size > VOICE_BARS_UP_TO_BYTES) return { durationMs: await lengthOf(url), peaks: [] };
  try {
    const bytes = await (await fetch(url, { credentials: 'include' })).arrayBuffer();
    const sound = await new OfflineAudioContext(1, 1, 44_100).decodeAudioData(bytes);
    const samples = sound.getChannelData(0);
    const bars = Math.min(VOICE_BARS, samples.length);
    const levels = Array.from({ length: bars }, (_, bar) => {
      const from = Math.floor((bar * samples.length) / bars);
      const to = Math.floor(((bar + 1) * samples.length) / bars);
      let sum = 0;
      for (let at = from; at < to; at += 1) sum += (samples[at] ?? 0) ** 2;
      return Math.sqrt(sum / Math.max(1, to - from));
    });
    const loudest = Math.max(...levels, 0);
    return {
      durationMs: sound.duration * 1000,
      peaks: loudest > 0 ? levels.map((level) => Math.round((level / loudest) * 100) / 100) : [],
    };
  } catch {
    return { durationMs: await lengthOf(url), peaks: [] };
  }
}

/**
 * A voice message, played in the message as a voice comment is (`AudioPlayer`). Its length and
 * bars are read from the sound once it is there; till then the bars are even.
 */
function VoiceMessage({ one }: { one: Attachment }) {
  const src = attachmentUrl(one.id);
  const shape = useQuery({
    queryKey: ['voice-shape', one.id],
    queryFn: () => voiceShape(src, one.size),
    staleTime: Infinity,
    retry: false,
  });
  return (
    <AudioPlayer
      src={src}
      durationMs={shape.data?.durationMs ?? 0}
      peaks={shape.data?.peaks ?? []}
      className="w-full"
    />
  );
}

/**
 * A sent document's pages over its chip – Cloud's preview (`PageStrip`), sized to the file's
 * pages: an upload's drawn for it (`/attachments/:id/pages`), a Cloud file's as Cloud draws it.
 * Its room is held while the server draws it; one it cannot show (not drawable, not to be seen)
 * leaves the chip alone.
 */
function DocumentPages({ one }: { one: Attachment }) {
  const base = isCloudReference(one)
    ? `/cloud/nodes/${encodeURIComponent(one.nodeId!)}`
    : `/attachments/${encodeURIComponent(one.id)}`;
  const pages = useQuery({
    queryKey: ['attachment-pages', base],
    queryFn: () => api.get<{ pages: number; ratio?: number }>(`${base}/pages`),
    staleTime: Infinity,
    retry: false,
  });
  const [shape, setShape] = useState<number | null>(null);
  if (pages.isError) return null;
  const guess = cloudFileType(one.name, one.type) === 'presentation' ? 16 / 9 : 210 / 297;
  const ratio = pages.data?.ratio ?? shape ?? guess;
  const small = isCloudReference(one)
    ? `${API_PREFIX}${cloudPaths.thumbnail(one.nodeId!)}`
    : pages.data
      ? `${API_PREFIX}${base}/thumbnail`
      : null;
  return (
    <PageStrip
      count={pages.data?.pages ?? 1}
      ratio={ratio}
      pageSrc={(index) => (pages.data ? `${API_PREFIX}${base}/pages/${index + 1}` : null)}
      small={small}
      onShape={setShape}
      maxHeight={PAGES_HEIGHT}
      maxWidth={PAGES_WIDTH}
    />
  );
}
