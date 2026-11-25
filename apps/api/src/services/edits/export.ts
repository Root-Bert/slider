import { createCanvas } from '@napi-rs/canvas';
import { loadImage } from '../../import/load-image';
import { asc, eq } from 'drizzle-orm';
import { ODP_MIME, OTP_MIME } from '@slider/odp';
import {
  cloudBaseName,
  type CloudBatchResult,
  type CloudTargetInput,
  type CloudUploadResult,
  type KeepExportInput,
  type SendExportInput,
  type Viewer,
} from '@slider/shared';
import type { AppDeps } from '../../deps';
import { slideVersions, users } from '../../db/schema';
import { ApiError, badRequest, notFound } from '../../http/errors';
import { loadNode, type LoadedNode } from '../cloud/context';
import { resolveTarget } from '../cloud/tree';
import { assertStorageFor } from '../plans';
import { aiLimits } from '../../http/ai-limits';
import { storeUpload, versionToServe } from '../cloud/files';
import { previewPdfKey } from '../cloud/pictures';
import { deckOfNode } from '../deck-places';
import { fontSubstituteFor } from '../../import/libreoffice';
import { inviteMail } from '../../mail/mailer';
import { drawingFonts } from '../workspace-fonts';
import { maskEmail } from '../workspaces/invites';
import { editedFile, editedPdf, fileBase } from './state';
import { editTarget, openFile, readFile, type EditTarget } from './target';

/*
 * „Exportieren“ beyond the whole deck: one slide as a PDF or as its picture, and any export
 * mailed to someone as an attachment or kept in Cloud.
 */

/** An export ready to download or to mail. */
export interface ExportedFile {
  bytes: Uint8Array;
  fileName: string;
  contentType: string;
}

/** The slide of the deck's current revision, with its place in the file and its number. */
async function exportSlide(deps: AppDeps, target: EditTarget, slideId: string) {
  const rows = await deps.db
    .select({
      slideId: slideVersions.slideId,
      hidden: slideVersions.hidden,
      imageKey: slideVersions.imageKey,
    })
    .from(slideVersions)
    .where(eq(slideVersions.revisionId, target.revision.id))
    .orderBy(asc(slideVersions.position));
  const index = rows.findIndex((row) => row.slideId === slideId);
  const row = rows[index];
  if (!row) throw notFound('Diese Folie gibt es nicht mehr.');
  // Numbered as the deck shows it: hidden slides not counted – a hidden one by its place.
  const number = row.hidden
    ? index + 1
    : rows.slice(0, index + 1).filter((other) => !other.hidden).length;
  return {
    index,
    imageKey: row.imageKey,
    base: `${fileBase(target.deck)} – Folie ${number}`,
  };
}

/**
 * One slide of the file as it is now as a one-page PDF, drawn by LibreOffice like the slide
 * pictures (the pool, only that page loaded) – a hidden slide too.
 */
export async function editedSlidePdf(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
  slideId: string,
): Promise<ExportedFile> {
  const target = await editTarget(deps, viewer, deckId);
  const slide = await exportSlide(deps, target, slideId);
  // `editTarget` refuses a deck without LibreOffice drawing pages, so it is there.
  const toPdf = deps.rendering!.renderers.libreOfficePdf!;
  const fonts = await drawingFonts(deps, target.deck.workspaceId);
  const document = await openFile(await readFile(deps, target.revision.pptxKey));
  // LibreOffice leaves hidden pages out of a PDF.
  document.setSlideHidden(slide.index, false);
  document.embedFonts(await fonts.faces(document.fontFamilies()));
  const drawing = await document.toDrawingBytes([slide.index], fontSubstituteFor(fonts.families));
  const bytes = await toPdf.pages!(drawing, [slide.index + 1], { prepared: true });
  return { bytes, fileName: `${slide.base}.pdf`, contentType: 'application/pdf' };
}

/** One slide as a PNG: its picture as LibreOffice drew it, at full size. */
export async function editedSlidePng(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
  slideId: string,
): Promise<ExportedFile> {
  const target = await editTarget(deps, viewer, deckId);
  const slide = await exportSlide(deps, target, slideId);
  const stored = await deps.storage.get(slide.imageKey);
  if (!stored) throw notFound('Das Bild der Folie ist noch nicht da.');
  const image = await loadImage(Buffer.from(stored));
  const canvas = createCanvas(image.width, image.height);
  canvas.getContext('2d').drawImage(image, 0, 0);
  return {
    bytes: new Uint8Array(await canvas.encode('png')),
    fileName: `${slide.base}.png`,
    contentType: 'image/png',
  };
}

/** The export a format names, as it would download. */
export async function exportedFile(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
  format: SendExportInput['format'],
  slideId: string | undefined,
): Promise<ExportedFile> {
  if (format === 'file') {
    const { bytes, fileName, template } = await editedFile(deps, viewer, deckId);
    return { bytes, fileName, contentType: template ? OTP_MIME : ODP_MIME };
  }
  if (format === 'pdf') {
    const { bytes, fileName } = await editedPdf(deps, viewer, deckId);
    return { bytes, fileName, contentType: 'application/pdf' };
  }
  if (!slideId) throw badRequest('Welche Folie?');
  return format === 'slidePdf'
    ? editedSlidePdf(deps, viewer, deckId, slideId)
    : editedSlidePng(deps, viewer, deckId, slideId);
}

/**
 * Most mail servers take 20–25 MB per mail, and an attachment grows by a third on the way
 * (base64): what is bigger is refused before it is sent.
 */
export const MAX_MAILED_EXPORT_BYTES = 15 * 1024 * 1024;

/**
 * Mails an export to someone as an attachment, from Slider's address in the sender's name, with
 * their note. Replies go to the sender: Reply-To is their account's own address – never one
 * typed in here –, so the mail can only point back at who sent it. It names the imprint and
 * privacy policy – the recipient's address came from someone else.
 */
export async function sendExport(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
  input: SendExportInput,
): Promise<void> {
  if (!deps.mailer.configured) {
    throw new ApiError(503, 'mail_failed', 'Auf diesem Server ist kein Mailversand eingerichtet.');
  }
  const { deck } = await editTarget(deps, viewer, deckId);
  const file = await exportedFile(deps, viewer, deckId, input.format, input.slideId);
  if (file.bytes.byteLength > MAX_MAILED_EXPORT_BYTES) {
    throw new ApiError(
      413,
      'file_too_large',
      `Zu groß für eine Mail (über ${MAX_MAILED_EXPORT_BYTES / 1024 / 1024} MB) – lade die Datei herunter und teile sie anders.`,
    );
  }
  const name = viewer.author.name;
  // Replies go to the sender: the mail comes in their name, from the instance's address.
  const [sender] = await deps.db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, viewer.author.id));
  const title = deck.title?.trim() || fileBase(deck);
  const what = {
    file: `${deck.isTemplate ? 'die Vorlage' : 'die Präsentation'} „${title}“`,
    pdf: `„${title}“ als PDF`,
    slidePdf: `eine Folie aus „${title}“ als PDF`,
    slidePng: `eine Folie aus „${title}“ als Bild`,
  }[input.format];
  try {
    await deps.mailer.send({
      ...inviteMail({
        to: input.to,
        app: 'slider',
        subject: `${name} schickt dir „${title}“`,
        heading: 'Eine Präsentation für dich',
        intro: `${name} schickt dir ${what}. Die Datei hängt an dieser Mail.`,
        quote: input.note || undefined,
        url: deps.config.webOrigin,
        outro: sender?.email
          ? `Gesendet mit Slider. Antworten gehen direkt an ${name}.`
          : 'Gesendet mit Slider.',
        files: [
          {
            filename: file.fileName,
            contentType: file.contentType,
            content: Buffer.from(file.bytes),
          },
        ],
        legalLinks: true,
      }),
      fromName: `${name} (über Slider)`,
      ...(sender?.email ? { replyTo: sender.email } : {}),
    });
  } catch (error) {
    deps.log.warn(`Export mail to ${maskEmail(input.to)} failed`, error);
    throw new ApiError(
      502,
      'mail_failed',
      'Die Mail ließ sich gerade nicht senden. Bitte versuch es gleich noch einmal.',
    );
  }
}

/**
 * An export as a file in Cloud where the caller picked – one of its name there gets it as its next
 * version (the earlier one stays to bring back), as an upload would.
 */
async function keepInCloud(
  deps: AppDeps,
  userId: string,
  workspaceId: string,
  file: ExportedFile,
  place: CloudTargetInput,
): Promise<CloudUploadResult> {
  const { bytes } = file;
  return storeUpload(
    deps,
    userId,
    workspaceId,
    {
      // A deck's title may hold a slash, a Cloud name may not.
      name: file.fileName.replace(/[/\\]/g, '-'),
      ...(place.parentId
        ? { parentId: place.parentId }
        : place.areaId
          ? { areaId: place.areaId }
          : {}),
    },
    {
      data: (async function* () {
        yield bytes;
      })(),
      size: bytes.byteLength,
      mimeType: file.contentType,
    },
  );
}

/** „In Cloud ablegen …“ in „Exportieren“: any export, as it would download, kept in Cloud. */
export async function keepExport(
  deps: AppDeps,
  viewer: Viewer,
  deckId: string,
  input: KeepExportInput,
): Promise<CloudUploadResult> {
  const { deck } = await editTarget(deps, viewer, deckId);
  const file = await exportedFile(deps, viewer, deckId, input.format, input.slideId);
  return keepInCloud(deps, viewer.author.id, deck.workspaceId, file, input);
}

/**
 * „Als PDF ablegen“ on files in Cloud, each PDF beside its file: a presentation's file the caller
 * may edit as „Exportieren“ makes its PDF (the workspace's fonts in it); any other file
 * LibreOffice reads as the PDF Cloud's preview shows of it (mostly drawn already). One after
 * another, each counted against the person's PDFs a minute (LibreOffice draws a few files at once
 * for everyone) – and only once its place is known to take it; what cannot be done is skipped.
 */
export async function keepNodePdfs(
  deps: AppDeps,
  viewer: Viewer,
  ids: readonly string[],
): Promise<CloudBatchResult> {
  const userId = viewer.author.id;
  const result: CloudBatchResult = { nodes: [], skipped: [] };
  // „a.odp“ and „a.pptx“ side by side would both be „a.pdf“: the second its next version.
  const made = new Set<string>();
  let limited: ApiError | null = null;
  for (const id of new Set(ids)) {
    let name = '';
    try {
      if (limited) throw limited;
      const { node, ctx } = await loadNode(deps, userId, id);
      name = node.name;
      // Shared from someone else's own files: beside it is not a place of one's own.
      if (!node.parentId && !node.areaId && node.ownerId !== userId) {
        throw badRequest(`Neben „${node.name}“ lässt sich nichts ablegen.`);
      }
      const place = node.parentId
        ? { parentId: node.parentId }
        : node.areaId
          ? { areaId: node.areaId }
          : {};
      const plan = await pdfPlan(deps, viewer, node);
      const where = node.parentId ?? node.areaId ?? `own:${userId}`;
      const key = `${where}/${plan.name.toLowerCase()}`;
      if (made.has(key)) throw badRequest(`„${plan.name}“ kommt schon aus einer anderen Datei.`);
      // Before LibreOffice draws it: may it go there, is there room at all?
      await resolveTarget(deps, ctx, place, 'edit');
      await deps.db.transaction((tx) =>
        assertStorageFor(tx, deps.config, node.workspaceId, 0, deps.clock.now()),
      );
      if (!aiLimits(deps).pdfs.hit(userId).allowed) {
        limited = new ApiError(
          429,
          'rate_limited',
          'Zu viele PDFs auf einmal. Bitte warte einen Moment.',
        );
        throw limited;
      }
      made.add(key);
      const kept = await keepInCloud(deps, userId, node.workspaceId, await plan.make(), place);
      result.nodes.push(kept.node);
    } catch (error) {
      if (!(error instanceof ApiError)) deps.log.warn(`PDF of cloud node ${id} failed`, error);
      result.skipped.push({
        id,
        name,
        reason:
          error instanceof ApiError && error.status < 500
            ? error.message
            : 'Aus dieser Datei ließ sich gerade kein PDF machen.',
      });
    }
  }
  return result;
}

/** The PDF a file gives: its name in Cloud (known before it is drawn) and how it is made. */
async function pdfPlan(
  deps: AppDeps,
  viewer: Viewer,
  node: LoadedNode['node'],
): Promise<{ name: string; make: () => Promise<ExportedFile> }> {
  const deck = await deckOfNode(deps.db, node.id);
  const editable =
    deck &&
    (await editTarget(deps, viewer, deck.id).then(
      () => true,
      () => false,
    ));
  if (deck && editable) {
    return {
      // As `editedPdf` names it, and `keepInCloud` without slashes.
      name: cloudPdfName(fileBase(deck)),
      make: () => exportedFile(deps, viewer, deck.id, 'pdf', undefined),
    };
  }
  return {
    name: cloudPdfName(cloudBaseName(node.name)),
    make: async () => {
      const version = await versionToServe(deps, node);
      const key = await previewPdfKey(deps, node, version);
      const bytes = key ? await deps.storage.get(key) : null;
      if (!bytes) throw badRequest('Aus dieser Datei lässt sich kein PDF machen.');
      return {
        bytes,
        fileName: `${cloudBaseName(node.name)}.pdf`,
        contentType: 'application/pdf',
      };
    },
  };
}

const cloudPdfName = (base: string) => `${base}.pdf`.replace(/[/\\]/g, '-');
