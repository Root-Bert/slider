import { useEffect } from 'react';
import { useSearchParams } from 'react-router';
import type { DeckFolder } from '@slider/shared';

/** The open folder lives in the URL, so back/forward and links work. */
const FOLDER_PARAM = 'ordner';

/**
 * The folder named by `?ordner=` – opening and closing one adds a history entry. A folder that
 * doesn't exist (deleted elsewhere, or a stale link) drops back to the top level once the folders
 * have loaded, replacing that entry: pushing would bring Back straight back here, again and again.
 */
export function useOpenFolder(folders: readonly DeckFolder[], loaded: boolean) {
  const [searchParams, setSearchParams] = useSearchParams();
  const folderId = searchParams.get(FOLDER_PARAM);
  const openFolder = folderId ? folders.find((folder) => folder.id === folderId) : undefined;
  const openFolderById = (id: string | null, options?: { replace?: boolean }) =>
    setSearchParams((params) => {
      const next = new URLSearchParams(params);
      if (id) next.set(FOLDER_PARAM, id);
      else next.delete(FOLDER_PARAM);
      return next;
    }, options);

  const stale = Boolean(folderId) && loaded && !openFolder;
  useEffect(() => {
    if (stale) openFolderById(null, { replace: true });
  });

  return { openFolder, openFolderById };
}
