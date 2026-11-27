import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
} from 'react';
import {
  attachmentLimit,
  isCloudReference,
  isPictureAttachment,
  isAudioAttachment,
  isVideoAttachment,
  MAX_ATTACHMENTS,
  type Attachment,
} from '@slider/shared';
import { digestVideo, dropAttachment, uploadAttachment } from '@/lib/api';
import { audioDigestForm, videoDigestForm } from './lib/video-digest';

/** A file put on what is being written: up already (`id`), or on its way (`progress`). */
export interface FieldAttachment {
  /** The upload's id once up; a key of its own while on its way. */
  key: string;
  name: string;
  type: string;
  size: number;
  /** 0–1 while it goes up; `null` once up. */
  progress: number | null;
  /** A picture's preview from the file itself (`blob:`), shown at once. */
  preview: string | null;
  /** Up: what is sent along. */
  attachment: Attachment | null;
}

/**
 * The files on a field when one comes back to it (another conversation picked and back), by the
 * field's key – for this tab's life; never sent, the server sweeps them after a week.
 */
const kept = new Map<string, FieldAttachment[]>();

/**
 * What was copied, as files to put on a field: screenshots, copied pictures, files copied in the
 * Finder or Explorer. Copied text that comes with pictures (a spreadsheet's cells, a Word
 * passage) stays a normal paste of text.
 */
export function filesFromClipboard(data: DataTransfer | null): File[] {
  if (!data || data.files.length === 0) return [];
  if (data.types.includes('text/html') || data.types.includes('text/rtf')) return [];
  return [...data.files];
}

/**
 * The files put on a field being written – pasted into it or picked with the clip, several at
 * once: each shows at once and goes up into the workspace (`POST …/attachments`); sent, their
 * ids go along (`ids`) and the field is cleared (`clear`). Too big, too many or refused: said
 * (`error`, or `onError` where the page has toasts), not put on. `accept: 'pictures'` takes
 * pictures only (where only a picture means something). `keep`: kept by this key when the field
 * goes and comes back.
 */
export function useAttachments({
  workspaceId,
  keep,
  accept = 'files',
  onError,
}: {
  workspaceId: string | null | undefined;
  keep?: string;
  accept?: 'files' | 'pictures';
  onError?: (text: string) => void;
}) {
  const [items, setItems] = useState<FieldAttachment[]>(() => (keep && kept.get(keep)) || []);
  const [error, setError] = useState<string | null>(null);
  const current = useRef(items);
  const flying = useRef(new Map<string, AbortController>());
  const keepRef = useRef(keep);

  const update = useCallback((next: FieldAttachment[]) => {
    current.current = next;
    setItems(next);
    const key = keepRef.current;
    if (key) {
      if (next.length > 0) kept.set(key, next);
      else kept.delete(key);
    }
  }, []);

  // Another field's key (another conversation in the same composer): its files.
  const [field, setField] = useState(keep);
  if (field !== keep) {
    setField(keep);
    setItems((keep && kept.get(keep)) || []);
  }
  useLayoutEffect(() => {
    keepRef.current = keep;
    current.current = items;
  });

  // Gone without being kept: what is still going up stops, the previews go.
  useEffect(() => {
    const inFlight = flying.current;
    return () => {
      if (keepRef.current) return;
      for (const controller of inFlight.values()) controller.abort();
      for (const one of current.current) if (one.preview) URL.revokeObjectURL(one.preview);
    };
  }, []);

  const say = useCallback(
    (text: string) => {
      if (onError) onError(text);
      else setError(text);
    },
    [onError],
  );

  const add = useCallback(
    (files: readonly File[]) => {
      if (files.length === 0 || !workspaceId) return;
      setError(null);
      const taken =
        accept === 'pictures' ? files.filter((file) => isPictureAttachment(file.type)) : [...files];
      if (taken.length < files.length) say('Hier gehen nur Bilder (PNG, JPEG, GIF, WebP).');
      let count = current.current.length;
      for (const file of taken) {
        if (file.size > attachmentLimit(file.type)) {
          say(
            isVideoAttachment(file.type)
              ? `„${file.name}“ ist zu groß – höchstens 200 MB je Video.`
              : `„${file.name}“ ist zu groß – höchstens 25 MB je Datei.`,
          );
          continue;
        }
        if (count >= MAX_ATTACHMENTS) {
          say(`Höchstens ${MAX_ATTACHMENTS} Dateien auf einmal.`);
          break;
        }
        count += 1;
        const key = crypto.randomUUID();
        const controller = new AbortController();
        flying.current.set(key, controller);
        const type = file.type || 'application/octet-stream';
        const field = keepRef.current;
        const item: FieldAttachment = {
          key,
          name: file.name || 'Datei',
          type,
          size: file.size,
          progress: 0,
          preview: isPictureAttachment(type) ? URL.createObjectURL(file) : null,
          attachment: null,
        };
        update([...current.current, item]);
        // Lands in the field it was put on, though another is shown meanwhile.
        const change = (map: (list: FieldAttachment[]) => FieldAttachment[]) => {
          if (keepRef.current === field) update(map(current.current));
          else if (field) {
            const list = map(kept.get(field) ?? []);
            if (list.length > 0) kept.set(field, list);
            else kept.delete(field);
          }
        };
        // A video's stills and sound (a voice message's sound), taken while it goes up: the AI
        // reads it by them. Up only once they are handed over – an agent answering at once has them.
        const digest = isVideoAttachment(type)
          ? videoDigestForm(file, controller.signal).catch(() => null)
          : isAudioAttachment(type)
            ? audioDigestForm(file, controller.signal).catch(() => null)
            : null;
        uploadAttachment(
          workspaceId,
          file,
          (progress) =>
            change((list) => list.map((one) => (one.key === key ? { ...one, progress } : one))),
          controller.signal,
        )
          .then(async (attachment) => {
            const form = await digest;
            if (form) await digestVideo(attachment.id, form, controller.signal).catch(() => null);
            controller.signal.throwIfAborted();
            return attachment;
          })
          .then(
            (attachment) => {
              flying.current.delete(key);
              change((list) =>
                list.map((one) =>
                  one.key === key
                    ? { ...one, key: attachment.id, progress: null, attachment }
                    : one,
                ),
              );
            },
            (reason: unknown) => {
              flying.current.delete(key);
              change((list) => list.filter((one) => one.key !== key));
              if (item.preview) URL.revokeObjectURL(item.preview);
              if (controller.signal.aborted) return;
              const why = reason instanceof Error ? reason.message : 'Fehler';
              say(`„${item.name}“ nicht angehängt: ${why}`);
            },
          );
      }
    },
    [accept, say, update, workspaceId],
  );

  /**
   * Cloud files and folders dropped on the field (`useCloudDrop`): pointed to, not copied – no
   * upload, nothing to wait for. Each once.
   */
  const point = useCallback(
    (refs: readonly Attachment[]) => {
      if (refs.length === 0 || !workspaceId) return;
      setError(null);
      if (accept === 'pictures') {
        say('Hier gehen nur Bilder von deinem Gerät.');
        return;
      }
      const fresh = refs.filter((ref) => !current.current.some((one) => one.key === ref.id));
      const room = MAX_ATTACHMENTS - current.current.length;
      if (fresh.length > room) say(`Höchstens ${MAX_ATTACHMENTS} Dateien auf einmal.`);
      const added = fresh.slice(0, Math.max(0, room)).map((ref): FieldAttachment => ({
        key: ref.id,
        name: ref.name,
        type: ref.type,
        size: ref.size,
        progress: null,
        preview: null,
        attachment: ref,
      }));
      if (added.length > 0) update([...current.current, ...added]);
    },
    [accept, say, update, workspaceId],
  );

  /** A file taken off – or one still on its way, stopped. */
  const remove = useCallback(
    (key: string) => {
      setError(null);
      const one = current.current.find((each) => each.key === key);
      if (!one) return;
      flying.current.get(key)?.abort();
      if (one.preview) URL.revokeObjectURL(one.preview);
      update(current.current.filter((each) => each.key !== key));
      // A Cloud file pointed to stays where it is; only an upload of one's own goes.
      if (one.attachment && !isCloudReference(one.attachment))
        void dropAttachment(one.attachment.id);
    },
    [update],
  );

  /** Out of the field, kept up: it went with a message of its own (a voice message). */
  const take = useCallback(
    (key: string) => update(current.current.filter((each) => each.key !== key)),
    [update],
  );

  /** Sent: the field is empty again (the files are the message's now – not dropped). */
  const clear = useCallback(() => {
    setError(null);
    for (const one of current.current) if (one.preview) URL.revokeObjectURL(one.preview);
    update([]);
  }, [update]);

  /** Back into the field (the message was refused): as they were. */
  const restore = useCallback(
    (list: readonly Attachment[]) => {
      if (list.length === 0) return;
      const back = list.map((attachment): FieldAttachment => ({
        key: attachment.id,
        name: attachment.name,
        type: attachment.type,
        size: attachment.size,
        progress: null,
        preview: null,
        attachment,
      }));
      update([...back, ...current.current]);
    },
    [update],
  );

  const onPaste = useCallback(
    (event: ClipboardEvent<HTMLElement>) => {
      const files = filesFromClipboard(event.clipboardData);
      if (files.length === 0 || !workspaceId) return;
      event.preventDefault();
      add(files);
    },
    [add, workspaceId],
  );

  const ready = items.flatMap((one) => (one.attachment ? [one.attachment] : []));
  return {
    items,
    /** What is up, to send along. */
    ready,
    ids: ready.map((one) => one.id),
    /** Files still going up: nothing is sent before they are. */
    busy: items.some((one) => one.progress !== null),
    /** Free to put on more. */
    room: Math.max(0, MAX_ATTACHMENTS - items.length),
    enabled: !!workspaceId,
    workspaceId: workspaceId ?? null,
    accept,
    error,
    add,
    point,
    remove,
    take,
    clear,
    restore,
    onPaste,
  };
}

export type Attachments = ReturnType<typeof useAttachments>;
