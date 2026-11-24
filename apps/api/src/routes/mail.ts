import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import {
  mailAccountInputSchema,
  mailAccountPatchSchema,
  mailDraftSchema,
  mailFileSchema,
  mailOAuthStartSchema,
  mailReplySchema,
  mailSendSchema,
  mailRuleSchema,
  mailSpamSchema,
  mailUnsubscribeSchema,
  mailSyncSchema,
  MAX_MAIL_UPLOAD_BYTES,
  type AccountAuthor,
} from '@slider/shared';
import { requireOwner } from '../auth/access';
import { viewerMiddleware, type ViewerEnv } from '../auth/viewer';
import type { AppDeps } from '../deps';
import { aiLimits } from '../http/ai-limits';
import { ApiError, badRequest } from '../http/errors';
import { assertWithinLimit, fixedWindow } from '../http/rate-limit';
import { readJson } from '../http/validate';
import {
  addMailAccount,
  addMailboxToCalendars,
  addMailCalendars,
  deleteMailAccount,
  deleteMailThread,
  dropMailUpload,
  getMailThread,
  linkedMailAccounts,
  listMailAccounts,
  listMailThreads,
  mailAttachment,
  mailHtmlPage,
  mailImage,
  mailSyncOf,
  markMailSpam,
  ownThread,
  readMailThread,
  removeMailCalendars,
  unreadMailThread,
  replyMail,
  sendMailAgain,
  takeBackMail,
  sendNewMail,
  setMailSync,
  syncMailAccount,
  updateMailAccount,
  uploadMailFile,
} from '../services/mail';
import { askMailContext, fileMailAttachment } from '../services/mail-context';
import { addMailRule, deleteMailRule, listMailRules } from '../services/mail-rules';
import { workspaceAiConnection } from '../services/integration-keys';
import { draftMailReply } from '../services/mail-draft';
import { getMailInsights, summarizeMailThread } from '../services/mail-insights';
import { mailLogo } from '../services/mail-logos';
import { pinnedAtOf } from '../services/sender-pins';
import { MAIL_HTML_CSP } from '../services/mail-html';
import { forgetPreparedMailbox, preparedMailbox } from '../services/mail-agent';
import { mailOAuthResult, startMailOAuth } from '../services/mail-oauth';
import { cloudContext } from '../services/cloud/context';
import { mailAddressBook } from '../services/mail-addresses';
import { unsubscribeMailThread } from '../services/mail-unsubscribe';

/**
 * Mail in Sender (`services/mail.ts`): one's mailboxes in a workspace, the mail conversations,
 * answering and writing, an attachment's bytes, putting it into Cloud, what the AI makes of a
 * conversation. Account members only, each their own mailboxes alone.
 */
export function mailRoutes(deps: AppDeps) {
  const viewer = viewerMiddleware(deps);
  const me = (c: { var: ViewerEnv['Variables'] }) => {
    requireOwner(c.var.viewer);
    return (c.var.viewer.author as AccountAuthor).id;
  };
  // Each try reaches out to a server someone typed in: not without end.
  const tries = fixedWindow({ limit: 20, windowMs: 60 * 60 * 1000, clock: deps.clock });
  const tried = (c: Context, userId: string) =>
    assertWithinLimit(
      c,
      tries.hit(userId),
      'Zu viele Versuche mit Postfächern – versuch es in einer Stunde wieder.',
    );
  // Each mail goes out in the person's name from their mailbox: plenty for writing, not for a loop.
  const mails = fixedWindow({ limit: 60, windowMs: 60 * 60 * 1000, clock: deps.clock });
  const sending = (c: Context, userId: string) =>
    assertWithinLimit(c, mails.hit(userId), 'Zu viele Mails auf einmal. Bitte warte ein wenig.');
  // Files put on mails being written: plenty for a day's mail, not a store.
  const uploads = fixedWindow({ limit: 300, windowMs: 60 * 60 * 1000, clock: deps.clock });
  // Each firm's logo not kept yet is a lookup in DNS and on its site: a full list's worth an hour.
  const logoLookups = fixedWindow({ limit: 400, windowMs: 60 * 60 * 1000, clock: deps.clock });
  // Each picture from outside a mail is fetched by the server: dozens of newsletters an hour.
  const pictures = fixedWindow({ limit: 1500, windowMs: 60 * 60 * 1000, clock: deps.clock });
  // Leaving lists: each a request to a sender's server or a mail – a few rounds an hour.
  const leaving = fixedWindow({ limit: 30, windowMs: 60 * 60 * 1000, clock: deps.clock });
  // A new rule reads all one's conversations to place them.
  const rules = fixedWindow({ limit: 120, windowMs: 60 * 60 * 1000, clock: deps.clock });
  return (
    new Hono<ViewerEnv>()
      .get('/workspaces/:workspaceId/mail/accounts', viewer, async (c) =>
        c.json(await listMailAccounts(deps, me(c), c.req.param('workspaceId'))),
      )
      .post('/workspaces/:workspaceId/mail/accounts', viewer, async (c) => {
        const input = await readJson(c, mailAccountInputSchema);
        const userId = me(c);
        tried(c, userId);
        const workspaceId = c.req.param('workspaceId');
        const added = await addMailAccount(deps, userId, workspaceId, input);
        forgetPreparedMailbox(userId, workspaceId, added.address);
        return c.json(added, 201);
      })
      .get('/workspaces/:workspaceId/mail/prepared', viewer, async (c) => {
        // What an agent got ready for the form on „Neues Postfach“ – never a password.
        const userId = me(c);
        const workspaceId = c.req.param('workspaceId');
        await cloudContext(deps.db, workspaceId, userId);
        return c.json(preparedMailbox(deps, userId, workspaceId));
      })
      .post('/workspaces/:workspaceId/mail/oauth', viewer, async (c) => {
        // „Mit Microsoft/Google anmelden“: the provider's page to go to; back through the
        // login's callback (`services/mail-oauth`), then how it ended (below).
        const input = await readJson(c, mailOAuthStartSchema);
        const userId = me(c);
        tried(c, userId);
        const url = await startMailOAuth(deps, c, userId, c.req.param('workspaceId'), input);
        return c.json({ url });
      })
      .get('/mail/oauth/:id', viewer, (c) =>
        c.json(mailOAuthResult(deps, me(c), c.req.param('id'))),
      )
      .patch('/mail/accounts/:accountId', viewer, async (c) => {
        const input = await readJson(c, mailAccountPatchSchema);
        const userId = me(c);
        // Only what reaches a server counts as a try – not its names or the AI's reading.
        if (Object.keys(input).some((key) => !['label', 'name', 'aiReads'].includes(key)))
          tried(c, userId);
        return c.json(await updateMailAccount(deps, userId, c.req.param('accountId'), input));
      })
      // Its mailbox removed (its calendars, if on, stay – `deleteMailAccount`).
      .delete('/mail/accounts/:accountId', viewer, async (c) => {
        await deleteMailAccount(deps, me(c), c.req.param('accountId'));
        return c.body(null, 204);
      })
      // Its calendars removed or on again (`signIn`: the provider must be asked first).
      .delete('/mail/accounts/:accountId/calendars', viewer, async (c) => {
        await removeMailCalendars(deps, me(c), c.req.param('accountId'));
        return c.body(null, 204);
      })
      .post('/mail/accounts/:accountId/calendars', viewer, async (c) =>
        c.json(await addMailCalendars(deps, me(c), c.req.param('accountId'))),
      )
      // Calendars alone with a password become a mailbox again – tried on its servers.
      .post('/mail/accounts/:accountId/mailbox', viewer, async (c) => {
        const userId = me(c);
        tried(c, userId);
        return c.json(await addMailboxToCalendars(deps, userId, c.req.param('accountId')));
      })
      // One's accounts at mail providers in every workspace, what each is linked for (Konto).
      .get('/me/mail-accounts', viewer, async (c) => c.json(await linkedMailAccounts(deps, me(c))))
      // How often one's mailboxes are read from their servers (Einstellungen › Mail).
      .get('/mail/sync', viewer, async (c) => c.json(await mailSyncOf(deps, me(c))))
      .put('/mail/sync', viewer, async (c) => {
        const { minutes } = await readJson(c, mailSyncSchema);
        return c.json(await setMailSync(deps, me(c), minutes));
      })
      .post('/mail/accounts/:accountId/sync', viewer, async (c) => {
        const userId = me(c);
        const accounts = await listMailAccounts(deps, userId, c.req.query('workspaceId') ?? '');
        const accountId = c.req.param('accountId');
        if (accounts.some((one) => one.id === accountId)) await syncMailAccount(deps, accountId);
        return c.body(null, 204);
      })
      // Whom one wrote with – offered as an address is typed (`mail-addresses.ts`).
      .get('/workspaces/:workspaceId/mail/addresses', viewer, async (c) =>
        c.json(await mailAddressBook(deps, me(c), c.req.param('workspaceId'))),
      )
      .get('/workspaces/:workspaceId/mail/threads', viewer, async (c) => {
        const userId = me(c);
        // `?q=`: those that hold the words, in any folder – Post's search and the side bar's.
        const query = (c.req.query('q') ?? '').trim().slice(0, 200);
        if (query) {
          const searched = aiLimits(deps).mailSearches.hit(userId);
          if (!searched.allowed) {
            c.header('Retry-After', String(searched.retryAfterS));
            throw new ApiError(
              429,
              'rate_limited',
              'Zu viele Suchen auf einmal – gleich noch einmal.',
            );
          }
        }
        const threads = await listMailThreads(deps, userId, c.req.param('workspaceId'), {
          // One mailbox's, one folder's (`?account=<id>&folder=<key>`); else the side bar's.
          accountId: c.req.query('account') || undefined,
          folder: c.req.query('folder') || undefined,
          query,
          // `&in=all`: what the mails say too, as Cloud's search in what files say.
          inText: c.req.query('in') === 'all',
        });
        // Pinned ones (`sender-pins.ts`) stand atop the list – the client puts them there.
        const pins = await pinnedAtOf(
          deps.db,
          userId,
          'mail',
          threads.map((thread) => thread.id),
        );
        return c.json(
          threads.map((thread) => ({ ...thread, pinnedAt: pins.get(thread.id) ?? null })),
        );
      })
      .get('/workspaces/:workspaceId/mail/logos/:domain', viewer, async (c) => {
        // A firm's picture by its domain alone (`services/mail-logos`): a PNG drawn here, or nothing.
        const userId = me(c);
        const logo = await mailLogo(
          deps,
          userId,
          c.req.param('workspaceId'),
          c.req.param('domain'),
          () => logoLookups.hit(userId).allowed,
        );
        c.header('Cache-Control', `private, max-age=${logo ? 86_400 : 3_600}`);
        if (!logo) return c.body(null, 204);
        c.header('Content-Type', 'image/png');
        c.header('Content-Security-Policy', "sandbox; default-src 'none'");
        c.header('X-Content-Type-Options', 'nosniff');
        return c.body(new Uint8Array(logo));
      })
      .post('/workspaces/:workspaceId/mail/send', viewer, async (c) => {
        const userId = me(c);
        sending(c, userId);
        const input = await readJson(c, mailSendSchema);
        return c.json(await sendNewMail(deps, userId, c.req.param('workspaceId'), input), 201);
      })
      /** A file put on a mail being written from this mailbox (multipart, field `file`). */
      .post(
        '/mail/accounts/:accountId/uploads',
        viewer,
        (c, next) => {
          assertWithinLimit(
            c,
            uploads.hit(me(c)),
            'Zu viele Anhänge auf einmal. Bitte warte ein wenig.',
          );
          return next();
        },
        bodyLimit({
          // The file and the form around it.
          maxSize: MAX_MAIL_UPLOAD_BYTES + 64 * 1024,
          onError: (c) =>
            c.json(
              new ApiError(
                413,
                'file_too_large',
                'Diese Datei ist zu groß – höchstens 20 MB je Datei.',
              ).toBody(),
              413,
            ),
        }),
        async (c) => {
          const file = (await c.req.parseBody().catch(() => ({}) as Record<string, unknown>))[
            'file'
          ];
          if (!(file instanceof File))
            throw badRequest('Bitte die Datei im Feld „file“ mitsenden.');
          return c.json(
            await uploadMailFile(deps, me(c), c.req.param('accountId'), {
              name: file.name,
              type: file.type,
              bytes: new Uint8Array(await file.arrayBuffer()),
            }),
            201,
          );
        },
      )
      .delete('/mail/uploads/:uploadId', viewer, async (c) => {
        await dropMailUpload(deps, me(c), c.req.param('uploadId'));
        return c.body(null, 204);
      })
      .get('/mail/threads/:threadId', viewer, async (c) => {
        const userId = me(c);
        const thread = await getMailThread(deps, userId, c.req.param('threadId'));
        // Pinned or not, for its menu (as its row in the list); the AI there to write a reply.
        const [pins, { account }] = await Promise.all([
          pinnedAtOf(deps.db, userId, 'mail', [thread.id]),
          ownThread(deps, userId, thread.id),
        ]);
        const { connection } = await workspaceAiConnection(deps, account.workspaceId);
        return c.json({ ...thread, pinnedAt: pins.get(thread.id) ?? null, ai: !!connection });
      })
      .post('/mail/threads/:threadId/read', viewer, async (c) => {
        await readMailThread(deps, me(c), c.req.param('threadId'));
        return c.body(null, 204);
      })
      .post('/mail/threads/:threadId/unread', viewer, async (c) => {
        await unreadMailThread(deps, me(c), c.req.param('threadId'));
        return c.body(null, 204);
      })
      /** „Abbestellen“, many at once: each list left by one click or its mail, else its page. */
      .post('/workspaces/:workspaceId/mail/unsubscribe', viewer, async (c) => {
        const { threadIds } = await readJson(c, mailUnsubscribeSchema);
        const userId = me(c);
        assertWithinLimit(
          c,
          leaving.hit(userId),
          'Zu viele Abmeldungen auf einmal. Bitte warte ein wenig.',
        );
        const results = [];
        for (const threadId of threadIds)
          results.push(
            await unsubscribeMailThread(deps, userId, c.req.param('workspaceId'), threadId),
          );
        return c.json(results);
      })
      .post('/mail/threads/:threadId/spam', viewer, async (c) => {
        const input = await readJson(c, mailSpamSchema);
        await markMailSpam(deps, me(c), c.req.param('threadId'), input.spam);
        return c.body(null, 204);
      })
      .get('/workspaces/:workspaceId/mail/rules', viewer, async (c) =>
        c.json(await listMailRules(deps, me(c), c.req.param('workspaceId'))),
      )
      .post('/mail/threads/:threadId/rule', viewer, async (c) => {
        const input = await readJson(c, mailRuleSchema);
        assertWithinLimit(
          c,
          rules.hit(me(c)),
          'Zu viele Regeln auf einmal. Bitte warte ein wenig.',
        );
        return c.json(await addMailRule(deps, me(c), c.req.param('threadId'), input), 201);
      })
      .delete('/mail/rules/:ruleId', viewer, async (c) => {
        await deleteMailRule(deps, me(c), c.req.param('ruleId'));
        return c.body(null, 204);
      })
      .delete('/mail/threads/:threadId', viewer, async (c) => {
        await deleteMailThread(deps, me(c), c.req.param('threadId'));
        return c.body(null, 204);
      })
      .post('/mail/threads/:threadId/reply', viewer, async (c) => {
        const userId = me(c);
        sending(c, userId);
        const input = await readJson(c, mailReplySchema);
        return c.json(await replyMail(deps, userId, c.req.param('threadId'), input), 201);
      })
      // The outbox: a mail taken back before it goes (its words come back), or sent again.
      .delete('/mail/threads/:threadId/messages/:messageId/outbox', viewer, async (c) =>
        c.json(await takeBackMail(deps, me(c), c.req.param('threadId'), c.req.param('messageId'))),
      )
      .post('/mail/threads/:threadId/messages/:messageId/outbox/retry', viewer, async (c) => {
        const userId = me(c);
        sending(c, userId);
        await sendMailAgain(deps, userId, c.req.param('threadId'), c.req.param('messageId'));
        return c.body(null, 204);
      })
      .post('/mail/threads/:threadId/draft', viewer, async (c) => {
        const userId = me(c);
        const { notes } = await readJson(c, mailDraftSchema);
        return c.json(
          await draftMailReply(deps, userId, c.req.param('threadId'), notes, () =>
            assertWithinLimit(
              c,
              aiLimits(deps).aiRequests.hit(userId),
              'Zu viele KI-Aufträge auf einmal. Bitte warte einen Moment.',
            ),
          ),
        );
      })
      .post('/mail/threads/:threadId/context', viewer, async (c) => {
        const userId = me(c);
        // A run on the workspace's AI key: within the person's budget for AI requests.
        assertWithinLimit(
          c,
          aiLimits(deps).aiRequests.hit(userId),
          'Zu viele KI-Aufträge auf einmal. Bitte warte einen Moment.',
        );
        await getMailThread(deps, userId, c.req.param('threadId'));
        askMailContext(deps, c.req.param('threadId'));
        return c.body(null, 202);
      })
      .get('/mail/threads/:threadId/insights', viewer, async (c) => {
        const userId = me(c);
        // Cloud's search for files that fit, a few words at a time: within the person's search budget.
        assertWithinLimit(
          c,
          aiLimits(deps).fileSearches.hit(userId),
          'Zu viele Suchen auf einmal. Bitte warte einen Moment.',
        );
        return c.json(await getMailInsights(deps, userId, c.req.param('threadId')));
      })
      .post('/mail/threads/:threadId/insights/summary', viewer, async (c) => {
        const userId = me(c);
        // The model is asked only for a mail not summed up yet (or `?neu=1`: again): then within
        // the AI budget.
        return c.json(
          await summarizeMailThread(
            deps,
            userId,
            c.req.param('threadId'),
            () =>
              assertWithinLimit(
                c,
                aiLimits(deps).aiRequests.hit(userId),
                'Zu viele KI-Aufträge auf einmal. Bitte warte einen Moment.',
              ),
            c.req.query('neu') === '1',
          ),
        );
      })
      .post('/mail/threads/:threadId/file', viewer, async (c) => {
        const input = await readJson(c, mailFileSchema);
        return c.json(await fileMailAttachment(deps, me(c), c.req.param('threadId'), input), 201);
      })
      .get('/mail/threads/:threadId/messages/:messageId/html', viewer, async (c) => {
        // A mail as it looks: the page of a sandboxed frame (`services/mail-html`), pictures from
        // outside only with `?bilder=1`.
        const page = await mailHtmlPage(
          deps,
          me(c),
          c.req.param('threadId'),
          c.req.param('messageId'),
          c.req.query('bilder') === '1',
        );
        c.header('Content-Type', 'text/html; charset=utf-8');
        c.header('Content-Security-Policy', MAIL_HTML_CSP);
        c.header('X-Content-Type-Options', 'nosniff');
        c.header('Referrer-Policy', 'no-referrer');
        c.header('Cache-Control', 'private, max-age=300');
        return c.body(page);
      })
      .get('/mail/threads/:threadId/messages/:messageId/image', viewer, async (c) => {
        // A picture from outside the mail names, fetched by the server: the sender never sees who;
        // only with the key of the page asked for with its pictures (`?bilder=1`).
        const userId = me(c);
        assertWithinLimit(
          c,
          pictures.hit(userId),
          'Zu viele Bilder auf einmal. Bitte warte einen Moment.',
        );
        const picture = await mailImage(
          deps,
          userId,
          c.req.param('threadId'),
          c.req.param('messageId'),
          c.req.query('src') ?? '',
          c.req.query('k') ?? '',
        );
        if (!picture) return c.body(null, 404);
        c.header('Content-Type', picture.type);
        c.header('Content-Security-Policy', "sandbox; default-src 'none'");
        c.header('X-Content-Type-Options', 'nosniff');
        c.header('Cache-Control', 'private, max-age=86400');
        return c.body(new Uint8Array(picture.bytes));
      })
      .get('/mail/threads/:threadId/attachments/:attachmentId', viewer, async (c) => {
        const found = await mailAttachment(
          deps,
          me(c),
          c.req.param('threadId'),
          c.req.param('attachmentId'),
        );
        c.header('Content-Type', found.type);
        c.header(
          'Content-Disposition',
          `${c.req.query('download') ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(found.name)}`,
        );
        c.header('Content-Security-Policy', "sandbox; default-src 'none'");
        c.header('X-Content-Type-Options', 'nosniff');
        return c.body(found.bytes);
      })
  );
}
