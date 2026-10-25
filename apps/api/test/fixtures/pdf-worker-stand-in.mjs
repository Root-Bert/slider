// A stand-in for the PDF worker (pdf-worker.ts), in plain JavaScript so Node can start it: what
// it does is told by the bytes it is sent – `pages:<n>`, `encrypted` or `crash`; anything else (a
// real PDF too) makes it hang like pdf.js on a crafted file.
import { TextDecoder } from 'node:util';
import { parentPort } from 'node:worker_threads';

let next = null;
parentPort.on('message', async (message) => {
  if (message.type === 'next') {
    next?.();
    return;
  }
  const order = new TextDecoder().decode(message.bytes);
  if (order === 'crash') throw new Error('stand-in crashed');
  if (order === 'encrypted') {
    parentPort.postMessage({
      type: 'error',
      error: { name: 'PptxError', message: 'PDF is password protected', code: 'encrypted' },
    });
    return;
  }
  if (!order.startsWith('pages:')) for (;;);
  const pages = Number(order.split(':')[1]);
  parentPort.postMessage({ type: 'opened', pages });
  for (let index = 0; index < pages; index++) {
    const image = new Uint8Array([index, 1, 2]);
    const thumbnail = new Uint8Array([index]);
    const stored = new Promise((resolve) => (next = resolve));
    parentPort.postMessage({ type: 'page', index, image, thumbnail }, [
      image.buffer,
      thumbnail.buffer,
    ]);
    await stored;
  }
  parentPort.postMessage({ type: 'done', result: pages });
});
