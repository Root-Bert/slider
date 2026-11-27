import { API_PREFIX, type CloudNode, type CloudUploadResult } from '@slider/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { cloudKeys } from '@/lib/api';
import { accountHeader, apiErrorFromText, unreachableError } from '@/lib/api-client';

/*
 * Pages: Markdown files read as Notion pages (`features/pages`). They are files like any other –
 * they lie in folders and areas, are shared, moved and deleted as files are. Each place has its
 * Startseite, the page „Startseite“ where its pages lie: an area's at its top, one's own in „Meine
 * Dateien“'s folder „Notizen“. Pages made from a page lie beside it.
 */

export const isPageName = (name: string) => /\.(md|markdown)$/i.test(name);

/** A page's title: its file's name without the ending. */
export const pageTitle = (name: string) => name.replace(/\.(md|markdown)$/i, '');

/** The file an area's Startseite is. */
export const HOME_PAGE_NAME = 'Startseite.md';
/** The folder in „Meine Dateien“ one's own pages lie in (its name from before „Seiten“). */
export const NOTES_FOLDER = 'Notizen';
/** `?neu` on a page's address: just made, it opens to be written in. */
export const NEW_PAGE_PARAM = 'neu';

/** What an area's new Startseite says before anyone wrote on it: what lives in it, as it is now. */
export const HOME_TEMPLATE = [
  '{{unterseiten}}',
  '',
  '## Aufgaben',
  '',
  '{{aufgaben}}',
  '',
  '## Dateien',
  '',
  '{{dateien}}',
  '',
  '## Personen',
  '',
  '{{personen}}',
  '',
].join('\n');

/** One's own new Startseite: its pages, what is to do and coming, the files beside. */
export const OWN_TEMPLATE = [
  '{{unterseiten}}',
  '',
  '## Aufgaben',
  '',
  '{{aufgaben}}',
  '',
  '## Termine',
  '',
  '{{termine}}',
  '',
  '## Dateien',
  '',
  '{{dateien}}',
  '',
].join('\n');

/**
 * A new page, its Markdown sent as a file: beside the others of its name (`keepBoth`: „Neue Seite
 * 2.md“), in a folder, at an area's top or in one's own files – `path` makes folders on the way.
 */
export interface NewPage {
  title: string;
  parentId?: string | null;
  areaId?: string | null;
  path?: string;
  markdown?: string;
  /**
   * Only as a new file: one of that name there already is refused (409, nothing stored) instead
   * of a „… 2.md“ beside it – an area's Startseite is one file.
   */
  onlyNew?: boolean;
}

export async function createPage(workspaceId: string, input: NewPage): Promise<CloudNode> {
  const params = new URLSearchParams({ name: `${input.title.trim() || 'Neue Seite'}.md` });
  if (input.onlyNew) params.set('ifVersion', 'none');
  else params.set('keepBoth', '1');
  if (input.parentId) params.set('parentId', input.parentId);
  if (input.areaId) params.set('areaId', input.areaId);
  if (input.path) params.set('path', input.path);
  let response: Response;
  try {
    response = await fetch(
      `${API_PREFIX}/workspaces/${encodeURIComponent(workspaceId)}/cloud/files?${params}`,
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          ...accountHeader(),
          Accept: 'application/json',
          'Content-Type': 'text/markdown; charset=utf-8',
        },
        body: input.markdown ?? '',
      },
    );
  } catch {
    throw unreachableError();
  }
  const text = await response.text();
  if (!response.ok) throw apiErrorFromText(response.status, text);
  return (JSON.parse(text) as CloudUploadResult).node;
}

/** `createPage`, and Cloud's lists know it at once (a new „Notizen“ folder too). */
export function useCreatePage(workspaceId: string) {
  const queryClient = useQueryClient();
  return useCallback(
    async (input: NewPage) => {
      const node = await createPage(workspaceId, input);
      void queryClient.invalidateQueries({ queryKey: cloudKeys.all(workspaceId) });
      return node;
    },
    [workspaceId, queryClient],
  );
}
