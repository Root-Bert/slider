import { Hono } from 'hono';
import { spellingWordInputSchema, type SpellingWord, type Viewer } from '@slider/shared';
import { requireOwner } from '../auth/access';
import { viewerMiddleware, type ViewerEnv } from '../auth/viewer';
import type { AppDeps } from '../deps';
import { badRequest } from '../http/errors';
import { readJson } from '../http/validate';
import {
  addUserWord,
  addWorkspaceWord,
  listUserWords,
  listWorkspaceWords,
  removeUserWord,
  removeWorkspaceWord,
} from '../services/spelling-words';

/** `?word=` of a DELETE – a word may hold anything a path would trip over. */
const wordParam = (word: string | undefined) => {
  if (!word) throw badRequest('Bitte das Wort angeben.');
  return word;
};

/**
 * The spell check's own words: the account's (`/me/words`, „Wörterbuch“) and a workspace's
 * (`/workspaces/:id/words`, „Wörter“ in its Bibliothek). Each answers with the whole list.
 */
export function spellingRoutes(deps: AppDeps) {
  const viewer = viewerMiddleware(deps);
  const userId = (v: Viewer) => {
    requireOwner(v);
    return v.author.id;
  };
  return new Hono<ViewerEnv>()
    .get('/me/words', viewer, async (c) =>
      c.json<SpellingWord[]>(await listUserWords(deps, userId(c.var.viewer))),
    )
    .post('/me/words', viewer, async (c) => {
      const { word } = await readJson(c, spellingWordInputSchema);
      return c.json<SpellingWord[]>(await addUserWord(deps, userId(c.var.viewer), word));
    })
    .delete('/me/words', viewer, async (c) =>
      c.json<SpellingWord[]>(
        await removeUserWord(deps, userId(c.var.viewer), wordParam(c.req.query('word'))),
      ),
    )
    .get('/workspaces/:id/words', viewer, async (c) =>
      c.json<SpellingWord[]>(
        await listWorkspaceWords(deps, userId(c.var.viewer), c.req.param('id')),
      ),
    )
    .post('/workspaces/:id/words', viewer, async (c) => {
      const { word } = await readJson(c, spellingWordInputSchema);
      return c.json<SpellingWord[]>(
        await addWorkspaceWord(deps, userId(c.var.viewer), c.req.param('id'), word),
      );
    })
    .delete('/workspaces/:id/words', viewer, async (c) =>
      c.json<SpellingWord[]>(
        await removeWorkspaceWord(
          deps,
          userId(c.var.viewer),
          c.req.param('id'),
          wordParam(c.req.query('word')),
        ),
      ),
    );
}
