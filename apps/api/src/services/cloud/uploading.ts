/**
 * Files on their way up right now – in memory only, so who watches a place (an agent) can say
 * „… wird hochgeladen“ before the file is there. A file sent whole is known from its first
 * byte to its last (`storeUpload`), one sent in parts with every part (`cloud-tus.ts`).
 */
export interface Uploading {
  workspaceId: string;
  name: string;
  /** Where it goes, as the upload says it: a folder, an area's top, or a file's next version. */
  parentId?: string | undefined;
  areaId?: string | undefined;
  nodeId?: string | undefined;
}

/** An upload in parts that brought nothing for this long is not on its way any more. */
const STALE_MS = 2 * 60_000;

const uploading = new Map<string, Uploading & { at: number }>();

/** An upload is on its way (said again with every part: it stays known). */
export function uploadComes(id: string, upload: Uploading, now: number): void {
  uploading.set(id, { ...upload, at: now });
}

/** It is there, or given up. */
export function uploadEnded(id: string): void {
  uploading.delete(id);
}

/** What is on its way into a workspace right now. */
export function uploadsInto(workspaceId: string, now: number): Uploading[] {
  const found: Uploading[] = [];
  for (const [id, each] of uploading) {
    if (now - each.at > STALE_MS) uploading.delete(id);
    else if (each.workspaceId === workspaceId) found.push(each);
  }
  return found;
}
