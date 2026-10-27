// A stand-in for `soffice` running the render pool's script (office-worker.py), in plain
// JavaScript so Node can start it: it connects to the pool's socket, says it is ready and answers
// each job by what the file it is sent says – `hang` (never answers), `crash` (exits), `fail`
// (LibreOffice could not draw it), `slow` (a tenth of a second), anything else: a PDF at once.
// `FAKE_SOFFICE_START=fail` makes it exit before it connects.
import { readFileSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import process from 'node:process';
import { setTimeout } from 'node:timers';
import { fileURLToPath } from 'node:url';

if (process.env.FAKE_SOFFICE_START === 'fail') process.exit(1);
const PDF = '%PDF-1.4\n% fake\n%%EOF\n';
const socket = createConnection(process.env.SLIDER_OFFICE_SOCKET);
socket.setEncoding('utf8');
const say = (message) => socket.write(`${JSON.stringify(message)}\n`);
socket.on('connect', () => say({ ready: true }));
socket.on('close', () => process.exit(0));
let buffered = '';
socket.on('data', (chunk) => {
  buffered += chunk;
  let end;
  while ((end = buffered.indexOf('\n')) >= 0) {
    const job = JSON.parse(buffered.slice(0, end));
    buffered = buffered.slice(end + 1);
    const order = readFileSync(fileURLToPath(job.input), 'utf8');
    if (order === 'hang') continue;
    if (order === 'crash') process.exit(1);
    if (order === 'fail') {
      say({ id: job.id, ok: false, error: 'could not open' });
      continue;
    }
    const answer = () => {
      writeFileSync(fileURLToPath(job.output), PDF);
      say({ id: job.id, ok: true });
    };
    if (order === 'slow') setTimeout(answer, 100);
    else answer();
  }
});
