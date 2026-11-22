import type Anthropic from '@anthropic-ai/sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts, degrees } from '@cantoo/pdf-lib';
import {
  readerAiProposalSchema,
  readerCommentSchema,
  readerMarkSchema,
  readerOpenedSchema,
  readerPdfSchema,
  readerSignatureSchema,
  type WorkspaceRole,
} from '@slider/shared';
import { eq } from 'drizzle-orm';
import { workspaceMembers } from '../src/db/schema';
import { pagePoint } from '../src/services/pdf-bake';
import { pdfAiIdle } from '../src/services/pdf-ai';
import { createTestContext, signedInUser, type TestContext } from './helpers';

/** The AI as far as a PDF uses it: scripted answers, the requests recorded. */
const ai = {
  steps: [] as Anthropic.Beta.BetaContentBlock[][],
  requests: [] as Anthropic.Beta.MessageCreateParams[],
  /** Runs while the AI "thinks", before its answer comes back. */
  meanwhile: null as (() => Promise<void>) | null,
  client: (apiKey: string): Anthropic =>
    ({
      models: {
        retrieve: async (model: string) => ({ id: model, apiKey, max_tokens: 128_000 }),
        list: () =>
          (async function* () {
            await Promise.resolve();
            yield { id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5', apiKey };
          })(),
      },
      beta: {
        messages: {
          stream: (body: Anthropic.Beta.MessageCreateParams) => {
            ai.requests.push(structuredClone(body));
            const content = ai.steps.shift();
            return {
              finalMessage: async () => {
                await ai.meanwhile?.();
                if (!content) throw new Error('no scripted answer left');
                return {
                  id: `msg_${Math.random()}`,
                  type: 'message',
                  role: 'assistant',
                  model: 'claude-sonnet-5-5',
                  content,
                  stop_reason: content.some((block) => block.type === 'tool_use')
                    ? 'tool_use'
                    : 'end_turn',
                  stop_sequence: null,
                  usage: { input_tokens: 10, output_tokens: 10 },
                };
              },
              currentMessage: undefined,
              abort: () => {},
            };
          },
        },
      },
    }) as unknown as Anthropic,
};

let ctx: TestContext;
beforeEach(async () => {
  ai.steps = [];
  ai.requests = [];
  ai.meanwhile = null;
  ctx = await createTestContext({ anthropic: ai.client });
});
afterEach(() => ctx.cleanup());

async function member(name: string, role: WorkspaceRole) {
  const person = await signedInUser(ctx, { name, email: `${name.toLowerCase()}@firma.de` });
  await ctx.deps.db
    .insert(workspaceMembers)
    .values({ workspaceId: ctx.workspaceId, userId: person.user.id, role });
  return person;
}

/** A small form: a heading, a name field and a box to tick; a second page turned. */
async function formPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  page.drawText('Mietvertrag Musterstraße 1', { x: 50, y: 780, size: 18, font });
  const form = doc.getForm();
  form.createTextField('mieter.name').addToPage(page, { x: 50, y: 700, width: 300, height: 24 });
  form.createCheckBox('einverstanden').addToPage(page, { x: 50, y: 650, width: 16, height: 16 });
  const second = doc.addPage([595, 842]);
  second.setRotation(degrees(90));
  return doc.save();
}

/** A transparent 1×1 PNG – a signature as small as can be. */
const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('Reader – PDFs', () => {
  it('keeps a PDF as it came in Cloud: fills, ticks and signatures lie beside it for everyone and are baked into the export, roles decide who fills and comments, a comment handed to the AI answers and fills fields, taken back', async () => {
    const bytes = await formPdf();
    const upload = (name: string, body: Uint8Array, cookie?: string) =>
      ctx.request(
        `/api/workspaces/${ctx.workspaceId}/pdfs/import?name=${encodeURIComponent(name)}`,
        { method: 'POST', body, headers: { 'content-type': 'application/pdf' }, cookie },
      );
    expect((await upload('kein.pdf', new TextEncoder().encode('hallo'))).status).toBe(400);
    expect((await upload('Vertrag.txt', bytes)).status).toBe(400);
    const made = await upload('Vertrag.pdf', bytes);
    expect(made.status).toBe(201);
    const pdf = readerPdfSchema.parse(await made.json());
    expect(pdf).toMatchObject({
      title: 'Vertrag',
      fileName: 'Vertrag.pdf',
      place: 'Meine Dateien',
      filled: 0,
      permissions: { canEdit: true, canComment: true, canManage: true },
    });
    const listed = readerPdfSchema
      .array()
      .parse(await (await ctx.request(`/api/workspaces/${ctx.workspaceId}/pdfs`)).json());
    expect(listed.map((each) => each.id)).toEqual([pdf.id]);

    // The file comes back byte for byte; filling in never writes it.
    const file = await ctx.request(`/api/pdfs/${pdf.id}/file`);
    expect(file.headers.get('content-type')).toBe('application/pdf');
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes);

    const put = (id: string, body: unknown, cookie?: string) =>
      ctx.request(`/api/pdfs/${pdf.id}/marks/${encodeURIComponent(id)}`, {
        method: 'PUT',
        json: body,
        cookie,
      });
    const field = await put('field:mieter.name', {
      kind: 'field',
      page: 0,
      name: 'mieter.name',
      value: 'Jörg Müller',
    });
    expect(field.status).toBe(200);
    expect(readerMarkSchema.parse(await field.json())).toMatchObject({ value: 'Jörg Müller' });
    // A field's mark carries its name, nothing else does.
    expect(
      (await put('field:anders', { kind: 'field', page: 0, name: 'mieter.name', value: 'x' }))
        .status,
    ).toBe(400);
    expect(
      (await put('field:x', { kind: 'check', page: 0, rect: { x: 0, y: 0, w: 0.1, h: 0.1 } }))
        .status,
    ).toBe(400);
    expect(
      (
        await put('t1', {
          kind: 'text',
          page: 1,
          rect: { x: 0.1, y: 0.1, w: 0.3, h: 0.05 },
          text: 'Berlin, 19.11.2026\nzweite Zeile ✓',
          size: 11,
        })
      ).status,
    ).toBe(200);
    expect(
      (await put('c1', { kind: 'check', page: 0, rect: { x: 0.5, y: 0.5, w: 0.03, h: 0.02 } }))
        .status,
    ).toBe(200);
    expect(
      (
        await put('s1', {
          kind: 'signature',
          page: 0,
          rect: { x: 0.6, y: 0.8, w: 0.25, h: 0.06 },
          image: 'data:image/jpeg;base64,AAAA',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await put('s1', {
          kind: 'signature',
          page: 0,
          rect: { x: 0.6, y: 0.8, w: 0.25, h: 0.06 },
          image: PIXEL,
        })
      ).status,
    ).toBe(200);
    expect((await ctx.request(`/api/pdfs/${pdf.id}/marks/c1`, { method: 'DELETE' })).status).toBe(
      204,
    );
    const opened = readerOpenedSchema.parse(
      await (await ctx.request(`/api/pdfs/${pdf.id}`)).json(),
    );
    expect(opened.marks.map((mark) => mark.id).sort()).toEqual(['field:mieter.name', 's1', 't1']);
    expect(opened.pdf.filled).toBe(3);

    // The export has it baked in: the field holds the name, the text and signature are drawn.
    const exported = await ctx.request(`/api/pdfs/${pdf.id}/export`);
    expect(exported.status).toBe(200);
    const baked = await PDFDocument.load(new Uint8Array(await exported.arrayBuffer()));
    expect(baked.getForm().getTextField('mieter.name').getText()).toBe('Jörg Müller');
    expect(baked.getForm().getCheckBox('einverstanden').isChecked()).toBe(false);
    expect(baked.getPageCount()).toBe(2);
    // A turned page's places as shown land where pdf.js shows them.
    const box = { x: 0, y: 0, width: 595, height: 842 };
    expect(pagePoint(box, 0, 0, 0)).toEqual({ x: 0, y: 842 });
    expect(pagePoint(box, 90, 0, 0)).toEqual({ x: 0, y: 0 });
    expect(pagePoint(box, 180, 0, 0)).toEqual({ x: 595, y: 0 });
    expect(pagePoint(box, 270, 1, 1)).toEqual({ x: 0, y: 0 });

    // Signatures one keeps: one's own only, the oldest goes past six.
    for (let index = 0; index < 7; index += 1) {
      const kept = await ctx.request('/api/reader/signatures', {
        method: 'POST',
        json: { image: PIXEL, width: 1, height: 1 },
      });
      expect(kept.status).toBe(201);
    }
    const signatures = readerSignatureSchema
      .array()
      .parse(await (await ctx.request('/api/reader/signatures')).json());
    expect(signatures).toHaveLength(6);

    // Roles: who only looks neither fills nor comments; a reviewer comments, does not fill.
    const reviewer = await member('Rita', 'reviewer');
    const viewer = await member('Vera', 'viewer');
    // New, it lies in its maker's own files: nobody else sees it until it goes where they do.
    expect((await ctx.request(`/api/pdfs/${pdf.id}`, { cookie: viewer.cookie })).status).toBe(404);
    const { areas } = (await (
      await ctx.request(`/api/workspaces/${ctx.workspaceId}/cloud`)
    ).json()) as { areas: { id: string; root: boolean }[] };
    await ctx.request('/api/cloud/nodes/move', {
      method: 'POST',
      json: { ids: [pdf.id], areaId: areas.find((area) => area.root)?.id },
    });
    expect(
      readerSignatureSchema
        .array()
        .parse(
          await (await ctx.request('/api/reader/signatures', { cookie: reviewer.cookie })).json(),
        ),
    ).toHaveLength(0);
    const comment = (body: string, cookie?: string, anchor: unknown = { page: 0 }) =>
      ctx.request(`/api/pdfs/${pdf.id}/comments`, {
        method: 'POST',
        json: { id: crypto.randomUUID(), parentId: null, body, anchor },
        cookie,
      });
    expect((await comment('Hallo', viewer.cookie)).status).toBe(403);
    expect(
      (
        await put(
          't2',
          { kind: 'check', page: 0, rect: { x: 0, y: 0, w: 0.1, h: 0.1 } },
          reviewer.cookie,
        )
      ).status,
    ).toBe(403);
    const written = await comment('Was kostet die Miete?', reviewer.cookie, {
      page: 0,
      rect: { x: 0.1, y: 0.05, w: 0.5, h: 0.04 },
      quote: 'Mietvertrag Musterstraße 1',
    });
    expect(written.status).toBe(201);
    const asked = readerCommentSchema.parse(await written.json());
    expect((await comment('Ohne Ort', undefined, null)).status).toBe(400);

    // The AI: no key, no AI; with one it answers a question from the PDF's text.
    const ask = (commentId: string, cookie?: string, fields: unknown[] = []) =>
      ctx.request(`/api/pdfs/${pdf.id}/ai-proposals`, {
        method: 'POST',
        json: { id: crypto.randomUUID(), commentId, fields },
        cookie,
      });
    expect((await ask(asked.id, viewer.cookie)).status).toBe(403);
    expect((await ask(asked.id)).status).toBe(409);
    await ctx.request(`/api/workspaces/${ctx.workspaceId}/integrations/keys`, {
      method: 'POST',
      json: { kind: 'ai', provider: 'anthropic', apiKey: 'sk-ant-api03-good-AbCdEfGhIjKlMnOpQrSt' },
    });
    const fields = [
      { name: 'mieter.name', page: 0, type: 'text' },
      { name: 'einverstanden', page: 0, type: 'checkbox' },
    ];
    ai.steps.push([
      { type: 'text', text: 'Das steht nicht im PDF.' } as Anthropic.Beta.BetaContentBlock,
    ]);
    expect((await ask(asked.id, reviewer.cookie, fields)).status).toBe(202);
    await pdfAiIdle();
    const proposals = async () =>
      readerAiProposalSchema
        .array()
        .parse(await (await ctx.request(`/api/pdfs/${pdf.id}/ai-proposals`)).json());
    expect((await proposals())[0]).toMatchObject({
      status: 'answered',
      summary: 'Das steht nicht im PDF.',
      author: { type: 'ai' },
    });
    const first = JSON.stringify(ai.requests.at(-1));
    expect(first).toContain('Mietvertrag Musterstra');
    expect(first).toContain('on page 1');
    expect(first).toContain('image/jpeg');
    // A reviewer may not fill: the fields are not handed over, no tool offered.
    expect(
      (ai.requests.at(-1)?.tools ?? []).map((tool) => ('name' in tool ? tool.name : '')),
    ).not.toContain('fill_fields');
    expect(first).not.toContain('<fields>');

    // Filled by the AI: a wrong field is said back, then all written and taken back.
    const fill = await comment('Füll meinen Namen ein: Anna Weber, und kreuz an.');
    const fillComment = readerCommentSchema.parse(await fill.json());
    ai.steps.push(
      [
        {
          type: 'tool_use',
          id: 'toolu_1',
          name: 'fill_fields',
          input: { fields: [{ name: 'gibtsnicht', value: 'x' }], summary: 'Gemacht.' },
        } as Anthropic.Beta.BetaContentBlock,
      ],
      [
        {
          type: 'tool_use',
          id: 'toolu_2',
          name: 'fill_fields',
          input: {
            fields: [
              { name: 'mieter.name', value: 'Anna Weber' },
              { name: 'einverstanden', value: true },
            ],
            summary: 'Name eingetragen und angekreuzt.',
          },
        } as Anthropic.Beta.BetaContentBlock,
      ],
    );
    expect((await ask(fillComment.id, undefined, fields)).status).toBe(202);
    await pdfAiIdle();
    expect(JSON.stringify(ai.requests.at(-1))).toContain('There is no field \\"gibtsnicht\\"');
    const filled = (await proposals()).find((each) => each.commentId === fillComment.id);
    expect(filled).toMatchObject({ status: 'applied', filled: 2 });
    const marksNow = async () =>
      readerOpenedSchema.parse(await (await ctx.request(`/api/pdfs/${pdf.id}`)).json()).marks;
    expect((await marksNow()).find((mark) => mark.id === 'field:mieter.name')).toMatchObject({
      value: 'Anna Weber',
    });
    const move = (action: string) =>
      ctx.request(`/api/pdf-ai-proposals/${filled!.id}/${action}`, { method: 'POST' });
    expect((await move('revert')).status).toBe(200);
    const reverted = await marksNow();
    expect(reverted.find((mark) => mark.id === 'field:mieter.name')).toMatchObject({
      value: 'Jörg Müller',
    });
    expect(reverted.some((mark) => mark.id === 'field:einverstanden')).toBe(false);
    expect((await move('reapply')).status).toBe(200);
    expect((await marksNow()).some((mark) => mark.id === 'field:einverstanden')).toBe(true);

    // Who loses the right to fill while the AI thinks gets nothing written in their name.
    const mia = await member('Mia', 'member');
    const miaAsks = readerCommentSchema.parse(
      await (await comment('Trag Mia Schulz ein.', mia.cookie)).json(),
    );
    ai.steps.push([
      {
        type: 'tool_use',
        id: 'toolu_3',
        name: 'fill_fields',
        input: { fields: [{ name: 'mieter.name', value: 'Mia Schulz' }], summary: 'Eingetragen.' },
      } as Anthropic.Beta.BetaContentBlock,
    ]);
    ai.meanwhile = async () => {
      ai.meanwhile = null;
      await ctx.deps.db
        .update(workspaceMembers)
        .set({ role: 'reviewer' })
        .where(eq(workspaceMembers.userId, mia.user.id));
    };
    expect((await ask(miaAsks.id, mia.cookie, fields)).status).toBe(202);
    await pdfAiIdle();
    expect((await proposals()).find((each) => each.commentId === miaAsks.id)).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('nicht mehr ausfüllen'),
    });
    expect((await marksNow()).find((mark) => mark.id === 'field:mieter.name')).toMatchObject({
      value: 'Anna Weber',
    });
  });
});
