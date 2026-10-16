import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (file: string) => readFileSync(ROOT + file, 'utf8');

/** The jobs of a workflow file by id, each with its (indented) YAML text. */
function jobsOf(workflow: string): Map<string, string> {
  const body = workflow.slice(workflow.indexOf('\njobs:\n') + '\njobs:\n'.length);
  const jobs = new Map<string, string>();
  for (const part of body.split(/^ {2}(?=[a-z][\w-]*:\s*$)/m)) {
    const id = /^([a-z][\w-]*):\s*\n/.exec(part)?.[1];
    if (id) jobs.set(id, part);
  }
  return jobs;
}

const needsOf = (job: string) =>
  (/^ {4}needs: \[([^\]]*)\]/m.exec(job)?.[1] ?? '')
    .split(',')
    .map((need) => need.trim())
    .filter(Boolean);

describe('publishing the container image', () => {
  const workflows = readdirSync(ROOT + '.github/workflows').filter((f) => /\.ya?ml$/.test(f));
  const ci = read('.github/workflows/ci.yml');
  const jobs = jobsOf(ci);

  it('happens only in CI, after every other job passed', () => {
    const publishing = workflows.filter((file) =>
      /^\s+push: true/m.test(read(`.github/workflows/${file}`)),
    );
    expect(publishing).toEqual(['ci.yml']);

    const publishers = [...jobs].filter(([, job]) => /^\s+push: true/m.test(job));
    expect(publishers.map(([id]) => id)).toEqual(['image']);
    const image = jobs.get('image') ?? '';
    const others = [...jobs.keys()].filter((id) => id !== 'image');
    expect(needsOf(image).sort()).toEqual(others.sort());
    // Never from a pull request.
    expect(image).toMatch(/^ {4}if: github\.event_name == 'push'/m);
  });

  it('runs CI for v* tags too, so a release tag is gated like main', () => {
    expect(ci).toMatch(/^ {2}push:\n {4}branches: \[main\]\n {4}tags: \['v\*'\]/m);
    expect(ci).toMatch(/^ {2}pull_request:/m);
  });

  it('builds and smoke-tests the Dockerfile on every pull request', () => {
    const smoke = jobs.get('image-smoke') ?? '';
    expect(smoke).not.toMatch(/^ {4}if:/m);
    expect(smoke).toMatch(/push: false/);
    expect(smoke).toMatch(/load: true/);
    expect(smoke).toMatch(/run: scripts\/smoke-image\.sh slider:smoke/);
    // Executable: CI runs it directly.
    expect(statSync(ROOT + 'scripts/smoke-image.sh').mode & 0o111).not.toBe(0);
    const script = read('scripts/smoke-image.sh');
    for (const check of ['/api/health', '<div id="root">', '/einrichtung#token=', 'tini']) {
      expect(script).toContain(check);
    }
  });
});

describe('API tests on a real Postgres server', () => {
  it('run in CI with TEST_DATABASE_URL, so the postgres-js driver and migrator are covered', () => {
    const job = jobsOf(read('.github/workflows/ci.yml')).get('postgres') ?? '';
    expect(job).toMatch(/image: postgres:17/);
    expect(job).toMatch(/TEST_DATABASE_URL: postgres:\/\//);
    expect(job).toMatch(/run: bunx vitest run --project api$/m);
  });
});

describe('Caddy at the edge', () => {
  it.each(['deploy/Caddyfile', 'deploy/proxy/Caddyfile'])(
    '%s trusts client-IP headers only from TRUSTED_PROXIES, never private ranges',
    (file) => {
      const config = read(file);
      const trusted = config
        .split('\n')
        .filter((line) => line.trim().startsWith('trusted_proxies'));
      // Docker hands IPv6 visitors over from its (private) bridge gateway: trusting private
      // ranges would let them spoof CF-Connecting-IP/X-Forwarded-For and dodge rate limits.
      expect(trusted).toEqual(['\t\ttrusted_proxies static {$TRUSTED_PROXIES}']);
    },
  );
});

describe('the container', () => {
  const dockerfile = read('Dockerfile');

  it('runs tini as PID 1, which reaps the processes LibreOffice leaves behind', () => {
    expect(dockerfile).toMatch(/^\s+tini \\$/m);
    expect(dockerfile).toMatch(/^ENTRYPOINT \["\/usr\/bin\/tini", "--"\]$/m);
    expect(dockerfile).toMatch(/^CMD \["bun", "apps\/api\/src\/supervisor\.ts"\]$/m);
  });

  it('keeps company fonts in a mounted folder, so they survive image updates', () => {
    expect(read('deploy/docker-compose.yml')).toContain(
      '- ./fonts:/usr/local/share/fonts/custom:ro',
    );
    const docs = read('docs/self-hosting.md');
    expect(docs).toContain('`deploy/fonts/`');
    expect(docs).not.toMatch(/in den Container nach `\/usr\/local\/share\/fonts\/` legen/);
  });
});

describe('documented settings', () => {
  /** Every setting `apps/api/src/config.ts` reads (the keys of its zod env schemas). */
  const settings = [
    ...new Set(
      [...read('apps/api/src/config.ts').matchAll(/^ {2}([A-Z][A-Z0-9_]+):/gm)].map(
        (m) => m[1] ?? '',
      ),
    ),
  ];
  /** Development-only. */
  const notForSelfHosters = new Set(['AUTH_DEV_LOGIN', 'DEV_OWNER_EMAIL', 'DEV_OWNER_NAME']);
  /** Old name of SLIDER_URL, mentioned with it; NODE_ENV comes from the runtime, not a .env. */
  const notInEnvFile = new Set(['WEB_ORIGIN', 'NODE_ENV']);
  const docs = read('docs/self-hosting.md');
  const envTable = docs
    .slice(docs.indexOf('## Umgebungsvariablen'), docs.indexOf('## Folienbilder'))
    .split('\n')
    .filter((line) => line.startsWith('| `'))
    .join('\n');

  it('finds the settings to check', () => {
    expect(settings).toEqual(expect.arrayContaining(['SLIDER_URL', 'INVITE_RATE_LIMIT']));
  });

  it('lists every setting in the root .env.example', () => {
    const example = read('.env.example');
    const missing = settings.filter(
      (key) => !notInEnvFile.has(key) && !new RegExp(`^#? ?${key}=`, 'm').test(example),
    );
    expect(missing).toEqual([]);
  });

  it('lists every setting in the table of docs/self-hosting.md', () => {
    const intro = docs.slice(docs.indexOf('## Umgebungsvariablen'), docs.indexOf('| Variable'));
    const missing = settings.filter(
      (key) =>
        !notForSelfHosters.has(key) &&
        !envTable.includes(`\`${key}\``) &&
        // Set by docker-compose.yml, named in the paragraph above the table.
        !intro.includes(`\`${key}\``),
    );
    expect(missing).toEqual([]);
  });

  it('says what the code does: no guests, no e-mail login, start without a login', () => {
    expect(read('.env.example')).not.toMatch(/guest/i);
    expect(envTable).not.toMatch(/Gast/);
    expect(docs).not.toMatch(/startet Slider ohne Login-Weg nicht/);
    expect(read('apps/api/src/routes/setup.ts')).not.toMatch(/Anmeldeweg ein \(E-Mail/);
  });
});
