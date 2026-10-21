/**
 * Writes `samples/slider-demo.pptx` for trying the upload flow end to end.
 *
 *   bun run sample
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { buildPptx } from '../test/fixtures/build-pptx';
import { SAMPLE_PATH, sampleDeck } from './sample-deck';

await mkdir(dirname(SAMPLE_PATH), { recursive: true });
await writeFile(SAMPLE_PATH, await buildPptx(sampleDeck));
console.info(`Wrote ${SAMPLE_PATH}`);
