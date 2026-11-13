// Stages what the desktop app runs, like the Docker image does (Dockerfile): the API's production
// dependencies, the sources of the API and its packages, the built web app and the Bun runtime.
//   build/app  – a slim checkout: Bun runs apps/api/src/supervisor.ts in it
//   build/bin  – bun
// The repo itself is only read; the web build goes straight into build/app.
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = fileURLToPath(new URL('..', import.meta.url));
const repo = path.resolve(desktop, '..');
const build = path.join(desktop, 'build');
const app = path.join(build, 'app');
const bin = path.join(build, 'bin');

const run = (command, args, cwd) => {
  console.info(`$ ${command} ${args.join(' ')}   (${path.relative(repo, cwd) || '.'})`);
  execFileSync(command, args, { cwd, stdio: 'inherit' });
};
const copy = (from, to = from) => {
  const source = path.join(repo, from);
  if (!existsSync(source)) throw new Error(`missing ${from}`);
  cpSync(source, path.join(app, to), {
    recursive: true,
    filter: (file) => !/(^|\/)(node_modules|\.data|test)(\/|$)/.test(path.relative(source, file)),
  });
};

rmSync(build, { recursive: true, force: true });
mkdirSync(app, { recursive: true });
mkdirSync(bin, { recursive: true });

// ── Workspace manifests, then the API's production dependencies (native ones for this Mac) ──
copy('package.json');
copy('bun.lock');
for (const workspace of [
  'apps/api',
  'apps/web',
  'apps/site',
  'packages/shared',
  'packages/pptx',
  'packages/odp',
]) {
  copy(`${workspace}/package.json`);
}
// Hoisted: real folders, not Bun's links into node_modules/.bun – electron-builder drops symlinks.
run(
  'bun',
  [
    'install',
    '--frozen-lockfile',
    '--production',
    '--linker',
    'hoisted',
    '--filter',
    '@slider/api',
  ],
  app,
);

// ── Sources (Bun runs TypeScript as it is; paths next to the files stay as in the repo) ──────
copy('tsconfig.base.json');
for (const pkg of ['shared', 'pptx', 'odp']) {
  copy(`packages/${pkg}/src`);
  copy(`packages/${pkg}/tsconfig.json`);
}
copy('apps/api/tsconfig.json');
copy('apps/api/drizzle');
copy('apps/api/src');
// The Google Fonts LibreOffice draws with (libreoffice.ts finds them next to the sources).
copy('fonts/google');

// ── Web app, built into the stage (the repo's apps/web/dist stays untouched) ─────────────────
run(
  path.join(repo, 'apps/web/node_modules/.bin/vite'),
  ['build', '--outDir', path.join(app, 'apps/web/dist'), '--emptyOutDir'],
  path.join(repo, 'apps/web'),
);

// ── The start screen's logo animations, from the web app's stylesheet ──────────────────────
run('node', [path.join(desktop, 'scripts/logo-css.mjs')], desktop);

// ── No symlinks left (workspace packages, .bin): copied as the files they point at ───────────
const linked = path.join(build, 'app-linked');
renameSync(app, linked);
rmSync(path.join(linked, 'node_modules/.bin'), { recursive: true, force: true });
// `cp -RL`: Node's cpSync keeps nested links even with `dereference`.
execFileSync('cp', ['-RL', linked, app]);
rmSync(linked, { recursive: true, force: true });
const left = execFileSync('find', [app, '-type', 'l']).toString().trim();
if (left) throw new Error(`symlinks left in the stage:\n${left}`);

// ── Bun runtime: the one that installed the dependencies above ───────────────────────────────
const bun = execFileSync('bun', ['-e', 'console.info(process.execPath)']).toString().trim();
copyFileSync(bun, path.join(bin, 'bun'));
chmodSync(path.join(bin, 'bun'), 0o755);

const size = (dir) => execFileSync('du', ['-sh', dir]).toString().split('\t')[0];
console.info(
  `\nStaged: app ${size(app)}, bun ${size(bin)} (${statSync(bun).size} bytes from ${bun})`,
);
