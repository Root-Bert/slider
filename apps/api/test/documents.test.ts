import type Anthropic from '@anthropic-ai/sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { blankOdt, OdtDocument } from '@slider/odt';
import {
  writerAiProposalSchema,
  writerCommentSchema,
  writerDocumentSchema,
  writerEditResultSchema,
  writerOpenedSchema,
  type CloudNodeDetail,
  type WorkspaceRole,
  type WriterComment,
  type WriterDocument,
  type WriterEditResult,
  type WriterOpened,
  type WriterParagraphBlock,
} from '@slider/shared';
import { cloudVersions, workspaceMembers } from '../src/db/schema';
import { documentAiIdle } from '../src/services/document-ai';
import { createTestContext, signedInUser, type TestContext } from './helpers';

/** The AI as far as a document uses it: scripted answers, the requests recorded. */
const ai = {
  steps: [] as Anthropic.Beta.BetaContentBlock[][],
  requests: [] as Anthropic.Beta.MessageCreateParams[],
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

const text = (block: WriterOpened['content']['blocks'][number] | undefined) =>
  block?.type === 'paragraph' ? block.runs.map((run) => run.text).join('') : null;

describe('Writer – text documents', () => {
  it('keeps a document as a file in Cloud: steps become versions, typing on is one version, comments follow their words, roles decide who writes, a comment handed to the AI changes the text and is taken back', async () => {
    const made = await ctx.request('/api/documents', {
      method: 'POST',
      json: { workspaceId: ctx.workspaceId, title: 'Bericht', template: 'report' },
    });
    expect(made.status).toBe(201);
    const document = writerDocumentSchema.parse(await made.json());
    expect(document).toMatchObject({
      title: 'Bericht',
      fileName: 'Bericht.odt',
      place: 'Meine Dateien',
      permissions: { canEdit: true, canComment: true, canManage: true },
    });

    const open = async (cookie?: string) => {
      const response = await ctx.request(`/api/documents/${document.id}`, { cookie });
      return response.status === 200
        ? writerOpenedSchema.parse(await response.json())
        : response.status;
    };
    const first = (await open()) as WriterOpened;
    expect(first.content.seq).toBe(0);
    expect(first.content.page.width).toBeCloseTo(595.3, 0);
    expect(first.content.blocks.map((block) => block.id).slice(0, 3)).toEqual(['w1', 'w2', 'w3']);
    expect(first.content.blocks[0]).toMatchObject({ kind: 'title', look: { size: 28 } });
    expect(first.content.formats.heading1.bold).toBe(true);

    const edit = async (operations: unknown[], cookie?: string, clientEditId?: string) =>
      ctx.request(`/api/documents/${document.id}/edits`, {
        method: 'POST',
        json: { operations, clientEditId: clientEditId ?? crypto.randomUUID() },
        cookie,
      });
    const set = (id: string, value: string) => ({
      type: 'setParagraph',
      id,
      paragraph: { kind: 'text', runs: [{ text: value }] },
    });

    // A comment on „Welt“, before anything is typed in front of it.
    const sentOnce = crypto.randomUUID();
    const one = await edit([set('w3', 'Hallo Welt')], undefined, sentOnce);
    const result = writerEditResultSchema.parse(await one.json());
    expect(result).toMatchObject({ seq: 1, dropped: [] });
    const commented = await ctx.request(`/api/documents/${document.id}/comments`, {
      method: 'POST',
      json: {
        id: crypto.randomUUID(),
        parentId: null,
        body: 'Größer denken',
        anchor: { paragraphId: 'w3', start: 6, end: 10, quote: 'Welt' },
      },
    });
    const comment = writerCommentSchema.parse(await commented.json());
    expect(commented.status).toBe(201);

    // The same step sent again is written once; typing on replaces the version of a moment ago.
    const again = (await (
      await edit([set('w3', 'Anders')], undefined, sentOnce)
    ).json()) as WriterEditResult;
    expect(again.seq).toBe(1);
    const two = (await (
      await edit([
        set('w3', 'Oh, hallo Welt'),
        set('weg', 'gibt es nicht'),
        {
          type: 'insertParagraph',
          id: 'neu1',
          afterId: 'w3',
          paragraph: {
            kind: 'text',
            list: { kind: 'number', level: 0 },
            lineHeight: 1.5,
            runs: [{ text: 'Punkt', bold: true }],
          },
        },
        // A format's own look, for the whole document.
        {
          type: 'setFormatLook',
          format: 'heading2',
          look: { size: 18, bold: false, font: 'Inter' },
        },
      ])
    ).json()) as WriterEditResult;
    expect(two).toMatchObject({ seq: 2, dropped: [1] });
    const versions = await ctx.deps.db
      .select()
      .from(cloudVersions)
      .where(eq(cloudVersions.nodeId, document.id));
    // The new file, and what was typed since.
    expect(versions.map((version) => version.number).sort()).toEqual([1, 2]);
    const detail = (await (
      await ctx.request(`/api/cloud/nodes/${document.id}`)
    ).json()) as CloudNodeDetail;
    expect(detail.node.versionCount).toBe(2);
    expect(detail.node.versionId).toBe(two.versionId);

    const now = (await open()) as WriterOpened;
    expect(now.content.seq).toBe(2);
    expect(text(now.content.blocks[2])).toBe('Oh, hallo Welt');
    const added = now.content.blocks[3] as WriterParagraphBlock;
    expect(added).toMatchObject({
      id: 'neu1',
      list: { kind: 'number', level: 0 },
      lineHeight: 1.5,
      runs: [{ text: 'Punkt', bold: true }],
    });
    expect(now.content.formats.heading2).toMatchObject({ size: 18, bold: false, font: 'Inter' });
    expect(now.content.formats.heading1).toEqual(first.content.formats.heading1);
    expect(
      (await edit([{ type: 'setFormatLook', format: 'heading2', look: { size: 0 } }])).status,
    ).toBe(400);
    const comments = (await (
      await ctx.request(`/api/documents/${document.id}/comments`)
    ).json()) as WriterComment[];
    expect(comments[0]?.anchor).toMatchObject({ paragraphId: 'w3', start: 10, end: 14 });

    // The file itself is a text document any office program reads, as Cloud hands it out.
    const file = await ctx.request(`/api/cloud/nodes/${document.id}/content?download=1`);
    const read = await OdtDocument.open(new Uint8Array(await file.arrayBuffer()));
    expect(read.text()).toContain('Oh, hallo Welt');

    // Photos as for a slide's picture: none before a search on a server without a photo source.
    const photos = await ctx.request(`/api/documents/${document.id}/stock/photos`);
    expect(await photos.json()).toEqual({ photos: [] });
    expect((await ctx.request(`/api/documents/${document.id}/stock/photos?q=Berge`)).status).toBe(
      404,
    );
    // Every id picked asks the photo service with the workspace's key: a script trying made-up
    // ones stops at the edits' window, as on a slide – what was typed counts into it.
    const picks: number[] = [];
    while (picks.at(-1) !== 429 && picks.length < 130) {
      const pick = `/api/documents/${document.id}/stock/photos/erfunden-${picks.length}`;
      picks.push((await ctx.request(pick, { method: 'POST' })).status);
    }
    expect(picks.length).toBeLessThanOrEqual(120);
    expect(new Set(picks)).toEqual(new Set([404, 429]));
    ctx.clock.advance(60_000);
    // The picture panel offers what the workspace has; a picture made by the AI needs its key.
    expect(await (await ctx.request(`/api/documents/${document.id}/tools`)).json()).toEqual({
      stockPhotos: false,
      photoSource: null,
      imageGeneration: false,
      imageReferences: false,
    });
    const generated = await ctx.request(`/api/documents/${document.id}/pictures/generate`, {
      method: 'POST',
      json: { prompt: 'Berge im Nebel' },
    });
    expect(generated.status).toBe(400);
    expect(await generated.text()).toContain('keine Bildgenerierung');

    // Who only looks reads; who reviews comments; neither writes.
    const viewer = await member('Vera', 'viewer');
    const reviewer = await member('Rolf', 'reviewer');
    // New, it lies in its maker's own files: nobody else sees it until it goes where they do.
    expect(
      (await ctx.request(`/api/documents/${document.id}`, { cookie: viewer.cookie })).status,
    ).toBe(404);
    const { areas } = (await (
      await ctx.request(`/api/workspaces/${ctx.workspaceId}/cloud`)
    ).json()) as { areas: { id: string; root: boolean }[] };
    await ctx.request('/api/cloud/nodes/move', {
      method: 'POST',
      json: { ids: [document.id], areaId: areas.find((area) => area.root)?.id },
    });
    // Made from inside an area (Cloud's „Neu“), it lies there at once – everyone there reads it.
    const inArea = await ctx.request('/api/documents', {
      method: 'POST',
      json: { workspaceId: ctx.workspaceId, areaId: areas.find((area) => area.root)?.id },
    });
    expect(inArea.status).toBe(201);
    const placed = writerDocumentSchema.parse(await inArea.json());
    expect(placed.place).not.toBe('Meine Dateien');
    expect(
      (await ctx.request(`/api/documents/${placed.id}`, { cookie: viewer.cookie })).status,
    ).toBe(200);
    await ctx.request('/api/cloud/nodes/trash', { method: 'POST', json: { ids: [placed.id] } });
    const seen = (await open(viewer.cookie)) as WriterOpened;
    expect(seen.document.permissions).toEqual({
      canEdit: false,
      canComment: false,
      canManage: false,
    });
    expect((await edit([set('w3', 'Nein')], viewer.cookie)).status).toBe(403);
    expect((await edit([set('w3', 'Nein')], reviewer.cookie)).status).toBe(403);
    const answer = (parentId: string, cookie: string) =>
      ctx.request(`/api/documents/${document.id}/comments`, {
        method: 'POST',
        json: { id: crypto.randomUUID(), parentId, body: 'Einverstanden', anchor: null },
        cookie,
      });
    expect((await answer(comment.id, viewer.cookie)).status).toBe(403);
    expect((await answer(comment.id, reviewer.cookie)).status).toBe(201);
    const done = await ctx.request(`/api/document-comments/${comment.id}`, {
      method: 'PATCH',
      json: { status: 'done' },
      cookie: reviewer.cookie,
    });
    expect(writerCommentSchema.parse(await done.json())).toMatchObject({
      status: 'done',
      resolvedBy: { name: 'Rolf' },
    });
    // Reactions as on a slide: one per person, another replaces it, `null` takes it back; who only
    // looks doesn't react.
    const react = (kind: string | null, cookie?: string) =>
      ctx.request(`/api/document-comments/${comment.id}/reaction`, {
        method: 'PUT',
        json: { kind },
        cookie,
      });
    expect((await react('up', viewer.cookie)).status).toBe(403);
    await react('up', reviewer.cookie);
    await react('down');
    const reacted = writerCommentSchema.parse(await (await react('neutral')).json());
    expect(reacted.reactions?.map((each) => [each.author.name, each.kind])).toEqual([
      ['Rolf', 'up'],
      [reacted.author.name, 'neutral'],
    ]);
    await react(null, reviewer.cookie);
    const listed = (await (
      await ctx.request(`/api/documents/${document.id}/comments`)
    ).json()) as WriterComment[];
    expect(listed.find((each) => each.id === comment.id)?.reactions).toHaveLength(1);
    // Where one's caret stands goes to the others who have it open – whoever may open it.
    const presence = (sel: unknown, cookie?: string) =>
      ctx.request(`/api/documents/${document.id}/presence`, {
        method: 'POST',
        json: { sel },
        cookie,
      });
    const caret = { id: 'w1', offset: 2 };
    expect((await presence({ anchor: caret, focus: caret }, viewer.cookie)).status).toBe(204);
    expect((await presence(null)).status).toBe(204);
    expect((await presence({ anchor: caret })).status).toBe(400);
    expect(
      (
        await ctx.request(`/api/document-comments/${comment.id}`, {
          method: 'DELETE',
          cookie: reviewer.cookie,
        })
      ).status,
    ).toBe(403);

    // A comment handed to the AI: who may write, with a key. Its change is one step, a version
    // of its own, heard like anyone's – and taken back and applied again from its card.
    const ask = (commentId: string, cookie?: string) =>
      ctx.request(`/api/documents/${document.id}/ai-proposals`, {
        method: 'POST',
        json: { id: crypto.randomUUID(), commentId },
        cookie,
      });
    expect((await ask(comment.id, reviewer.cookie)).status).toBe(403);
    expect((await ask(comment.id)).status).toBe(409);
    await ctx.request(`/api/workspaces/${ctx.workspaceId}/integrations/keys`, {
      method: 'POST',
      json: { kind: 'ai', provider: 'anthropic', apiKey: 'sk-ant-api03-good-AbCdEfGhIjKlMnOpQrSt' },
    });
    const proposals = async () =>
      writerAiProposalSchema
        .array()
        .parse(await (await ctx.request(`/api/documents/${document.id}/ai-proposals`)).json());
    const versionCount = async () =>
      (await ctx.deps.db.select().from(cloudVersions).where(eq(cloudVersions.nodeId, document.id)))
        .length;
    const texts = async () => ((await open()) as WriterOpened).content.blocks.map(text);
    const ids = async () => ((await open()) as WriterOpened).content.blocks.map((each) => each.id);
    const [textsBefore, idsBefore, versionsBefore] = [
      await texts(),
      await ids(),
      await versionCount(),
    ];
    ai.steps.push([
      {
        type: 'tool_use',
        id: 'toolu_1',
        name: 'edit_document',
        input: {
          changes: [
            { action: 'replace', id: 'w3', text: 'Hallo **große** Welt, 2 * 3' },
            { action: 'insert', id: 'w3', text: 'Erstens' },
            { action: 'insert', id: 'w3', text: 'Zweitens', list: 'bullet' },
            { action: 'delete', id: 'w1' },
            { action: 'delete', id: 'w2' },
          ],
          summary: 'Die Welt ist jetzt groß.',
        },
      } as Anthropic.Beta.BetaContentBlock,
    ]);
    const asked = await ask(comment.id);
    expect(asked.status).toBe(202);
    expect(writerAiProposalSchema.parse(await asked.json()).status).toBe('running');
    await documentAiIdle();
    const [proposal] = await proposals();
    expect(proposal).toMatchObject({
      status: 'applied',
      summary: 'Die Welt ist jetzt groß.',
      commentId: comment.id,
      author: { type: 'ai' },
    });
    const shown = JSON.stringify(ai.requests.at(-1)?.messages);
    expect(shown).toContain('<p id=\\"w3\\">');
    expect(shown).toContain('Größer denken');
    const changed = (await open()) as WriterOpened;
    expect(changed.content.blocks.map((each) => each.id).slice(0, 1)).toEqual(['w3']);
    const rewritten = changed.content.blocks[0] as WriterParagraphBlock;
    expect(rewritten.runs.map((run) => [run.text, run.bold ?? false])).toEqual([
      ['Hallo ', false],
      ['große', true],
      [' Welt, 2 * 3', false],
    ]);
    expect(changed.content.blocks.slice(1, 3).map(text)).toEqual(['Erstens', 'Zweitens']);
    expect(changed.content.blocks[2]).toMatchObject({ list: { kind: 'bullet' } });
    expect(await versionCount()).toBe(versionsBefore + 1);
    const move = async (action: 'revert' | 'reapply', cookie?: string) =>
      ctx.request(`/api/document-ai-proposals/${proposal!.id}/${action}`, {
        method: 'POST',
        cookie,
      });
    expect((await move('revert', reviewer.cookie)).status).toBe(403);
    expect(writerAiProposalSchema.parse(await (await move('revert')).json()).status).toBe(
      'reverted',
    );
    expect(await texts()).toEqual(textsBefore);
    expect(await ids()).toEqual(idsBefore);
    expect(writerAiProposalSchema.parse(await (await move('reapply')).json()).status).toBe(
      'applied',
    );
    expect((await texts()).slice(0, 3)).toEqual(['Hallo große Welt, 2 * 3', 'Erstens', 'Zweitens']);
    // A call that does not fit is told so and sent again; words alone are its answer.
    ai.steps.push(
      [
        {
          type: 'tool_use',
          id: 'toolu_2',
          name: 'edit_document',
          input: { changes: [{ action: 'delete', id: 'fehlt' }], summary: 'Weg.' },
        } as Anthropic.Beta.BetaContentBlock,
      ],
      [{ type: 'text', text: 'Das passt so.', citations: null } as Anthropic.Beta.BetaContentBlock],
    );
    expect((await ask(comment.id)).status).toBe(202);
    await documentAiIdle();
    expect(JSON.stringify(ai.requests.at(-1)?.messages)).toContain('There is no paragraph');
    expect((await proposals()).map((each) => [each.status, each.summary])).toEqual([
      ['applied', 'Die Welt ist jetzt groß.'],
      ['answered', 'Das passt so.'],
    ]);

    // A file brought along is a document too; deleted in Cloud it lies under „Gelöscht“.
    const brought = await blankOdt(new Date(), { template: 'letter' });
    const imported = await ctx.request(
      `/api/workspaces/${ctx.workspaceId}/documents/import?name=Brief.ott`,
      { method: 'POST', body: brought, headers: { 'Content-Length': String(brought.length) } },
    );
    expect(imported.status).toBe(201);
    const letter = writerDocumentSchema.parse(await imported.json());
    expect(letter.fileName).toBe('Brief.odt');
    const refused = await ctx.request(
      `/api/workspaces/${ctx.workspaceId}/documents/import?name=Bild.png`,
      { method: 'POST', body: brought, headers: { 'Content-Length': String(brought.length) } },
    );
    expect(refused.status).toBe(400);
    const list = async (scope = '') =>
      (
        (await (
          await ctx.request(`/api/workspaces/${ctx.workspaceId}/documents${scope}`)
        ).json()) as WriterDocument[]
      ).map((each) => each.title);
    expect((await list()).sort()).toEqual(['Bericht', 'Brief']);
    await ctx.request('/api/cloud/nodes/trash', { method: 'POST', json: { ids: [letter.id] } });
    expect(await list()).toEqual(['Bericht']);
    expect((await list('?scope=trash')).sort()).toEqual(['Brief', 'Neues Dokument']);
    const lost = await ctx.request(`/api/documents/${letter.id}`);
    expect(lost.status).toBe(404);
  });

  it('opens a Markdown file as it is: its lines are paragraphs, a step writes them back byte for byte around them, ids stay with the version, the AI writes lines of Markdown', async () => {
    const source = '# Titel\r\n\r\nEin **Absatz**.\r\n- eins\r\n';
    const bytes = new TextEncoder().encode(source);
    const brought = await ctx.request(
      `/api/workspaces/${ctx.workspaceId}/documents/import?name=Notizen.md`,
      { method: 'POST', body: bytes, headers: { 'Content-Length': String(bytes.length) } },
    );
    expect(brought.status).toBe(201);
    const document = writerDocumentSchema.parse(await brought.json());
    expect(document).toMatchObject({ title: 'Notizen', fileName: 'Notizen.md' });
    const listed = (await (
      await ctx.request(`/api/workspaces/${ctx.workspaceId}/documents`)
    ).json()) as WriterDocument[];
    expect(listed.map((each) => each.fileName)).toContain('Notizen.md');

    const open = async () =>
      writerOpenedSchema.parse(await (await ctx.request(`/api/documents/${document.id}`)).json());
    const first = await open();
    expect(first.content.blocks.map((block) => [block.id, text(block)])).toEqual([
      ['L1', '# Titel'],
      ['L2', ''],
      ['L3', 'Ein **Absatz**.'],
      ['L4', '- eins'],
    ]);
    const edit = async (operations: unknown[]) =>
      writerEditResultSchema.parse(
        await (
          await ctx.request(`/api/documents/${document.id}/edits`, {
            method: 'POST',
            json: { operations, clientEditId: crypto.randomUUID() },
          })
        ).json(),
      );
    const line = (value: string) => ({ kind: 'text', runs: [{ text: value, bold: true }] });
    const done = await edit([
      { type: 'setParagraph', id: 'L4', paragraph: line('- zwei') },
      { type: 'insertParagraph', id: 'pneu', afterId: 'L1', paragraph: line('Unter dem Titel') },
      {
        type: 'insertPicture',
        id: 'pbild',
        afterId: 'L1',
        picture: { path: 'x', width: 1, height: 1 },
      },
    ]);
    expect(done.dropped).toEqual([2]);
    const file = await ctx.request(`/api/cloud/nodes/${document.id}/content`);
    expect(await file.text()).toBe(
      '# Titel\r\nUnter dem Titel\r\n\r\nEin **Absatz**.\r\n- zwei\r\n',
    );
    // The new line keeps the id it was sent with, read again from the version.
    const now = await open();
    expect(now.content.blocks.map((block) => block.id)).toEqual(['L1', 'pneu', 'L2', 'L3', 'L4']);
    expect(
      (
        await ctx.request(`/api/documents/${document.id}/pictures`, {
          method: 'POST',
          body: new Uint8Array([137, 80, 78, 71]),
          headers: { 'Content-Type': 'image/png' },
        })
      ).status,
    ).toBe(400);

    // The AI reads and writes the lines as they stand in the file, signs and all.
    await ctx.request(`/api/workspaces/${ctx.workspaceId}/integrations/keys`, {
      method: 'POST',
      json: { kind: 'ai', provider: 'anthropic', apiKey: 'sk-ant-api03-good-AbCdEfGhIjKlMnOpQrSt' },
    });
    ai.steps = [
      [
        {
          type: 'tool_use',
          id: 'call_1',
          name: 'edit_document',
          input: {
            changes: [{ action: 'replace', id: 'L3', text: 'Ein **neuer** Absatz.' }],
            summary: 'Neu.',
          },
        } as Anthropic.Beta.BetaContentBlock,
      ],
    ];
    const commented = writerCommentSchema.parse(
      await (
        await ctx.request(`/api/documents/${document.id}/comments`, {
          method: 'POST',
          json: {
            id: crypto.randomUUID(),
            parentId: null,
            body: 'Neuer machen',
            anchor: { paragraphId: 'L3', start: 0, end: 3, quote: 'Ein' },
          },
        })
      ).json(),
    );
    const asked = await ctx.request(`/api/documents/${document.id}/ai-proposals`, {
      method: 'POST',
      json: { id: crypto.randomUUID(), commentId: commented.id },
    });
    expect(asked.status).toBe(202);
    await documentAiIdle();
    expect(JSON.stringify(ai.requests.at(-1))).toContain('<p id=\\"L3\\">Ein **Absatz**.</p>');
    expect(text((await open()).content.blocks[3])).toBe('Ein **neuer** Absatz.');
  });
});
