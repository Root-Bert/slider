import { configurePdfJobs } from '../src/import/pdf-jobs';

/*
 * Vitest runs on Node, which cannot start the TypeScript PDF worker: tests read PDFs on their own
 * thread. The worker machinery (deadline, pages, errors, shutdown) is tested with a plain
 * JavaScript stand-in in `pdf-jobs.test.ts`.
 */
configurePdfJobs({ inProcess: true });
