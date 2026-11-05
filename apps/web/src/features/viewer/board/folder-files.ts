/*
 * A folder put on the board (Folie 0): its files, found in a drop (`DataTransferItem` entries) or
 * picked („Ordner hinzufügen“, `webkitdirectory`), every one inside it, its subfolders' too – none
 * hidden or of the system's own (`.DS_Store`, `Thumbs.db`, `__MACOSX`).
 */

/** A folder's card on the board. */
export const FOLDER_CARD = { w: 240, h: 200 } as const;

/** Files of one folder sent at once. */
export const FOLDER_PARALLEL = 3;

const SYSTEM = new Set(['thumbs.db', 'desktop.ini', 'icon\r']);

/** Hidden or the system's own: never put on the board. */
export function isHiddenFile(path: string): boolean {
  return path
    .split('/')
    .some((part) => part.startsWith('.') || part === '__MACOSX' || SYSTEM.has(part.toLowerCase()));
}

/** Picked with `webkitdirectory`: the folder's name (the first part of each path) and its files. */
export function pickedFolder(files: readonly File[]): { name: string; files: File[] } | null {
  const first = files[0]?.webkitRelativePath.split('/')[0];
  if (!first) return null;
  return {
    name: first,
    files: files.filter((file) => !isHiddenFile(file.webkitRelativePath || file.name)),
  };
}

const readAll = (reader: FileSystemDirectoryReader) =>
  new Promise<FileSystemEntry[]>((resolve, reject) => {
    const all: FileSystemEntry[] = [];
    // A reader gives its entries in batches, an empty one at the end.
    const next = () =>
      reader.readEntries((batch) => {
        if (batch.length === 0) resolve(all);
        else {
          all.push(...batch);
          next();
        }
      }, reject);
    next();
  });

async function filesIn(entry: FileSystemEntry): Promise<File[]> {
  if (isHiddenFile(entry.name)) return [];
  if (entry.isFile)
    return [
      await new Promise<File>((resolve, reject) =>
        (entry as FileSystemFileEntry).file(resolve, reject),
      ),
    ];
  const children = await readAll((entry as FileSystemDirectoryEntry).createReader());
  return (await Promise.all(children.map(filesIn))).flat();
}

/**
 * What a drop holds: its folders (each with every file inside) and its loose files. Read before
 * the drop's data goes (the entries are taken at once).
 */
export async function droppedItems(
  data: DataTransfer,
): Promise<{ folders: { name: string; files: File[] }[]; files: File[] }> {
  const entries = [...data.items]
    .filter((item) => item.kind === 'file')
    .map((item) => item.webkitGetAsEntry?.() ?? null);
  const loose = [...data.files];
  if (!entries.some((entry) => entry?.isDirectory)) return { folders: [], files: loose };
  const folders: { name: string; files: File[] }[] = [];
  const files: File[] = [];
  for (const entry of entries) {
    if (!entry) continue;
    if (entry.isDirectory) folders.push({ name: entry.name, files: await filesIn(entry) });
    else files.push(...(await filesIn(entry)));
  }
  return { folders, files };
}

/** Runs `job` on every item, at most `limit` at once; one failing does not stop the others. */
export async function eachLimited<T>(
  items: readonly T[],
  limit: number,
  job: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++]!;
      await job(item).catch(() => undefined);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
