import { aiAuthor, type DocumentVoiceInfo } from '@slider/shared';
import { useQuery } from '@tanstack/react-query';
import { Suspense, useMemo } from 'react';
import {
  BoardOwnerContext,
  DOCUMENT_WORDING,
  MaterialPage,
  type BoardOwner,
} from '@/features/viewer';
import { voiceApi } from '@/lib/api';
import { useWriter } from './session';

/**
 * „Material“ of the document: a presentation's board page, beside the text – files, links, notes,
 * questions to the AI and its chat, kept with the document. The page lies left of the document
 * and slides in while that moves out (`Editor`); here the document tells the board what it asks
 * of its host: who may do what, the AI by its name, the document's toast.
 */
export function DocumentMaterial({
  open,
  onOpen,
  panelOpen,
  onPanelOpen,
}: {
  open: boolean;
  onOpen: (open: boolean) => void;
  panelOpen: boolean;
  onPanelOpen: (open: boolean) => void;
}) {
  const { document: file, me, notify } = useWriter();
  const { canComment, canManage } = file.permissions;
  // The workspace's AI by its name, as the comments and the microphone have it.
  const info = useQuery<DocumentVoiceInfo>({
    queryKey: ['document-voice', file.id],
    queryFn: () => voiceApi.document.info(file.id),
    enabled: canComment,
    staleTime: 60_000,
  });
  const name = info.data?.name;
  const owner = useMemo<BoardOwner>(
    () => ({
      kind: 'document',
      id: file.id,
      canComment,
      canManage,
      viewer: me,
      aiAuthor: aiAuthor(name),
      toast: notify,
      open,
      setOpen: onOpen,
      panelOpen,
      setPanelOpen: onPanelOpen,
      wording: DOCUMENT_WORDING,
    }),
    [file.id, canComment, canManage, me, name, notify, open, onOpen, panelOpen, onPanelOpen],
  );
  return (
    <BoardOwnerContext value={owner}>
      {/* Its code comes after the document's: the page is there before it is first asked for. */}
      <Suspense fallback={null}>
        <MaterialPage />
      </Suspense>
    </BoardOwnerContext>
  );
}
