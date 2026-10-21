/**
 * What does Google say about the comments of this Google Slides file? (BER-157)
 *
 * Google does not document where a Slides comment's anchor names its slide. This prints, for a
 * real presentation, each slide's `objectId`, every comment with its raw anchor, and the slide
 * Slider would put it on (`slideOfAnchor`) – the test the comment import relies on.
 *
 *   cd apps/api && bun run check:google-comments <e-mail> <Google-Slides-Link>
 *   docker compose exec slider bun apps/api/src/tools/check-google-comments.ts <e-mail> <link>
 *
 * With PGlite (no DATABASE_URL) it works on a copy of the database (`tool-env`).
 */
import { parseGoogleLink } from '@slider/shared';
import { eq } from 'drizzle-orm';
import { GoogleTokens } from '../auth/google';
import { systemClock } from '../clock';
import { loadConfig } from '../config';
import { users } from '../db/schema';
import { fullConfig, openToolDb, quietLog } from './tool-env';
import { slideOfAnchor } from '../sources/google-drive';

/** A failed step, already printed; ends the check after the database copy is cleaned up. */
class CheckFailed extends Error {}

const ok = (step: string, detail = '') => console.info(`✓ ${step}${detail ? ` – ${detail}` : ''}`);
const fail = (step: string, detail: string, hint?: string): never => {
  console.info(`✗ ${step}`);
  console.info(`  ${detail}`);
  if (hint) console.info(`  → ${hint}`);
  throw new CheckFailed(step);
};

interface RawComment {
  id?: string;
  content?: string;
  anchor?: string;
  resolved?: boolean;
  deleted?: boolean;
  author?: { displayName?: string; emailAddress?: string };
  replies?: unknown[];
}

async function main(): Promise<void> {
  const [email, rawLink] = process.argv.slice(2);
  if (!email || !rawLink) {
    console.info(
      'Aufruf: check-google-comments.ts <e-mail des Slider-Kontos> <Google-Slides-Link>',
    );
    process.exit(2);
  }
  let link: ReturnType<typeof parseGoogleLink> = null;
  try {
    link = parseGoogleLink(new URL(rawLink));
  } catch {
    // Reported below.
  }
  if (!link?.slides) fail('Link', `Kein Google-Präsentationen-Link: ${rawLink}`);
  const fileId = link!.fileId;

  const boot = loadConfig(process.env, () => {});
  const { db, cleanup } = await openToolDb(boot);
  try {
    const config = await fullConfig(boot, db);
    if (!config.googleDrive) {
      fail('Google-App', 'GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET fehlen.');
    }
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email.toLowerCase()));
    if (!user) fail('Slider-Konto', `Kein Konto mit ${email}.`);
    const tokens = new GoogleTokens({
      config: config.googleDrive,
      secret: config.secret,
      db,
      clock: systemClock,
      log: quietLog,
    });
    const connections = await tokens.connectionIds(user!.id);
    if (connections.length === 0) {
      fail('Google verbunden', `${email} hat kein Google-Konto für Drive verbunden.`);
    }

    // Each connected account in turn, like an import.
    let answer: { slideIds: string[]; comments: RawComment[] } | null = null;
    let lastError = '';
    for (const connectionId of connections) {
      const token = await tokens.getAccessToken(connectionId);
      if (!token) continue;
      const get = async (url: URL) => {
        const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        return response.json() as Promise<Record<string, unknown>>;
      };
      try {
        const slidesUrl = new URL(
          `https://slides.googleapis.com/v1/presentations/${encodeURIComponent(fileId)}`,
        );
        slidesUrl.searchParams.set('fields', 'slides(objectId)');
        const presentation = (await get(slidesUrl)) as { slides?: { objectId?: string }[] };
        const commentsUrl = new URL(
          `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/comments`,
        );
        commentsUrl.searchParams.set('fields', '*');
        commentsUrl.searchParams.set('pageSize', '100');
        const list = (await get(commentsUrl)) as { comments?: RawComment[] };
        answer = {
          slideIds: (presentation.slides ?? []).map((slide) => slide.objectId ?? ''),
          comments: list.comments ?? [],
        };
        break;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
    if (!answer) {
      fail(
        'Google-APIs',
        lastError || 'Kein verbundenes Konto hat ein gültiges Token.',
        'Slides API im Google-Projekt aktiviert? Datei in Slider über „Aus Google Drive wählen“ ausgewählt?',
      );
    }
    const { slideIds, comments } = answer!;
    ok('Folien', slideIds.map((id, i) => `${i + 1}: ${id}`).join(', '));
    let placed = 0;
    for (const comment of comments) {
      const slide = slideOfAnchor(comment.anchor, slideIds);
      if (slide) placed += 1;
      const where = slide ? `Folie ${slideIds.indexOf(slide) + 1}` : 'keine Folie';
      console.info(
        `\n• ${comment.author?.displayName ?? '?'}: ${(comment.content ?? '').slice(0, 60)}` +
          `${comment.resolved ? ' (erledigt)' : ''}${comment.deleted ? ' (gelöscht)' : ''}`,
      );
      console.info(`  Anker: ${comment.anchor ?? '(keiner)'}`);
      console.info(`  → ${where}`);
    }
    console.info(
      `\nErgebnis: ${placed} von ${comments.length} Kommentaren einer Folie zugeordnet.` +
        (placed < comments.length ? ' Die übrigen lässt der Import aus – Anker oben prüfen.' : ''),
    );
  } finally {
    await cleanup();
  }
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    if (!(error instanceof CheckFailed)) console.error(error);
    process.exit(1);
  },
);
