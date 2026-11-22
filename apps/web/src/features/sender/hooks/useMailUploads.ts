import { useEffect, useRef, useState } from 'react';
import {
  MAX_MAIL_ATTACHED_BYTES,
  MAX_MAIL_UPLOAD_BYTES,
  MAX_MAIL_UPLOADS,
  type MailUpload,
} from '@slider/shared';
import { dropMailUpload, uploadMailFile } from '@/lib/api';

/** A file on its way up: shown at once, with how far it is. */
export interface PendingUpload {
  key: string;
  name: string;
  size: number;
  progress: number;
}

/**
 * The files put on a mail being written: added (picked, dropped, pasted) they show at once and go
 * up; up, they are the draft's (`onChange` keeps them with its words). Too big, too many or
 * refused: said, not put on.
 */
export function useMailUploads({
  accountId,
  uploads,
  onChange,
  notify,
}: {
  accountId: string;
  uploads: readonly MailUpload[];
  onChange: (uploads: MailUpload[]) => void;
  notify: (text: string, tone: 'danger') => void;
}) {
  const [pending, setPending] = useState<PendingUpload[]>([]);
  // The list as last handed on – files that land one after another add to each other.
  const latest = useRef<readonly MailUpload[]>(uploads);
  useEffect(() => {
    latest.current = uploads;
  }, [uploads]);
  const inFlight = useRef(new Map<string, AbortController>());
  useEffect(() => {
    const flying = inFlight.current;
    return () => {
      for (const controller of flying.values()) controller.abort();
    };
  }, []);

  const add = (files: readonly File[]) => {
    let size =
      latest.current.reduce((sum, one) => sum + one.size, 0) +
      pending.reduce((sum, one) => sum + one.size, 0);
    let count = latest.current.length + pending.length;
    for (const file of files) {
      if (file.size > MAX_MAIL_UPLOAD_BYTES) {
        notify(`„${file.name}“ ist zu groß – höchstens 20 MB je Datei.`, 'danger');
        continue;
      }
      if (size + file.size > MAX_MAIL_ATTACHED_BYTES) {
        notify('Zusammen höchstens 25 MB Anhänge je Mail.', 'danger');
        break;
      }
      if (count >= MAX_MAIL_UPLOADS) {
        notify(`Höchstens ${MAX_MAIL_UPLOADS} Anhänge je Mail.`, 'danger');
        break;
      }
      size += file.size;
      count += 1;
      const key = crypto.randomUUID();
      const controller = new AbortController();
      inFlight.current.set(key, controller);
      setPending((now) => [...now, { key, name: file.name, size: file.size, progress: 0 }]);
      const settle = () => {
        inFlight.current.delete(key);
        setPending((now) => now.filter((one) => one.key !== key));
      };
      uploadMailFile(
        accountId,
        file,
        (progress) =>
          setPending((now) => now.map((one) => (one.key === key ? { ...one, progress } : one))),
        controller.signal,
      ).then(
        (upload) => {
          settle();
          const next = [...latest.current, upload];
          latest.current = next;
          onChange(next);
        },
        (error: unknown) => {
          settle();
          if (controller.signal.aborted) return;
          const why = error instanceof Error ? error.message : 'Fehler';
          notify(`„${file.name}“ nicht angehängt: ${why}`, 'danger');
        },
      );
    }
  };

  /** A file taken off – or one still on its way, stopped. */
  const remove = (id: string) => {
    const flying = inFlight.current.get(id);
    if (flying) {
      flying.abort();
      return;
    }
    const next = latest.current.filter((one) => one.id !== id);
    latest.current = next;
    onChange(next);
    void dropMailUpload(id);
  };

  return { pending, add, remove };
}
