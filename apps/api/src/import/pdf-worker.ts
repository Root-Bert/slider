import { parentPort } from 'node:worker_threads';
import { toWorkerError, type FromPdfWorker, type ToPdfWorker } from './pdf-jobs';
import { drawCutoutPages, drawLayerPages, drawPdfPages, readPdfDeck } from './pdf-render';

/*
 * The PDF worker (`pdf-jobs.ts` starts one per PDF): reads the PDF it is sent and answers with
 * plain data. Pages are sent one at a time, the next drawn only once the host stored the last –
 * so only one page's images are in memory, however long the deck.
 */

const port = parentPort;
if (!port) throw new Error('pdf-worker.ts runs as a worker thread only');

const send = (message: FromPdfWorker, transfer: ArrayBuffer[] = []) =>
  port.postMessage(message, transfer);

/** Resolvers of the pages waiting for the host's `next`. */
const waiting: (() => void)[] = [];

port.on('message', (message: ToPdfWorker) => {
  if (message.type === 'next') {
    waiting.shift()?.();
    return;
  }
  void run(message).then(
    (result) => send({ type: 'done', result }),
    (error: unknown) => send({ type: 'error', error: toWorkerError(error) }),
  );
});

function run(task: ToPdfWorker & { type: 'run' }) {
  const onOpened = (pages: number) => send({ type: 'opened', pages });
  if (task.kind === 'deck') return readPdfDeck(task.bytes, onOpened);
  if (task.kind === 'cutout') return drawCutoutPages(task.bytes);
  if (task.kind === 'layers') return drawLayerPages(task.bytes, task.background ?? true);
  return drawPdfPages(
    task.bytes,
    async (page, index) => {
      const stored = new Promise<void>((resolve) => waiting.push(resolve));
      // Moved, not copied: the worker does not need them any more.
      send({ type: 'page', index, image: page.image, thumbnail: page.thumbnail }, [
        page.image.buffer as ArrayBuffer,
        page.thumbnail.buffer as ArrayBuffer,
      ]);
      await stored;
    },
    { expectedPages: task.expectedPages, onOpened, picture: task.picture },
  );
}
