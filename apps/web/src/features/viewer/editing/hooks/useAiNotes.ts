import type { SlideOperation } from '@slider/shared';
import { useWriteNotes } from '@/lib/api';
import { pluralize } from '@/lib/format';
import { OFFLINE_HINT } from '@/lib/offline';
import { useViewerData } from '../../state/viewer-data';
import { useViewerToast } from '../../state/viewer-toast';
import { notesFromText } from '../../timeline/lib/notes-html';
import { useEditing } from '../editing-context';

/**
 * The workspace's AI writes speaker notes, put in as one step (⌘Z takes them back): without
 * `pageId` for every slide that has none (one typed into meanwhile keeps its own), with it for
 * that slide, replacing what it has.
 */
export function useAiNotes() {
  const { deck } = useViewerData();
  const editing = useEditing();
  const toast = useViewerToast();
  const write = useWriteNotes(deck.id);
  const { state, offline } = editing;

  const reason = offline
    ? `Die KI ist offline nicht da. ${OFFLINE_HINT}`
    : !state?.aiAvailable
      ? (state?.aiReason ?? 'Im Workspace ist keine KI eingerichtet.')
      : null;

  const run = (pageId?: string) => {
    write.mutate(pageId ? { pageIds: [pageId] } : {}, {
      onSuccess: ({ notes }) => {
        const current = new Map(
          (editing.state?.slides ?? []).map((slide) => [slide.pageId, slide.notes]),
        );
        const operations: SlideOperation[] = notes
          .filter((item) => (pageId ? item.pageId === pageId : !current.get(item.pageId)?.trim()))
          .map((item) => ({
            type: 'setSlideNotes',
            pageId: item.pageId,
            text: item.text,
            paragraphs: notesFromText(item.text),
          }));
        if (operations.length === 0) {
          toast('Alle Folien haben schon Notizen.');
          return;
        }
        void editing.apply(operations).then((done) => {
          if (done && !pageId)
            toast(`Notizen für ${pluralize(operations.length, 'Folie', 'Folien')} geschrieben.`);
        });
      },
      onError: (error) => toast(error.message, 'danger'),
    });
  };

  return { run, reason, pending: write.isPending };
}
