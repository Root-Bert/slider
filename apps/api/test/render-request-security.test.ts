import { expect, it } from 'vitest';
import { MAX_JSON_BODY_BYTES } from '../src/http/validate';
import { createTestContext } from './helpers';

it('caps render options before deck access, including streamed bodies without Content-Length', async () => {
  const ctx = await createTestContext();
  try {
    const deck = crypto.randomUUID();
    for (const suffix of [
      'elements/absent/background',
      'elements/absent/cutout',
      'slides/absent/layers',
    ]) {
      const url = `/api/decks/${deck}/edit/${suffix}`;
      expect((await ctx.request(url, { method: 'POST' })).status).toBe(404);
      expect(
        (await ctx.request(url, { method: 'POST', json: { priority: 'background' } })).status,
      ).toBe(404);
      expect((await ctx.request(url, { method: 'POST', body: '{invalid' })).status).toBe(400);
      expect(
        (await ctx.request(url, { method: 'POST', json: { priority: 'unknown' } })).status,
      ).toBe(400);
      const huge = JSON.stringify({ padding: 'x'.repeat(MAX_JSON_BODY_BYTES + 1) });
      const declared = await ctx.request(url, {
        method: 'POST',
        body: huge,
        headers: { 'Content-Length': String(huge.length) },
      });
      expect(declared.status).toBe(413);
      let cancelled = false;
      let pulls = 0;
      const stream = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            pulls++;
            controller.enqueue(new Uint8Array(64 * 1024).fill(32));
          },
          cancel() {
            cancelled = true;
          },
        },
        { highWaterMark: 0 },
      );
      const streamed = await ctx.request(url, { method: 'POST', body: stream, duplex: 'half' });
      expect(streamed.status).toBe(413);
      expect(cancelled).toBe(true);
      expect(pulls).toBeLessThanOrEqual(17);
    }
  } finally {
    await ctx.cleanup();
  }
});
