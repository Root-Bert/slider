import { useMemo } from 'react';
import { readString, writeString } from '@/lib/storage';

/*
 * When one was last on Cloud's start, per person and workspace, in this browser – what „Seit
 * deinem letzten Besuch“ there counts from. A tab keeps the time it started from (a reload, a
 * way back to the page counts on from there); the next tab starts from this visit.
 */

const visitKey = (userId: string, workspaceId: string) =>
  `slider.cloudVisit.v1.${userId}.${workspaceId}`;

/** The last visit before this tab's (`null`: the first one here), the visit moved on to now. */
export function useLastVisit(userId: string, workspaceId: string): string | null {
  return useMemo(() => {
    const key = visitKey(userId, workspaceId);
    const kept = readString(key, 'session');
    const since = kept ?? readString(key) ?? '';
    if (kept === null) writeString(key, since, 'session');
    writeString(key, new Date().toISOString());
    return since || null;
  }, [userId, workspaceId]);
}
