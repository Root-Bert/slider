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

  it('runs the default slide renderer (real LibreOffice → PDF → WebP on Bun) in the image', () => {
    const script = read('scripts/smoke-image.sh');
    // The sample deck is not in the image (.dockerignore), so the script copies it in.
    expect(read('.dockerignore')).toMatch(/^packages\/\*\/samples$/m);
    expect(script).toMatch(/docker cp "\$\{root\}\/packages\/pptx\/samples\/slider-demo\.pptx"/);
    expect(script).toMatch(/docker cp "\$\{root\}\/scripts\/smoke-convert\.ts"/);
    expect(script).toMatch(/docker exec -w \/app\/apps\/api "\$name" bun \/tmp\/smoke-convert\.ts/);
    const convert = read('scripts/smoke-convert.ts');
    for (const used of ['createLibreOfficePdf', 'findSoffice', 'rasterizePdf', '!s.hidden']) {
      expect(convert).toContain(used);
    }
  });

  it('starts every published platform before it is pushed, and publishes those builds', () => {
    const smoke = jobs.get('image-smoke') ?? '';
    const image = jobs.get('image') ?? '';
    const published = (/^ {10}platforms: (.+)$/m.exec(image)?.[1] ?? '').split(',');
    expect(published).toEqual(['linux/amd64', 'linux/arm64']);
    const tested = (/^ {8}arch: \[([^\]]*)\]/m.exec(smoke)?.[1] ?? '')
      .split(',')
      .map((arch) => `linux/${arch.trim()}`);
    expect(tested.sort()).toEqual(published.sort());
    expect(smoke).toMatch(/platforms: linux\/\$\{\{ matrix\.arch \}\}/);
    expect(smoke).toMatch(/SMOKE_PLATFORM: linux\/\$\{\{ matrix\.arch \}\}/);
    expect(smoke).toMatch(/docker\/setup-qemu-action/);
    expect(read('scripts/smoke-image.sh')).toMatch(/\$\{SMOKE_PLATFORM:\+--platform=/);
    // The publish job builds from the layers the smoke test ran.
    expect(smoke).toContain('cache-to: type=gha,mode=max,scope=smoke-${{ matrix.arch }}');
    for (const arch of ['amd64', 'arm64']) expect(image).toContain(`type=gha,scope=smoke-${arch}`);
  });
});

describe('the production web bundle', () => {
  it('is loaded in a browser by CI: the e2e specs run again against the API-served build', () => {
    const scripts = (JSON.parse(read('package.json')) as { scripts: Record<string, string> })
      .scripts;
    expect(scripts['e2e:bundle']).toMatch(/^E2E_BUNDLE=1 playwright test /);
    const e2e = jobsOf(read('.github/workflows/ci.yml')).get('e2e') ?? '';
    expect(e2e).toMatch(/^ {6}- run: bun run e2e:bundle$/m);
    const config = read('e2e/playwright.config.ts');
    expect(config).toMatch(/WEB_DIST_DIR: 'apps\/web\/dist'/);
    expect(config).toMatch(/vite build/);
  });
});

describe('starting without Docker', () => {
  it('`bun run start` runs in production, as the docs promise', () => {
    const scripts = (JSON.parse(read('package.json')) as { scripts: Record<string, string> })
      .scripts;
    expect(scripts.start).toBe('NODE_ENV=production bun apps/api/src/server.ts');
    expect(read('README.md')).toContain('`bun run start`');
    expect(read('docs/self-hosting.md')).toContain('`bun run start`');
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

  it('tells .env.example readers that production starts without a login, via the setup page', () => {
    // config.ts starts production without any login provider and logs the setup link.
    expect(read('apps/api/src/config.ts')).toMatch(/Production without any login starts anyway/);
    const env = read('.env.example');
    const example = env.slice(env.indexOf('# ── Login'), env.indexOf('BOOTSTRAP_EMAIL='));
    expect(example).toMatch(/passkeys/);
    expect(example).not.toMatch(/required\s+in production/i);
    expect(example).toMatch(/\/einrichtung/);
    expect(example).toMatch(/values set here win/i);
  });

  it('does not claim the image was never built, next to saying CI builds it', () => {
    const note = docs.slice(docs.indexOf('> **Hinweis:**'), docs.indexOf('## Aufbau'));
    expect(note).toMatch(/scripts\/smoke-image\.sh/);
    expect(note).not.toMatch(/nicht\s*(>\s*)?mit\s*(>\s*)?Docker gebaut/);
  });
});

describe('restoring a backup', () => {
  const docs = read('docs/self-hosting.md');
  const section = docs.slice(docs.indexOf('### Wiederherstellen'), docs.indexOf('\n## Updates'));
  const steps = /```bash\n([\s\S]*?)```/.exec(section)?.[1] ?? '';
  const at = (pattern: RegExp) => steps.search(pattern);

  it('stops Slider, restores database and /data, then starts it so it reads the restored secret', () => {
    // The secret and the setup-page settings are read only at boot.
    expect(read('apps/api/src/config.ts')).toMatch(/loadOrCreateSecret/);
    const stop = at(/^docker compose stop slider$/m);
    const restore = at(/pg_restore -U slider -d slider --clean --if-exists/);
    const untar = at(/tar xzf \/backup\/slider-data-[^ ]+\.tar\.gz -C \/data/);
    const start = at(/^docker compose up -d slider$/m);
    expect([stop, restore, untar, start].every((i) => i >= 0)).toBe(true);
    expect(stop).toBeLessThan(restore);
    expect(restore).toBeLessThan(untar);
    expect(untar).toBeLessThan(start);
    // Into the same volume the backup command archived.
    expect(docs).toMatch(/-v slider_slider-data:\/data[^\n]*\n {2}tar czf/);
    expect(steps).toMatch(/-v slider_slider-data:\/data/);
  });

  it('says that /data/secret must be restored together with the database', () => {
    expect(section).toMatch(/`\/data\/secret`/);
    expect(section).toMatch(/unlesbar/);
  });
});
