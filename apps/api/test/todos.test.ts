import type Anthropic from '@anthropic-ai/sdk';
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  CloudArea,
  SenderEvent,
  Todo,
  TodoMilestone,
  TodoProject,
  WorkspaceRole,
} from '@slider/shared';
import JSZip from 'jszip';
import {
  cloudAgentAsks,
  cloudAgents,
  todoMilestones,
  todoProjects,
  todos,
  workspaceMembers,
} from '../src/db/schema';
import { openAgentChat } from '../src/services/agent-chats';
import { SEALED_PREFIX } from '../src/crypto/content-crypto';
import { runAppTool } from '../src/services/mcp-cloud';
import { senderLive } from '../src/services/sender';
import { createTestContext, signedInUser, type TestContext } from './helpers';

let ctx: TestContext;
/** What the agent sent on a to-do was told, and the tool calls it makes (one per turn). */
const told: string[] = [];
let plan: { name: string; input: unknown }[] = [];
const agentAi = () =>
  ({
    models: {
      retrieve: async (model: string) => ({ id: model, max_tokens: 64_000 }),
      list: async function* () {
        await Promise.resolve();
        yield { id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5' };
      },
    },
    beta: {
      messages: {
        stream: (params: { messages?: { role: string; content: unknown }[] }) => ({
          finalMessage: async () => {
            const first = params.messages?.[0]?.content;
            told.push(typeof first === 'string' ? first : JSON.stringify(first));
            const step = plan.shift();
            const base = {
              id: 'msg',
              type: 'message',
              role: 'assistant',
              model: 'claude-sonnet-5-5',
              stop_sequence: null,
              usage: { input_tokens: 1, output_tokens: 1 },
            };
            return step
              ? {
                  ...base,
                  stop_reason: 'tool_use',
                  content: [{ type: 'tool_use', id: `tu_${plan.length}`, ...step }],
                }
              : {
                  ...base,
                  stop_reason: 'end_turn',
                  content: [{ type: 'text', text: 'Erledigt.' }],
                };
          },
          abort: () => undefined,
        }),
      },
    },
  }) as unknown as Anthropic;

beforeEach(async () => {
  ctx = await createTestContext({ anthropic: agentAi });
  told.length = 0;
  plan = [];
});
afterEach(() => ctx.cleanup());

async function member(name: string, role: WorkspaceRole) {
  const person = await signedInUser(ctx, { name, email: `${name.toLowerCase()}@firma.de` });
  await ctx.deps.db
    .insert(workspaceMembers)
    .values({ workspaceId: ctx.workspaceId, userId: person.user.id, role });
  return person;
}
const send = (method: string, url: string, json?: unknown, cookie?: string) =>
  ctx.request(`/api${url}`, { method, ...(json === undefined ? {} : { json }), cookie });
async function ok<T>(response: Promise<Response>, status = 200): Promise<T> {
  const res = await response;
  expect(res.status, await res.clone().text()).toBe(status);
  return (status === 204 ? undefined : await res.json()) as T;
}
const list = (query = '', cookie?: string) =>
  ok<Todo[]>(send('GET', `/workspaces/${ctx.workspaceId}/todos${query}`, undefined, cookie));
const make = (input: object, cookie?: string) =>
  ok<Todo>(send('POST', `/workspaces/${ctx.workspaceId}/todos`, input, cookie), 201);

describe('To-dos', () => {
  it('keeps one’s own to oneself, an area’s to who sees it, numbers them, sends agents on them by scope and says it live', async () => {
    const anna = await member('Anna Lenz', 'member');
    const vera = await member('Vera Blum', 'viewer');
    const sales = await ok<CloudArea>(
      send('POST', `/workspaces/${ctx.workspaceId}/cloud/areas`, {
        name: 'Vertrieb',
        color: 'cyan',
      }),
      201,
    );
    const secret = await ok<CloudArea>(
      send('POST', `/workspaces/${ctx.workspaceId}/cloud/areas`, {
        name: 'Geheim',
        color: 'red',
        visibility: 'members',
      }),
      201,
    );
    const heard: SenderEvent[] = [];
    const leave = senderLive.join(ctx.workspaceId, anna.user.id, (event) => heard.push(event));

    // One's own: only oneself sees it, only oneself does it; numbered per workspace.
    const mine = await make({ title: '  Steuer machen ', priority: 2 });
    expect(mine).toMatchObject({
      number: 1,
      title: 'Steuer machen',
      status: 'todo',
      areaId: null,
      canEdit: true,
      createdBy: { id: ctx.ownerId },
    });
    expect(
      (
        await send('POST', `/workspaces/${ctx.workspaceId}/todos`, {
          title: 'X',
          assigneeId: anna.user.id,
        })
      ).status,
    ).toBe(400);
    // A source is one's own mail, its link https only.
    for (const source of [
      { kind: 'mail', threadId: 'x', url: 'javascript:alert(1)' },
      { kind: 'mail', threadId: 'not-mine' },
    ])
      expect(
        (await send('POST', `/workspaces/${ctx.workspaceId}/todos`, { title: 'X', source })).status,
      ).toBe(400);
    expect((await send('GET', `/todos/${mine.id}`, undefined, anna.cookie)).status).toBe(404);
    expect(await list('', anna.cookie)).toEqual([]);
    expect(heard).toEqual([]);
    // Title and words sealed at rest.
    const [stored] = await ctx.deps.db
      .select({ raw: sql<string>`${todos.title}` })
      .from(todos)
      .where(eq(todos.id, mine.id));
    expect(stored?.raw.startsWith(SEALED_PREFIX)).toBe(true);

    // An area's: whoever sees the area – live; a viewer reads, does not change; a closed
    // area's stays with its people; someone who does not see it cannot be given it.
    const offer = await make({
      title: 'Angebot Acme',
      areaId: sales.id,
      assigneeId: anna.user.id,
      dueOn: '2026-12-01',
    });
    expect(offer).toMatchObject({ number: 2, assignee: { id: anna.user.id }, dueOn: '2026-12-01' });
    expect(heard).toEqual([{ type: 'todos' }]);
    await make({ title: 'Geheimplan', areaId: secret.id });
    expect((await list('', anna.cookie)).map((one) => one.title)).toEqual(['Angebot Acme']);
    expect(
      (
        await send(
          'GET',
          `/workspaces/${ctx.workspaceId}/todos?area=${secret.id}`,
          undefined,
          anna.cookie,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await send('POST', `/workspaces/${ctx.workspaceId}/todos`, {
          title: 'Y',
          areaId: secret.id,
          assigneeId: anna.user.id,
        })
      ).status,
    ).toBe(400);
    const verasView = await ok<Todo>(send('GET', `/todos/${offer.id}`, undefined, vera.cookie));
    expect(verasView.canEdit).toBe(false);
    expect(
      (await send('PATCH', `/todos/${offer.id}`, { status: 'done' }, vera.cookie)).status,
    ).toBe(403);
    expect(
      (
        await send(
          'POST',
          `/workspaces/${ctx.workspaceId}/todos`,
          { title: 'Z', areaId: sales.id },
          vera.cookie,
        )
      ).status,
    ).toBe(403);

    // Linear's order: in progress, to do, backlog, then done; urgent first, none last.
    await make({ title: 'Dringend', areaId: sales.id, priority: 1 });
    await make({ title: 'Später', areaId: sales.id, status: 'backlog' });
    const started = await ok<Todo>(
      send('PATCH', `/todos/${offer.id}`, { status: 'in_progress' }, anna.cookie),
    );
    expect(started.completedAt).toBeNull();
    expect((await list(`?area=${sales.id}`)).map((one) => one.title)).toEqual([
      'Angebot Acme',
      'Dringend',
      'Später',
    ]);
    const done = await ok<Todo>(
      send('PATCH', `/todos/${offer.id}`, { status: 'done' }, anna.cookie),
    );
    expect(done.completedAt).toEqual(expect.any(String));
    expect((await list(`?area=${sales.id}`)).at(-1)?.title).toBe('Angebot Acme');
    // Moved to one's own, the one doing it goes when they would not see it.
    const moved = await ok<Todo>(send('PATCH', `/todos/${offer.id}`, { areaId: null }));
    expect(moved).toMatchObject({ areaId: null, assignee: null });
    expect((await send('GET', `/todos/${offer.id}`, undefined, anna.cookie)).status).toBe(404);

    // Agents: one's own to-do only to one's own private agent; an area's also to one shared there.
    // Given and sent are two steps: giving it starts nothing, „Losschicken“ (`/send`) does.
    const agent = async (userId: string, shared: boolean, areaId: string | null) => {
      const agentId = crypto.randomUUID();
      await ctx.deps.db.insert(cloudAgents).values({
        id: agentId,
        workspaceId: ctx.workspaceId,
        userId,
        title: shared ? 'Vertriebsagent' : 'Mein Agent',
        shared,
        areaId,
      });
      await openAgentChat(
        ctx.deps.db,
        { id: agentId, workspaceId: ctx.workspaceId },
        { id: agentId, userId, at: ctx.deps.clock.now() },
      );
      return agentId;
    };
    const salesAgent = await agent(anna.user.id, true, sales.id);
    const own = await agent(ctx.ownerId, false, null);
    expect((await send('PATCH', `/todos/${mine.id}`, { assigneeAgentId: salesAgent })).status).toBe(
      400,
    );
    expect((await send('POST', `/todos/${mine.id}/send`)).status).toBe(400);
    // Without the workspace's AI it cannot start (nor a new one be made): it stays given.
    await ok(send('PATCH', `/todos/${mine.id}`, { assigneeAgentId: own }));
    expect((await send('POST', `/todos/${mine.id}/send`)).status).toBe(409);
    expect((await send('POST', `/todos/${mine.id}/agent`)).status).toBe(409);
    expect((await ok<Todo>(send('GET', `/todos/${mine.id}`))).assigneeAgent?.id).toBe(own);
    expect(told).toHaveLength(0);
    await ok(
      send('POST', `/workspaces/${ctx.workspaceId}/integrations/keys`, {
        kind: 'ai',
        provider: 'anthropic',
        apiKey: 'sk-ant-api03-todos-test-key-00000000000',
      }),
    );
    await ok(send('POST', `/todos/${mine.id}/send`));
    await expect.poll(() => told.length).toBe(1);
    // Sent on an area's to-do, the agent is told it and, with its tools, sets it done.
    const plan2 = await make({
      title: 'Präsentation bauen',
      areaId: sales.id,
      description: 'Für Acme.',
    });
    plan = [
      { name: 'update_todo', input: { todo: String(plan2.number), status: 'done' } },
      { name: 'list_milestones', input: { area: sales.id } },
      { name: 'delete_todo', input: { todo: String(plan2.number) } },
    ];
    told.length = 0;
    const given = await ok<Todo>(
      send('PATCH', `/todos/${plan2.id}`, { assigneeAgentId: salesAgent }),
    );
    expect(given.assigneeAgent).toEqual({ id: salesAgent, title: 'Vertriebsagent' });
    expect(told).toHaveLength(0);
    // Who only views the area sends nobody.
    expect((await send('POST', `/todos/${plan2.id}/send`, undefined, vera.cookie)).status).toBe(
      403,
    );
    await ok(send('POST', `/todos/${plan2.id}/send`));
    await expect
      .poll(async () => (await ok<Todo>(send('GET', `/todos/${plan2.id}`))).status)
      .toBe('done');
    expect(told.join('\n')).toContain(`Bearbeite die Aufgabe #${plan2.number}: Präsentation bauen`);
    expect(told.join('\n')).toContain('Für Acme.');
    const [byAgent] = await ctx.deps.db.select().from(todos).where(eq(todos.id, plan2.id));
    expect(byAgent?.assigneeAgentId).toBe(salesAgent);
    // Deleting it only asks: a card waits for whose rights it runs with; the to-do stays.
    await expect
      .poll(async () =>
        (
          await ctx.deps.db
            .select()
            .from(cloudAgentAsks)
            .where(eq(cloudAgentAsks.agentId, salesAgent))
        ).map((row) => [row.tool, row.text, row.state]),
      )
      .toEqual([['delete_todo', '„Präsentation bauen“ löschen?', 'open']]);
    // „Neuer Agent“: one's own, plainly „Agent“, in its area, given it – nothing runs.
    told.length = 0;
    const fresh = await ok<Todo>(send('POST', `/todos/${plan2.id}/agent`), 201);
    expect(fresh.assigneeAgent).toMatchObject({ title: 'Agent' });
    const [made] = await ctx.deps.db
      .select()
      .from(cloudAgents)
      .where(eq(cloudAgents.id, fresh.assigneeAgent!.id));
    expect(made).toMatchObject({ userId: ctx.ownerId, areaId: sales.id, shared: false });
    expect(told).toHaveLength(0);

    // An app (MCP) works as the person: makes one in an area for someone named, changes it by number.
    const app = async (name: string, args: Record<string, unknown>, as = ctx.ownerId) => {
      const ran = await runAppTool(
        ctx.deps,
        {
          viewer: {
            kind: 'owner',
            author: { type: 'owner', id: as, name: 'Owner', color: 'blue' },
          },
          workspaceId: ctx.workspaceId,
        },
        name,
        args,
      );
      return { error: ran.isError === true, text: (ran.content[0] as { text: string }).text };
    };
    const fair = await app('create_todo', {
      title: 'Messe planen',
      area: sales.id,
      assignee: 'Anna Lenz',
      priority: 3,
    });
    expect(fair.text).toMatch(/^Made: .*Messe planen – area „Vertrieb“.*Anna Lenz/);
    const fairNumber = /#(\d+)/.exec(fair.text)?.[1];
    expect((await app('update_todo', { todo: fairNumber, status: 'done' })).text).toContain(
      '[done',
    );
    expect((await app('list_todos', { open_only: true })).text).not.toContain('Messe planen');
    expect(await app('create_todo', { title: 'Z', assignee: 'Anna Lenz' })).toMatchObject({
      error: true,
    });
    expect((await app('read_todo', { todo: '#999' })).error).toBe(true);

    // Milestones: a place's own – a to-do takes only one of its place's, moved it leaves it; who
    // views changes none; deleted, its to-dos stay without it. Apps name them, start and milestone
    // stand in their lines.
    const milestones = (cookie?: string) =>
      ok<TodoMilestone[]>(
        send('GET', `/workspaces/${ctx.workspaceId}/todo-milestones`, undefined, cookie),
      );
    const beta = await ok<TodoMilestone>(
      send('POST', `/workspaces/${ctx.workspaceId}/todo-milestones`, {
        name: ' Beta ',
        areaId: sales.id,
        dueOn: '2026-12-20',
      }),
      201,
    );
    const taxYear = await ok<TodoMilestone>(
      send('POST', `/workspaces/${ctx.workspaceId}/todo-milestones`, { name: 'Steuerjahr' }),
      201,
    );
    const [sealedName] = await ctx.deps.db
      .select({ raw: sql<string>`${todoMilestones.name}` })
      .from(todoMilestones)
      .where(eq(todoMilestones.id, beta.id));
    expect(sealedName?.raw.startsWith(SEALED_PREFIX)).toBe(true);
    expect((await send('PATCH', `/todos/${mine.id}`, { milestoneId: beta.id })).status).toBe(400);
    expect(
      await ok<Todo>(
        send('PATCH', `/todos/${plan2.id}`, {
          milestoneId: beta.id,
          startOn: '2026-12-01',
          dueOn: '2026-12-10',
        }),
      ),
    ).toMatchObject({
      startOn: '2026-12-01',
      dueOn: '2026-12-10',
      milestone: { id: beta.id, name: 'Beta', dueOn: '2026-12-20' },
    });
    // Put into a milestone without a place among its lines: last of all; a place given: kept, also
    // into another milestone at once.
    const listed = await ok<Todo[]>(send('GET', `/workspaces/${ctx.workspaceId}/todos`));
    const placed = listed.find((one) => one.id === plan2.id)!;
    expect(placed.position).toBe(Math.max(...listed.map((one) => one.position)));
    expect(placed.position).toBeGreaterThan(plan2.position);
    expect(
      await ok<Todo>(send('PATCH', `/todos/${plan2.id}`, { position: 0.5, milestoneId: null })),
    ).toMatchObject({ position: 0.5, milestone: null });
    await ok(send('PATCH', `/todos/${plan2.id}`, { milestoneId: beta.id, position: 0.25 }));
    expect((await milestones(anna.cookie)).map((one) => one.name)).toEqual(['Beta']);
    expect(
      (await send('PATCH', `/todo-milestones/${beta.id}`, { name: 'X' }, vera.cookie)).status,
    ).toBe(403);
    const stand = await app('create_todo', {
      title: 'Stand bauen',
      area: sales.id,
      start: '2026-12-05',
      due: '2026-12-08',
      milestone: ' beta ',
    });
    expect(stand.text).toContain(
      'starts 2026-12-05, due 2026-12-08, milestone „Beta“ (2026-12-20)',
    );
    const standNumber = /#(\d+)/.exec(stand.text)?.[1];
    // „Wartet auf“: to-dos of its own place alone – not itself, not one of another place, no loop.
    const standRef = /^Made: (\S+)/.exec(stand.text)?.[1];
    expect(
      (await ok<Todo>(send('PATCH', `/todos/${plan2.id}`, { blockedBy: [standRef, standRef] })))
        .blockedBy,
    ).toEqual([standRef]);
    expect((await ok<Todo>(send('GET', `/todos/${standRef}`))).blockedBy).toEqual([]);
    for (const [id, blockedBy] of [
      [standRef, [plan2.id]],
      [plan2.id, [plan2.id]],
      [plan2.id, [mine.id]],
    ] as const)
      expect((await send('PATCH', `/todos/${id}`, { blockedBy })).status).toBe(400);
    // Two at once, each on the other: one goes through, the other would close the loop – and the
    // file it brought is not taken, so it can be put on again.
    await ok(send('PATCH', `/todos/${plan2.id}`, { blockedBy: [] }));
    const upload = async (name: string) => {
      const form = new FormData();
      form.append('file', new File(['Plan'], name, { type: 'text/plain' }));
      const res = await ctx.request(`/api/workspaces/${ctx.workspaceId}/attachments`, {
        method: 'POST',
        body: form,
      });
      return ((await res.json()) as { id: string }).id;
    };
    const pair = [
      { id: plan2.id, on: standRef, file: await upload('A.txt') },
      { id: standRef!, on: plan2.id, file: await upload('B.txt') },
    ];
    const both = await Promise.all(
      pair.map((one) =>
        send('PATCH', `/todos/${one.id}`, { blockedBy: [one.on], attachments: [one.file] }),
      ),
    );
    expect(both.map((res) => res.status).sort()).toEqual([200, 400]);
    const lost = pair[both.findIndex((res) => res.status === 400)]!;
    expect(
      (
        await ok<Todo>(send('PATCH', `/todos/${lost.id}`, { attachments: [lost.file] }))
      ).attachments?.map((one) => one.id),
    ).toEqual([lost.file]);
    // One a person may only see: refused before a project of theirs is made for it.
    expect(
      await app('update_todo', { todo: standNumber, area: null, project: 'Privat' }, vera.user.id),
    ).toMatchObject({ error: true });
    expect(
      (
        await ok<{ name: string }[]>(
          send('GET', `/workspaces/${ctx.workspaceId}/todo-projects`, undefined, vera.cookie),
        )
      ).map((one) => one.name),
    ).not.toContain('Privat');
    // An app puts it on the timeline as dragged there: before one of its milestone's, or last;
    // before one of another place is refused. list_todos lists them in that order.
    await app('update_todo', { todo: standNumber, before: plan2.id });
    const sales2 = (await app('list_todos', { area: sales.id })).text;
    expect(sales2.indexOf('Stand bauen')).toBeLessThan(sales2.indexOf(plan2.title));
    expect((await ok<Todo>(send('GET', `/todos/${standRef}`))).position).toBe(0.25 - 1);
    expect(await app('update_todo', { todo: standNumber, before: mine.id })).toMatchObject({
      error: true,
    });
    await app('update_todo', { todo: standNumber, before: null });
    // „Wartet auf“ from an app: the list as it should stand, by number; read both ways.
    await app('update_todo', { todo: String(plan2.number), blocked_by: [] });
    expect(
      (await app('update_todo', { todo: standNumber, blocked_by: [String(plan2.number)] })).text,
    ).toContain(`waits on #${plan2.number}`);
    expect((await app('read_todo', { todo: String(plan2.number) })).text).toContain(
      `Waiting on it: #${standNumber}`,
    );
    expect(
      await app('update_todo', { todo: String(plan2.number), blocked_by: [standNumber] }),
    ).toMatchObject({ error: true });
    expect((await ok<Todo>(send('GET', `/todos/${standRef}`))).position).toBe(1.25);
    expect((await app('update_todo', { todo: standNumber, milestone: 'Launch' })).text).toContain(
      'milestone „Launch“',
    );
    expect((await milestones()).map((one) => one.name)).toEqual(['Beta', 'Steuerjahr', 'Launch']);
    // Moved to another place: its milestone and what it waits on go.
    expect(await ok<Todo>(send('PATCH', `/todos/${plan2.id}`, { areaId: null }))).toMatchObject({
      milestone: null,
      blockedBy: [],
    });
    await ok(send('PATCH', `/todos/${plan2.id}`, { milestoneId: taxYear.id }));
    const launch = (await milestones()).find((one) => one.name === 'Launch')!;
    expect(
      await ok<TodoMilestone>(
        send('PATCH', `/todo-milestones/${launch.id}`, { dueOn: '2027-01-15' }),
      ),
    ).toMatchObject({ name: 'Launch', dueOn: '2027-01-15', canEdit: true });
    await ok(send('DELETE', `/todo-milestones/${launch.id}`), 204);
    expect((await app('read_todo', { todo: standNumber })).text).not.toContain('milestone');

    // Projects: a place's plans beside its „Allgemein“ – a to-do or milestone goes only into its
    // own place's; another project drops the old one's milestone; who views makes none; apps name
    // them; deleted, its to-dos and milestones go back to „Allgemein“.
    const fairProject = await ok<TodoProject>(
      send('POST', `/workspaces/${ctx.workspaceId}/todo-projects`, {
        name: ' Messe ',
        areaId: sales.id,
      }),
      201,
    );
    expect(fairProject).toMatchObject({ name: 'Messe', areaId: sales.id, canEdit: true });
    const [sealedProject] = await ctx.deps.db
      .select({ raw: sql<string>`${todoProjects.name}` })
      .from(todoProjects)
      .where(eq(todoProjects.id, fairProject.id));
    expect(sealedProject?.raw.startsWith(SEALED_PREFIX)).toBe(true);
    expect(
      (
        await send(
          'POST',
          `/workspaces/${ctx.workspaceId}/todo-projects`,
          { name: 'X', areaId: sales.id },
          vera.cookie,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await ok<TodoProject[]>(
          send(
            'GET',
            `/workspaces/${ctx.workspaceId}/todo-projects?area=${sales.id}`,
            undefined,
            anna.cookie,
          ),
        )
      ).map((one) => one.name),
    ).toEqual(['Messe']);
    expect((await send('PATCH', `/todos/${mine.id}`, { projectId: fairProject.id })).status).toBe(
      400,
    );
    // One's own have projects too – one's alone: another neither sees nor changes them.
    const ownProject = await ok<TodoProject>(
      send('POST', `/workspaces/${ctx.workspaceId}/todo-projects`, { name: 'Umzug' }),
      201,
    );
    expect(ownProject).toMatchObject({ areaId: null, canEdit: true });
    expect(
      (
        await ok<TodoProject[]>(
          send('GET', `/workspaces/${ctx.workspaceId}/todo-projects`, undefined, anna.cookie),
        )
      ).map((one) => one.name),
    ).toEqual(['Messe']);
    expect(
      (await send('PATCH', `/todo-projects/${ownProject.id}`, { name: 'X' }, anna.cookie)).status,
    ).toBe(404);
    expect(
      (await ok<Todo>(send('PATCH', `/todos/${mine.id}`, { projectId: ownProject.id }))).project,
    ).toEqual({ id: ownProject.id, name: 'Umzug' });
    const boxes = await app('create_todo', { title: 'Kartons', project: 'umzug' });
    expect(boxes.text).toContain('own, project „Umzug“');
    await ok(send('DELETE', `/todos/${/^Made: (\S+) #/.exec(boxes.text)?.[1]}`), 204);
    await ok(send('DELETE', `/todo-projects/${ownProject.id}`), 204);
    expect(
      (await ok<Todo>(send('PATCH', `/todos/${mine.id}`, { priority: 2 }))).project,
    ).toBeNull();
    const standId = /^(\S+) #/.exec((await app('read_todo', { todo: standNumber })).text)?.[1];
    await ok(send('PATCH', `/todos/${standId}`, { milestoneId: beta.id }));
    expect(
      await ok<Todo>(send('PATCH', `/todos/${standId}`, { projectId: fairProject.id })),
    ).toMatchObject({ project: { id: fairProject.id, name: 'Messe' }, milestone: null });
    expect((await send('PATCH', `/todos/${standId}`, { milestoneId: beta.id })).status).toBe(400);
    expect((await app('update_todo', { todo: standNumber, milestone: 'Aufbau' })).text).toContain(
      'project „Messe“, starts 2026-12-05, due 2026-12-08, milestone „Aufbau“',
    );
    expect((await milestones()).find((one) => one.name === 'Aufbau')?.projectId).toBe(
      fairProject.id,
    );
    const flyer = await app('create_todo', { title: 'Flyer', area: sales.id, project: 'werbung' });
    expect(flyer.text).toContain('project „werbung“');
    const flyerId = /^Made: (\S+) #/.exec(flyer.text)?.[1];
    expect(
      (await ok<Todo>(send('PATCH', `/todos/${flyerId}`, { areaId: null }))).project,
    ).toBeNull();
    await ok(send('DELETE', `/todos/${flyerId}`), 204);
    await ok(send('PATCH', `/todo-projects/${fairProject.id}`, { name: 'Messe 2027' }));
    expect((await app('read_todo', { todo: standNumber })).text).toContain('project „Messe 2027“');
    await ok(send('DELETE', `/todo-projects/${fairProject.id}`), 204);
    expect((await app('read_todo', { todo: standNumber })).text).toContain(
      'project „Allgemein“, starts 2026-12-05, due 2026-12-08, milestone „Aufbau“',
    );

    // The person's own beyond the files: settings (only what is on the server), Sender, mail, agents.
    expect((await app('read_settings', {})).text).toMatch(
      /name: Owner[\s\S]*mail_check_minutes: 1[\s\S]*browser only/,
    );
    // An app reads them; changing is the person's own.
    expect(await app('change_settings', { mail_check_minutes: 15 })).toMatchObject({ error: true });
    expect((await app('read_settings', {})).text).toContain('mail_check_minutes: 1 ');
    expect((await app('read_settings', {})).text).toContain('meeting_notice_minutes: 5 (');
    expect((await app('list_conversations', {})).text).toContain('channel of the area „Vertrieb“');
    const channel = /^(\S+) channel of the area „Vertrieb“/m.exec(
      (await app('list_conversations', {})).text,
    )?.[1];
    const posted = /^Posted \((\S+)\)\.$/.exec(
      (await app('post_message', { conversation: channel, text: 'Hallo Vertrieb' })).text,
    )?.[1];
    expect(posted).toBeTruthy();
    expect((await app('read_conversation', { conversation: channel })).text).toContain(
      `[${posted}] `,
    );
    // An answer to it, as „Antworten“ does; a file that is none here is refused.
    await app('post_message', { conversation: channel, text: 'Gern', reply_to: posted });
    expect((await app('read_conversation', { conversation: channel })).text).toContain(
      `: (answering [${posted}]) Gern`,
    );
    expect(await app('post_message', { conversation: channel, files: ['nope'] })).toMatchObject({
      error: true,
    });
    const note = /\(file id (\S+)\)/.exec(
      (await app('write_file', { name: 'Plan.md', content: '# Plan', own: true })).text,
    )?.[1];
    await app('post_message', { conversation: channel, files: [note] });
    expect((await app('read_conversation', { conversation: channel })).text).toContain(
      ': [file „Plan.md“]',
    );
    // Planned for later: said so, nothing in the conversation yet.
    expect(
      (
        await app('post_message', {
          conversation: channel,
          text: 'Morgen früh',
          send_at: new Date(ctx.deps.clock.now().getTime() + 86_400_000).toISOString(),
        })
      ).text,
    ).toMatch(/^Planned for /);
    expect((await app('read_conversation', { conversation: channel })).text).not.toContain(
      'Morgen früh',
    );
    expect(await app('read_conversation', { conversation: 'nope' })).toMatchObject({ error: true });
    expect((await app('list_mailboxes', {})).error).toBe(false);
    expect((await app('list_agents', {})).error).toBe(false);
    expect(await app('read_agent', { agent: 'nope' })).toMatchObject({ error: true });

    // Deleted: gone for everyone; the data export carries one's own.
    await ok(send('DELETE', `/todos/${plan2.id}`), 204);
    expect((await send('GET', `/todos/${plan2.id}`)).status).toBe(404);
    const archive = await ctx.request('/api/me/export');
    const zip = await JSZip.loadAsync(await archive.arrayBuffer());
    const exported = JSON.parse((await zip.file('todos.json')?.async('string')) ?? '[]') as {
      title: string;
      own: boolean;
    }[];
    expect(
      exported
        .filter((one) => one.own)
        .map((one) => one.title)
        .sort(),
    ).toEqual(['Angebot Acme', 'Steuer machen']);
    expect(
      JSON.parse((await zip.file('meilensteine.json')?.async('string')) ?? '[]'),
    ).toMatchObject([{ name: 'Steuerjahr' }]);
    leave();
  });
});
