import { createCanvas, loadImage } from '@napi-rs/canvas';
import type { UploadedEditImage, Viewer } from '@slider/shared';
import type { RembgConfig } from '../config';
import type { AppDeps } from '../deps';
import { ApiError, badRequest } from '../http/errors';
import { readBodyCapped } from '../sources/safe-fetch';
import { storeEditImage } from './edits/images';
import { editTarget, openFile, readFile, withFileProblems } from './edits/target';

/*
 * Pictures cut out from their background, for the AI's `cut_out`: rembg runs as a service of
 * its own next to Slider (REMBG_URL) with an open model (IS-Net by default), its edges freed of
 * the old background's colour. Optional – without it the AI is not offered the tool. One picture
 * at a time per API: the model takes all the CPU it gets for a few seconds, the others wait their
 * turn. To cut out one thing of several (only the wordmark of a logo, one car of a street),
 * the AI names its area: the picture is cut to it first, so the model sees that thing alone.
 * The editor's „Freistellen“ cuts out a picture element's whole picture the same way.
 */

/** rembg for the server; tests inject a fake (`deps.cutOuts`). */
export interface CutOutSource {
  /** The picture as a PNG with its background transparent. */
  cutOut(bytes: Uint8Array): Promise<Uint8Array>;
}

/** Waiting included: a queue of a few pictures on a small server. */
const TIMEOUT_MS = 180_000;
const MAX_RESULT_BYTES = 40 * 1024 ** 2;

class CutOutUnavailable extends ApiError {
  constructor(message = 'Das Freistellen ist gerade nicht erreichbar. Bitte gleich nochmal.') {
    super(503, 'source_unreachable', message);
  }
}

class RembgSource implements CutOutSource {
  private running: Promise<unknown> = Promise.resolve();

  constructor(private readonly config: RembgConfig) {}

  cutOut(bytes: Uint8Array): Promise<Uint8Array> {
    const turn = this.running.then(() => this.call(bytes));
    this.running = turn.catch(() => {});
    return turn;
  }

  private async call(bytes: Uint8Array): Promise<Uint8Array> {
    const form = new FormData();
    form.set('file', new Blob([Buffer.from(bytes)]), 'picture');
    form.set('model', this.config.model);
    // The old background's colour out of the soft edges.
    form.set('dc', 'true');
    let res: Response;
    try {
      res = await fetch(new URL('api/remove', this.config.url), {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new CutOutUnavailable();
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new CutOutUnavailable();
    }
    return readBodyCapped(res, MAX_RESULT_BYTES);
  }
}

const sources = new WeakMap<object, CutOutSource>();

/** rembg for this server, or `null` when REMBG_URL is not set. */
export function cutOutSource(deps: Pick<AppDeps, 'config' | 'cutOuts'>): CutOutSource | null {
  if (deps.cutOuts) return deps.cutOuts;
  const config = deps.config.rembg;
  if (!config) return null;
  let source = sources.get(config);
  if (!source) {
    source = new RembgSource(config);
    sources.set(config, source);
  }
  return source;
}

/**
 * `POST /decks/:id/edit/elements/:elementId/remove-background`: the picture element `elementId` shows,
 * cut out of its background – an edit picture ready for `replaceImage`, for who may edit the deck.
 */
export async function cutOutElement(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
  elementId: string,
): Promise<UploadedEditImage> {
  const { deck, revision } = await editTarget(deps, viewer, deckId);
  const source = cutOutSource(deps);
  if (!source) throw badRequest('Freistellen ist auf diesem Server nicht eingerichtet.');
  const document = await openFile(await readFile(deps, revision.pptxKey));
  const bytes = await withFileProblems(() => document.elementPicture(elementId));
  if (!bytes) throw badRequest('Dieses Element zeigt kein Bild, das sich freistellen lässt.');
  const { imageId, width, height } = await storeEditImage(
    deps,
    deck.id,
    await source.cutOut(bytes),
  );
  return { imageId, width, height };
}

/** A part of a picture in its pixels, from its top left corner. */
export interface PictureArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The part of a picture inside `area` (kept within the picture) as a PNG, or `null` when the
 * area misses it.
 */
export async function cropPicture(
  bytes: Uint8Array,
  area: PictureArea,
): Promise<{ bytes: Uint8Array; area: PictureArea } | null> {
  const image = await loadImage(Buffer.from(bytes));
  const left = Math.max(0, Math.round(area.x));
  const top = Math.max(0, Math.round(area.y));
  const right = Math.min(image.width, Math.round(area.x + area.width));
  const bottom = Math.min(image.height, Math.round(area.y + area.height));
  if (right - left < 1 || bottom - top < 1) return null;
  const width = right - left;
  const height = bottom - top;
  const canvas = createCanvas(width, height);
  canvas.getContext('2d').drawImage(image, left, top, width, height, 0, 0, width, height);
  return {
    bytes: new Uint8Array(await canvas.encode('png')),
    area: { x: left, y: top, width, height },
  };
}
