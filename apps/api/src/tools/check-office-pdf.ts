/**
 * Can Office render this linked deck for this person? (BER-94)
 *
 * Walks the same steps as an import of a OneDrive/SharePoint link: the person's Microsoft token,
 * resolving the link, Graph access to the file, Office's PDF export, rasterising it, and the page
 * count against the visible slides. Prints where it breaks and Microsoft's own error.
 *
 *   cd apps/api && bun run check:office <e-mail> <link> [--pdf out.pdf]
 *   docker compose exec slider bun apps/api/src/tools/check-office-pdf.ts <e-mail> <link>
 *
 * With PGlite (no DATABASE_URL) it works on a copy of the database, so a running server is not
 * disturbed; a renewed Microsoft refresh token then only lands in the copy.
 */
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openPptx } from '@slider/pptx';
import { parseShareLink } from '@slider/shared';
import { eq } from 'drizzle-orm';
import { MicrosoftTokens } from '../auth/microsoft';
import { systemClock } from '../clock';
import { dataPaths, loadConfig, withStoredSettings, type Config } from '../config';
import { openDatabase, type Database } from '../db/client';
import { users } from '../db/schema';
import { ApiError } from '../http/errors';
import { rasterizePdf } from '../import/pdf-pages';
import type { Logger } from '../logger';
import { readStoredSettings } from '../services/instance-settings';
import { GraphClient, isGraphRef } from '../sources/microsoft-graph';
import { dnsLookup } from '../sources/safe-fetch';
import { createSourceAdapters, type RemoteFile } from '../sources/source-adapter';

const quietLog: Logger = { info: () => {}, warn: () => {}, error: () => {} };

/** A failed step, already printed; ends the check after the database copy is cleaned up. */
class CheckFailed extends Error {}

const ok = (step: string, detail = '') => console.info(`✓ ${step}${detail ? ` – ${detail}` : ''}`);
const fail = (step: string, error: unknown, hint?: string): never => {
  console.info(`✗ ${step}`);
  console.info(`  ${describe(error)}`);
  if (hint) console.info(`  → ${hint}`);
  console.info(
    '\nErgebnis: kein Office-Rendering, Slider nimmt LibreOffice (bzw. die SVG-Vorschau).',
  );
  throw new CheckFailed(step);
};

const describe = (error: unknown) =>
  error instanceof ApiError
    ? `${error.code} (HTTP ${error.status}): ${error.message}`
    : error instanceof Error
      ? error.message
      : String(error);

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const pdfIndex = args.indexOf('--pdf');
  const pdfOut = pdfIndex >= 0 ? args.splice(pdfIndex, 2)[1] : undefined;
  const [email, rawLink] = args;
  if (!email || !rawLink) {
    console.info(
      'Aufruf: check-office-pdf.ts <e-mail des Slider-Kontos> <OneDrive/SharePoint-Link> [--pdf out.pdf]',
    );
    process.exit(2);
  }

  const boot = loadConfig(process.env, () => {});
  const { db, cleanup } = await openDb(boot);
  try {
    const config = await fullConfig(boot, db);
    if (!config.microsoft) {
      fail(
        'Microsoft-App',
        'MS_CLIENT_ID/MS_CLIENT_SECRET fehlen (Umgebung oder Einrichtungsseite).',
        'Ohne App-Registrierung gibt es auf diesem Server gar kein Office-Rendering.',
      );
    }
    ok('Microsoft-App konfiguriert', `Tenant ${config.microsoft!.tenant}`);

    const link = parseShareLink(rawLink);
    if (!link || link.kind === 'url') {
      fail('Link', `Kein OneDrive- oder SharePoint-Link: ${rawLink}`);
    }
    ok('Link erkannt', link!.kind);

    const [user] = await db
      .select({ id: users.id, account: users.msAccount, token: users.msRefreshToken })
      .from(users)
      .where(eq(users.email, email.toLowerCase()));
    if (!user) fail('Slider-Konto', `Kein Konto mit ${email}.`);
    if (!user!.token) {
      fail(
        'Microsoft verbunden',
        `${email} hat kein Microsoft-Konto verbunden.`,
        'In Slider unter Konto mit Microsoft verbinden.',
      );
    }
    ok('Microsoft verbunden', user!.account ?? 'Konto unbekannt');

    const tokens = new MicrosoftTokens({
      config: config.microsoft,
      secret: config.secret,
      db,
      clock: systemClock,
      log: quietLog,
    });
    const context = { userId: user!.id };
    let accessToken: string | null = null;
    try {
      accessToken = await tokens.getAccessToken(user!.id);
    } catch (error) {
      fail(
        'Microsoft-Token',
        error,
        'Die Firma der Person muss die App freigeben (Admin-Consent).',
      );
    }
    if (!accessToken) {
      fail(
        'Microsoft-Token',
        'Der gespeicherte Login ist abgelaufen oder widerrufen.',
        'In Slider neu mit Microsoft verbinden.',
      );
    }
    ok('Microsoft-Token');

    const sources = createSourceAdapters({ config, tokens });
    const adapter = sources[link!.kind];
    let file: RemoteFile;
    try {
      file = await adapter.resolve(link!, context);
    } catch (error) {
      fail('Link auflösen', error, 'Kann die Person den Link im Browser mit diesem Konto öffnen?');
    }
    const anonymous = !isGraphRef(file!.ref);
    ok('Link aufgelöst', `${file!.fileName}${anonymous ? ' (anonym heruntergeladen)' : ''}`);

    // Anonymous SharePoint links still need Graph for the PDF: check that access on its own.
    if (anonymous) {
      const graph = new GraphClient({
        http: { fetch: globalThis.fetch, lookup: dnsLookup, maxBytes: config.maxUploadBytes },
        tokens,
        microsoft: config.microsoft,
      });
      try {
        await graph.getShare(link!.url.href, context);
      } catch (error) {
        fail(
          'Graph-Zugriff mit dem Konto',
          error,
          'Der Link ist anonym ladbar, aber Microsoft gibt ihn diesem Konto nicht über Graph frei ' +
            '(häufig: andere Firma). Abhilfe: die Person namentlich oder als Gast freigeben.',
        );
      }
      ok('Graph-Zugriff mit dem Konto');
    }

    const started = Date.now();
    let pdf: Uint8Array;
    try {
      pdf = await adapter.exportPdf!(file!, context);
    } catch (error) {
      fail('Office-PDF', error);
    }
    ok('Office-PDF', `${Math.round(pdf!.length / 1024)} KB in ${Date.now() - started} ms`);
    if (pdfOut) {
      await writeFile(pdfOut, pdf!);
      ok('PDF gespeichert', pdfOut);
    }

    let pages: number;
    try {
      pages = (await rasterizePdf(pdf!)).length;
    } catch (error) {
      fail('PDF rastern', error);
    }
    const pptx = await adapter.download(file!, context);
    const slides = (await openPptx(pptx)).presentation.slides;
    const visible = slides.filter((slide) => !slide.hidden).length;
    if (pages! !== visible) {
      fail(
        'Seitenzahl',
        `${pages!} PDF-Seiten für ${visible} sichtbare Folien (${slides.length} insgesamt).`,
        'Die Seiten lassen sich den Folien nicht zuordnen.',
      );
    }
    ok('Seitenzahl', `${pages!} Seiten = ${visible} sichtbare Folien`);
    console.info('\nErgebnis: Office rendert diese Deck für dieses Konto.');
  } finally {
    await cleanup();
  }
}

/** The environment plus the settings saved on the setup page, like `server.ts`. */
async function fullConfig(boot: Config, db: Database): Promise<Config> {
  const stored = await readStoredSettings(db, boot.secret, quietLog);
  return Object.keys(stored).length === 0
    ? boot
    : loadConfig(withStoredSettings(process.env, stored), () => {});
}

/** Postgres directly; PGlite as a copy, since only one process may open it. */
async function openDb(boot: Config): Promise<{ db: Database; cleanup: () => Promise<void> }> {
  if (boot.hosting?.databaseUrl) {
    const handle = await openDatabase(boot.hosting.databaseUrl);
    return { db: handle.db, cleanup: () => handle.close() };
  }
  const copy = await mkdtemp(join(tmpdir(), 'slider-office-check-'));
  await cp(dataPaths(boot).dbDir, copy, { recursive: true });
  const handle = await openDatabase(copy);
  return {
    db: handle.db,
    cleanup: async () => {
      await handle.close();
      await rm(copy, { recursive: true, force: true });
    },
  };
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    if (!(error instanceof CheckFailed)) console.error(error);
    process.exit(1);
  },
);
