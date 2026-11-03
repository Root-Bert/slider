import { configurePdfJobs } from '../src/import/pdf-jobs';

/*
 * Vitest runs on Node, which cannot start the TypeScript PDF worker: tests read PDFs on their own
 * thread.
 */
configurePdfJobs({ inProcess: true });
