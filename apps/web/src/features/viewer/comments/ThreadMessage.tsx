import { MAX_COMMENT_BODY_LENGTH, type Comment } from '@slider/shared';
import { useState } from 'react';
import { isPendingComment } from '@/lib/api/comment-outbox';
import { useUpdateComment } from '@/lib/api';
import { AutosizeTextarea, Button, cn, ErrorText, IconButton, Menu } from '@/ui';
import { isRemovedInSource } from './lib/comment-selectors';
import { AskAiButton } from './AskAiButton';
import { AuthorLine } from './AuthorLine';
import { CommentContent } from './CommentContent';
import { useViewerDispatch, useViewerState } from '../state/viewer-state';
import { RemovedInSourceNote } from './RevisionNotes';
import { useCommentMenu } from './hooks/useCommentMenu';
import { ReactionChips, ReactionPicker } from './Reactions';
import { useViewerData } from '../state/viewer-data';
import { useHoldUnsavedWork } from '../lib/unsaved-work';
import { useSetCommentRecording } from '../media/hooks/useMediaComment';
import type { Recording } from '../media/hooks/useRecorder';
import { RecorderPanel } from '../media/RecorderPanel';

interface ThreadMessageProps {
  comment: Comment;
  deckId: string;
  isRoot: boolean;
  onDeleted?: () => void;
}

/**
 * One message in the thread panel (B4): the root spans the panel in the thread's accent
 * (`--card-accent`), replies hug their content. Actions sit in a ⋯ menu and on right click.
 */
export function ThreadMessage({ comment, deckId, isRoot, onDeleted }: ThreadMessageProps) {
  const [editingHere, setEditingHere] = useState(false);
  const { editingCommentId } = useViewerState();
  const dispatch = useViewerDispatch();
  const { canComment } = useViewerData();
  // "Bearbeiten" from a card's context menu opens the panel with this comment's editor.
  const requested = editingCommentId === comment.id;
  const editing = editingHere || requested;
  const stopEditing = () => {
    setEditingHere(false);
    if (requested) dispatch({ type: 'commentEditEnded' });
  };
  const menu = useCommentMenu({
    comment,
    deckId,
    isRoot,
    onEdit: () => setEditingHere(true),
    onDeleted,
  });
  // Not saved yet: shown dimmed and without actions until the server confirms it.
  const pending = isPendingComment(comment);
  const removed = isRemovedInSource(comment);

  return (
    <article
      aria-busy={pending || undefined}
      onContextMenu={editing ? undefined : menu.onContextMenu}
      className={cn(
        'group/message relative flex flex-col gap-2 rounded-panel px-3.5 py-3 transition-opacity',
        isRoot
          ? 'bg-surface-1 shadow-[inset_0_0_0_1px_var(--card-accent),0_0_20px_-4px_color-mix(in_srgb,var(--card-accent)_50%,transparent)]'
          : cn('glass max-w-80', editing ? 'w-full' : 'w-fit min-w-48'),
        pending && 'opacity-60',
      )}
    >
      <AuthorLine
        comment={comment}
        trailing={
          !editing && (
            <span className="flex items-center">
              {canComment && <AskAiButton comment={comment} deckId={deckId} />}
              {menu.actions.length > 0 && (
                <Menu
                  label="Aktionen für diesen Kommentar"
                  triggerSize="compact"
                  actions={menu.actions}
                />
              )}
            </span>
          )
        }
        afterTime={!editing && <ReactionPicker comment={comment} floating />}
        className="-my-1"
      />

      {removed && <RemovedInSourceNote source={comment.source} />}
      {editing ? (
        <EditForm comment={comment} deckId={deckId} onDone={stopEditing} />
      ) : (
        <>
          <CommentContent
            comment={comment}
            bodyClassName={cn(
              'text-fg',
              removed && 'text-fg-subtle line-through decoration-fg-faint',
            )}
          />
          <ReactionChips comment={comment} />
        </>
      )}

      {menu.menus}
    </article>
  );
}

function EditForm({
  comment,
  deckId,
  onDone,
}: {
  comment: Comment;
  deckId: string;
  onDone: () => void;
}) {
  const [body, setBody] = useState(comment.body);
  const update = useUpdateComment(deckId);
  // Voice mode as in the composer: the mic beside the field records a new voice comment, the text
  // becomes its note. It replaces the comment's recording once saved.
  const [voice, setVoice] = useState(false);
  const [recording, setRecording] = useState<Recording | null>(null);
  const [recordingRunning, setRecordingRunning] = useState(false);
  const setVoiceRecording = useSetCommentRecording(deckId);
  const pending = update.isPending || setVoiceRecording.isPending;
  const error = update.error ?? setVoiceRecording.error;
  useHoldUnsavedWork(voice && (recording !== null || recordingRunning));
  // A recording or image is content of its own: its note may go empty, plain text may not.
  const canSave = voice
    ? recording !== null && !recordingRunning
    : body.trim() !== '' || comment.media != null || !!comment.images?.length;
  const save = () => {
    // ↵ twice while saving must not send it twice.
    if (!canSave || pending) return;
    if (voice && recording)
      setVoiceRecording.mutate(
        { commentId: comment.id, body: body.trim(), recording },
        { onSuccess: onDone },
      );
    else update.mutate({ commentId: comment.id, body: body.trim() }, { onSuccess: onDone });
  };
  const toggleVoice = () => {
    setVoice((on) => !on);
    setRecording(null);
    setRecordingRunning(false);
  };
  const uploading = setVoiceRecording.isPending && setVoiceRecording.progress < 1;

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
      onKeyDown={(event) => {
        // Esc leaves the editor from the recorder, too; unmounting stops it and aborts an upload.
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        onDone();
      }}
    >
      {voice && (
        <RecorderPanel
          kind="audio"
          deckId={deckId}
          onChange={setRecording}
          onRecordingChange={setRecordingRunning}
          autoStart
          autoFocus
          onDiscard={toggleVoice}
        />
      )}
      <div className="flex items-end gap-2">
        <div className="field-well focus-field min-w-0 flex-1 rounded-control-sm px-3 py-2">
          <AutosizeTextarea
            autoFocus
            aria-label="Kommentar bearbeiten"
            maxLength={MAX_COMMENT_BODY_LENGTH}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            onKeyDown={(event) => {
              // ↵ (and ⌘↵) saves, ⇧↵ is a new line – as in the composer.
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                save();
              }
            }}
            className="text-body leading-5 text-fg"
          />
        </div>
        {/* As in the composer: the mic opens the recorder, whose bin drops the take again. */}
        {!voice && (
          <IconButton
            icon="mic"
            label="Sprachkommentar aufnehmen"
            title="Sprachmemo aufnehmen"
            variant="primary"
            size="sm"
            disabled={pending}
            onClick={toggleVoice}
            className="mb-0.5"
          />
        )}
      </div>
      {voice && comment.media && (
        <p className="text-caption text-fg-subtle">Ersetzt die bisherige Aufnahme.</p>
      )}
      {error && (
        <ErrorText role="alert" size="xs">
          {error.message}
        </ErrorText>
      )}
      <div className="flex justify-end gap-1">
        <Button variant="ghost" size="sm" onClick={onDone}>
          Abbrechen
        </Button>
        <Button type="submit" size="sm" disabled={!canSave} loading={pending}>
          {uploading && setVoiceRecording.progress > 0
            ? `${Math.round(setVoiceRecording.progress * 100)} %`
            : 'Speichern'}
        </Button>
      </div>
    </form>
  );
}
