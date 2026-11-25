import type { Author } from '@slider/shared';
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { makeProfessionalPicture, useDeletePicture, useMePicture, useSetPicture } from '@/lib/api';
import { Avatar, Button, ConfirmDialog, Spinner, TextField, type ShowToast } from '@/ui';

/** Width and height a photo is sent at – the server draws the kept picture smaller still. */
const PHOTO_SIDE = 1024;
/** What one wishes for when nothing else is typed – the frame round it is the server's. */
const DEFAULT_WISH = 'Professionelles Bild';

/** The middle square of `source`, `PHOTO_SIDE` wide, as a JPEG – mirrored like the camera's view. */
async function squarePhoto(
  source: CanvasImageSource,
  width: number,
  height: number,
  mirrored = false,
): Promise<Blob> {
  const side = Math.min(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = Math.min(PHOTO_SIDE, side);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Das Bild ließ sich nicht zeichnen.');
  if (mirrored) {
    context.translate(canvas.width, 0);
    context.scale(-1, 1);
  }
  context.drawImage(
    source,
    (width - side) / 2,
    (height - side) / 2,
    side,
    side,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/jpeg', 0.92));
  if (!blob) throw new Error('Das Bild ließ sich nicht zeichnen.');
  return blob;
}

/** A picked file as a square JPEG – any format the browser reads (HEIC in Safari too). */
async function squareFile(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode().catch(() => {
      throw new Error('Das geht nicht als Bild – bitte ein Foto als JPEG, PNG oder WebP.');
    });
    return await squarePhoto(image, image.naturalWidth, image.naturalHeight);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Why the camera could not be had, as the calls say it. */
function cameraRefusal(error: unknown): string {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return 'Kein Zugriff auf die Kamera – erlaube es in den Einstellungen des Browsers.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Keine Kamera gefunden.';
  if (name === 'NotReadableError')
    return 'Die Kamera wird gerade von einem anderen Programm benutzt.';
  return 'Die Kamera ließ sich nicht starten.';
}

const message = (error: unknown) =>
  error instanceof Error && error.message ? error.message : 'Das ging nicht.';

/** „Profibild mit KI“ in the page: camera, the photo with a wish, the portrait – taken or not. */
type Step =
  | { kind: 'camera' }
  | { kind: 'photo'; photo: Blob }
  | { kind: 'making'; photo: Blob }
  | { kind: 'made'; photo: Blob; made: Blob };

/**
 * One's own picture (Konto › Profil), shown wherever one's avatar is: „Bild hochladen“, or
 * „Profibild mit KI“ – the camera opens in the page, the photo goes to the image model with a wish
 * („Professionelles Bild“), the portrait shows beside it and is kept only with „Übernehmen“. The
 * AI only where a workspace's image model goes after a photo (`MePicture.ai`).
 */
export function ProfilePicture({ author, onNotify }: { author: Author; onNotify: ShowToast }) {
  const own = useMePicture();
  const setPicture = useSetPicture();
  const deletePicture = useDeletePicture();
  const [deleting, setDeleting] = useState(false);
  const [step, setStep] = useState<Step | null>(null);
  const [wish, setWish] = useState(DEFAULT_WISH);
  const upload = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const making = useRef<AbortController | null>(null);
  useEffect(() => () => making.current?.abort(), []);

  const keep = (picture: Blob, after?: () => void) =>
    setPicture.mutate(picture, {
      onSuccess: () => after?.(),
      onError: (error) => onNotify(message(error), 'danger'),
    });

  const picked = async (file: File | undefined, next: (square: Blob) => void) => {
    if (!file) return;
    try {
      next(await squareFile(file));
    } catch (error) {
      onNotify(message(error), 'danger');
    }
  };

  const make = (photo: Blob) => {
    making.current?.abort();
    const controller = new AbortController();
    making.current = controller;
    setStep({ kind: 'making', photo });
    makeProfessionalPicture(photo, wish.trim() || DEFAULT_WISH, controller.signal).then(
      (made) => {
        if (!controller.signal.aborted) setStep({ kind: 'made', photo, made });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setStep({ kind: 'photo', photo });
        onNotify(message(error), 'danger');
      },
    );
  };

  const cancel = () => {
    making.current?.abort();
    setStep(null);
  };

  const url = own.data?.url ?? undefined;
  const busy = setPicture.isPending || deletePicture.isPending;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <Avatar author={author} size={64} picture={url} />
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            icon="upload"
            loading={setPicture.isPending && step === null}
            disabled={busy}
            onClick={() => upload.current?.click()}
          >
            Bild hochladen
          </Button>
          {own.data?.ai && step === null && (
            <Button
              variant="secondary"
              size="sm"
              icon="autoAwesome"
              disabled={busy}
              onClick={() => setStep({ kind: 'camera' })}
            >
              Profibild mit KI
            </Button>
          )}
          {url && (
            <Button
              variant="ghost"
              size="sm"
              icon="delete"
              disabled={busy}
              onClick={() => setDeleting(true)}
            >
              Löschen
            </Button>
          )}
        </div>
        <input
          ref={upload}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            void picked(file, (square) => keep(square));
          }}
        />
        <input
          ref={photoInput}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            void picked(file, (photo) => setStep({ kind: 'photo', photo }));
          }}
        />
      </div>

      {step?.kind === 'camera' && (
        <CameraShot
          onShot={(photo) => setStep({ kind: 'photo', photo })}
          onPickFile={() => photoInput.current?.click()}
          onCancel={cancel}
          onRefused={(why) => {
            setStep(null);
            onNotify(why, 'danger');
          }}
        />
      )}

      {(step?.kind === 'photo' || step?.kind === 'making') && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-start gap-4">
            <Square blob={step.photo} label="Dein Foto" />
            {step.kind === 'making' && (
              <div className="flex size-48 flex-col items-center justify-center gap-2 rounded-card bg-surface-2 text-body text-fg-subtle">
                <Spinner size={20} />
                Die KI macht dein Bild …
              </div>
            )}
          </div>
          <form
            className="flex max-w-xl flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (step.kind === 'photo') make(step.photo);
            }}
          >
            <TextField
              label="Wie soll es werden?"
              value={wish}
              maxLength={300}
              className="min-w-60 flex-1"
              disabled={step.kind === 'making'}
              onChange={(event) => setWish(event.target.value)}
            />
            <Button type="submit" size="field" icon="autoAwesome" disabled={step.kind === 'making'}>
              Profibild machen
            </Button>
          </form>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              icon="photoCamera"
              onClick={() => {
                making.current?.abort();
                setStep({ kind: 'camera' });
              }}
            >
              Neues Foto
            </Button>
            <Button variant="ghost" size="sm" onClick={cancel}>
              Abbrechen
            </Button>
          </div>
        </div>
      )}

      {step?.kind === 'made' && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-start gap-4">
            <Square blob={step.photo} label="Dein Foto" />
            <Square blob={step.made} label="Profibild" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              icon="check"
              loading={setPicture.isPending}
              disabled={setPicture.isPending}
              onClick={() => keep(step.made, () => setStep(null))}
            >
              Übernehmen
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon="refresh"
              disabled={setPicture.isPending}
              onClick={() => make(step.photo)}
            >
              Nochmal
            </Button>
            <Button variant="ghost" size="sm" disabled={setPicture.isPending} onClick={cancel}>
              Abbrechen
            </Button>
          </div>
        </div>
      )}

      {deleting && (
        <ConfirmDialog
          onClose={() => setDeleting(false)}
          title="Bild löschen?"
          description="Dein Avatar zeigt dann wieder das Bild, das zu deinem Namen gehört."
          confirmLabel="Löschen"
          confirmIcon="delete"
          pending={deletePicture.isPending}
          error={deletePicture.error?.message}
          onConfirm={() => deletePicture.mutate(undefined, { onSuccess: () => setDeleting(false) })}
        />
      )}
    </div>
  );
}

/** A photo or picture, square, with what it is under it. */
function Square({ blob, label }: { blob: Blob; label: string }) {
  const url = useMemo(() => URL.createObjectURL(blob), [blob]);
  return (
    <figure className="flex flex-col gap-1.5">
      <img
        src={url}
        alt={label}
        // Once drawn it stays shown: the link is let go then.
        onLoad={() => URL.revokeObjectURL(url)}
        className="size-48 rounded-card bg-surface-2 object-cover"
      />
      <figcaption className="text-xs text-fg-subtle">{label}</figcaption>
    </figure>
  );
}

/** The camera's view in the page, mirrored as in a mirror; „Foto machen“ takes its middle square. */
function CameraShot({
  onShot,
  onPickFile,
  onCancel,
  onRefused,
}: {
  onShot: (photo: Blob) => void;
  onPickFile: () => void;
  onCancel: () => void;
  onRefused: (why: string) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  const refuse = useEffectEvent(onRefused);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let gone = false;
    if (!navigator.mediaDevices?.getUserMedia) {
      refuse('Dieser Browser kann keine Kamera zeigen.');
      return;
    }
    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 1280 } },
        audio: false,
      })
      .then(
        (got) => {
          if (gone) return got.getTracks().forEach((track) => track.stop());
          stream = got;
          if (video.current) video.current.srcObject = got;
        },
        (error: unknown) => {
          if (!gone) refuse(cameraRefusal(error));
        },
      );
    // Off whenever the view goes: a shot, „Abbrechen“, leaving the page.
    return () => {
      gone = true;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const shoot = async () => {
    const view = video.current;
    if (!view || !view.videoWidth) return;
    try {
      onShot(await squarePhoto(view, view.videoWidth, view.videoHeight, true));
    } catch (error) {
      onRefused(message(error));
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="relative size-64 overflow-hidden rounded-card bg-surface-2">
        <video
          ref={video}
          autoPlay
          playsInline
          muted
          onLoadedData={() => setReady(true)}
          className="size-full -scale-x-100 object-cover"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" icon="photoCamera" disabled={!ready} onClick={() => void shoot()}>
          Foto machen
        </Button>
        <Button variant="ghost" size="sm" icon="upload" onClick={onPickFile}>
          Foto auswählen
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Abbrechen
        </Button>
      </div>
    </div>
  );
}
