import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { MAX_READER_SIGNATURE_CHARS, type ReaderSignature } from '@slider/shared';
import { useDeleteSignature, useSaveSignature, useSignatures } from '@/lib/api';
import { Button, cn, IconButton, SegmentedControl } from '@/ui';
import { useReader } from './session';

type Way = 'draw' | 'type' | 'image';

const WIDTH = 600;
const HEIGHT = 200;
const INK = '#0b1f4d';
const SCRIPT = "'Segoe Script', 'Brush Script MT', 'Snell Roundhand', 'Apple Chancery', cursive";

/** A signature picked: its picture and its shape (width / height). */
export interface PickedSignature {
  image: string;
  ratio: number;
}

/**
 * „Unterschrift“, beside the tool: one's kept signatures to pick, or a new one – drawn, typed
 * or brought as a picture – kept for the next time. Picked, it is put down with a click on
 * the page.
 */
export function SignaturePanel({ onPick }: { onPick: (signature: PickedSignature) => void }) {
  const { notify } = useReader();
  const kept = useSignatures();
  const save = useSaveSignature();
  const remove = useDeleteSignature();
  const list = kept.data ?? [];
  const [making, setMaking] = useState(false);
  const showMaker = making || (kept.isSuccess && list.length === 0);

  const use = (signature: Pick<ReaderSignature, 'image' | 'width' | 'height'>) =>
    onPick({ image: signature.image, ratio: signature.width / signature.height });

  if (!showMaker) {
    return (
      <div className="flex w-72 flex-col gap-2 p-1">
        <ul className="flex flex-col gap-1.5" aria-label="Deine Unterschriften">
          {list.map((signature) => (
            <li key={signature.id} className="group relative">
              <button
                type="button"
                onClick={() => use(signature)}
                className="focus-ring flex h-20 w-full items-center justify-center rounded-control-sm bg-white p-2 ring-1 ring-hairline transition-shadow hover:ring-fg-subtle"
                aria-label="Diese Unterschrift setzen"
              >
                <img
                  src={signature.image}
                  alt=""
                  className="max-h-full max-w-full object-contain"
                />
              </button>
              <IconButton
                icon="delete"
                label="Unterschrift löschen"
                size="compact"
                variant="subtle"
                className="absolute top-1 right-1 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
                onClick={() =>
                  remove.mutate(signature.id, {
                    onSuccess: () => notify('Unterschrift gelöscht'),
                    onError: (error) => notify(error.message, 'danger'),
                  })
                }
              />
            </li>
          ))}
        </ul>
        <Button variant="ghost" size="sm" icon="add" onClick={() => setMaking(true)}>
          Neue Unterschrift
        </Button>
      </div>
    );
  }

  return (
    <Maker
      canGoBack={list.length > 0}
      onBack={() => setMaking(false)}
      onDone={(made) => {
        if (made.image.length > MAX_READER_SIGNATURE_CHARS) {
          notify('Die Unterschrift ist zu groß', 'danger');
          return;
        }
        // Put down at once; kept for the next time on the side.
        setMaking(false);
        use(made);
        save.mutate(made, {
          onError: (error) => notify(`Unterschrift nicht gespeichert: ${error.message}`, 'danger'),
        });
      }}
    />
  );
}

function Maker({
  canGoBack,
  onBack,
  onDone,
}: {
  canGoBack: boolean;
  onBack: () => void;
  onDone: (made: { image: string; width: number; height: number }) => void;
}) {
  const { me } = useReader();
  const [way, setWay] = useState<Way>('draw');
  const [name, setName] = useState(me.name);
  const [picture, setPicture] = useState<HTMLCanvasElement | null>(null);
  const pad = useRef<HTMLCanvasElement>(null);
  const [inked, setInked] = useState(false);
  const stroke = useRef<{ id: number; x: number; y: number } | null>(null);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const context = pad.current?.getContext('2d');
    if (!context) return;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = INK;
    context.lineWidth = 4;
  }, [way]);

  const point = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const frame = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - frame.left) / frame.width) * WIDTH,
      y: ((event.clientY - frame.top) / frame.height) * HEIGHT,
    };
  };
  const down = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const at = point(event);
    stroke.current = { id: event.pointerId, ...at };
    const context = event.currentTarget.getContext('2d')!;
    context.beginPath();
    context.arc(at.x, at.y, 2, 0, Math.PI * 2);
    context.fillStyle = INK;
    context.fill();
    setInked(true);
  };
  const drawTo = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const from = stroke.current;
    if (from?.id !== event.pointerId) return;
    const context = event.currentTarget.getContext('2d')!;
    // Every point the pen passed, not only the frames' ones.
    for (const each of event.nativeEvent.getCoalescedEvents?.() ?? [event.nativeEvent]) {
      const frame = event.currentTarget.getBoundingClientRect();
      const at = {
        x: ((each.clientX - frame.left) / frame.width) * WIDTH,
        y: ((each.clientY - frame.top) / frame.height) * HEIGHT,
      };
      context.beginPath();
      context.moveTo(stroke.current!.x, stroke.current!.y);
      context.lineTo(at.x, at.y);
      context.stroke();
      stroke.current = { id: from.id, ...at };
    }
  };
  const clear = () => {
    pad.current?.getContext('2d')?.clearRect(0, 0, WIDTH, HEIGHT);
    setInked(false);
  };

  const bring = async (picked: File) => {
    try {
      const bitmap = await createImageBitmap(picked);
      const scale = Math.min(1, WIDTH / bitmap.width, (HEIGHT * 2) / bitmap.height);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d')!;
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      // A scan's white paper goes: only the ink stays.
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      const data = pixels.data;
      for (let index = 0; index < data.length; index += 4) {
        const light = (data[index]! + data[index + 1]! + data[index + 2]!) / 3;
        if (light > 225) data[index + 3] = 0;
        else if (light > 180) data[index + 3] = Math.round(((225 - light) / 45) * data[index + 3]!);
      }
      context.putImageData(pixels, 0, 0);
      setPicture(canvas);
    } catch {
      setPicture(null);
    }
  };

  const typed = () => {
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const context = canvas.getContext('2d')!;
    let size = 96;
    context.font = `${size}px ${SCRIPT}`;
    while (size > 24 && context.measureText(name).width > WIDTH - 40) {
      size -= 4;
      context.font = `${size}px ${SCRIPT}`;
    }
    context.fillStyle = INK;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(name.trim(), WIDTH / 2, HEIGHT / 2);
    return canvas;
  };

  const ready = way === 'draw' ? inked : way === 'type' ? name.trim() !== '' : picture !== null;
  const done = () => {
    const source = way === 'draw' ? pad.current : way === 'type' ? typed() : picture;
    if (!source) return;
    const cut = trim(source);
    if (!cut) return;
    onDone({ image: cut.toDataURL('image/png'), width: cut.width, height: cut.height });
  };

  return (
    <div className="flex w-80 flex-col gap-3 p-1">
      <SegmentedControl
        label="Wie unterschreiben"
        size="sm"
        track="soft"
        fill
        value={way}
        onChange={setWay}
        segments={[
          { value: 'draw', label: 'Zeichnen' },
          { value: 'type', label: 'Tippen' },
          { value: 'image', label: 'Bild' },
        ]}
      />
      <div className="relative h-28 overflow-hidden rounded-control-sm bg-white ring-1 ring-hairline">
        {way === 'draw' && (
          <>
            <canvas
              ref={pad}
              width={WIDTH}
              height={HEIGHT}
              aria-label="Hier unterschreiben"
              className="size-full cursor-crosshair touch-none"
              onPointerDown={down}
              onPointerMove={drawTo}
              onPointerUp={() => (stroke.current = null)}
              onPointerCancel={() => (stroke.current = null)}
            />
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-6 bottom-6 border-b border-black/20"
            />
            {inked && (
              <button
                type="button"
                onClick={clear}
                className="focus-ring absolute top-1.5 right-2 rounded px-1.5 text-caption text-black/50 hover:text-black/80"
              >
                Neu
              </button>
            )}
          </>
        )}
        {way === 'type' && (
          <input
            autoFocus
            aria-label="Name"
            value={name}
            maxLength={60}
            onChange={(event) => setName(event.target.value)}
            className="size-full bg-transparent px-4 text-center text-[2.1rem] outline-none"
            style={{ fontFamily: SCRIPT, color: INK }}
          />
        )}
        {way === 'image' && (
          <button
            type="button"
            onClick={() => file.current?.click()}
            className={cn(
              'focus-ring flex size-full items-center justify-center text-body',
              picture ? '' : 'text-black/50 hover:text-black/80',
            )}
          >
            {picture ? (
              <img src={picture.toDataURL()} alt="" className="max-h-full max-w-full p-2" />
            ) : (
              'Bild wählen'
            )}
          </button>
        )}
        <input
          ref={file}
          type="file"
          hidden
          accept="image/png,image/jpeg,image/webp"
          onChange={(event) => {
            const picked = event.target.files?.[0];
            event.target.value = '';
            if (picked) void bring(picked);
          }}
        />
      </div>
      <div className="flex items-center justify-between gap-2">
        {canGoBack ? (
          <Button variant="ghost" size="sm" onClick={onBack}>
            Zurück
          </Button>
        ) : (
          <span />
        )}
        <Button size="sm" disabled={!ready} onClick={done}>
          Unterschrift setzen
        </Button>
      </div>
    </div>
  );
}

/** The ink only: the picture cut to what is drawn on it, with a little air. */
function trim(source: HTMLCanvasElement): HTMLCanvasElement | null {
  const context = source.getContext('2d');
  if (!context) return null;
  const { width, height } = source;
  const data = context.getImageData(0, 0, width, height).data;
  let top = height;
  let left = width;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * 4 + 3]! > 16) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        bottom = y;
      }
    }
  }
  if (right < 0) return null;
  const air = 6;
  left = Math.max(0, left - air);
  top = Math.max(0, top - air);
  right = Math.min(width - 1, right + air);
  bottom = Math.min(height - 1, bottom + air);
  const cut = document.createElement('canvas');
  cut.width = right - left + 1;
  cut.height = bottom - top + 1;
  cut
    .getContext('2d')!
    .drawImage(source, left, top, cut.width, cut.height, 0, 0, cut.width, cut.height);
  return cut;
}
