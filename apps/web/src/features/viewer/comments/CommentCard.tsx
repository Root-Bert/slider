import { MAX_COMMENT_BODY_LENGTH, type Comment } from '@slider/shared';
import {
  Fragment,
  memo,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { accentColor } from '@/lib/accent';
import { isPendingComment } from '@/lib/api/comment-outbox';
import { pluralize } from '@/lib/format';
import {
  AutosizeTextarea,
  AvatarStack,
  Button,
  cn,
  IconButton,
  ToolbarDivider,
  selectedOutlineClass,
} from '@/ui';
import { isRemovedInSource, type Thread } from './lib/comment-selectors';
import { MediaReplyButtons } from './MediaTabs';
import { VoiceMemoBar } from '../media/VoiceMemoBar';
import { useKeepThreadListed } from './hooks/useKeepThreadListed';
import { useMentions } from './hooks/useMentions';
import { useReplyDraft } from './hooks/useReplyDraft';
import { MentionMenu } from './MentionMenu';
import { LiveThreadMarker } from '../live/LiveThreadMarker';
import { useViewerData } from '../state/viewer-data';
import { useViewerDispatch } from '../state/viewer-state';
import { AuthorLine } from './AuthorLine';
import { CommentContent } from './CommentContent';
import { AskAiButton } from './AskAiButton';
import { ResolveButton } from './ResolveButton';
import { RemovedInSourceNote } from './RevisionNotes';
import { useCommentMenu } from './hooks/useCommentMenu';
import { useCommentSelection } from './comment-selection';
import { useCommentProposals } from './hooks/useCommentProposals';
import { AiProposalCard } from './AiProposalCard';
import { ThreadSummary } from './ThreadSummary';
import { ReactionChips, ReactionPicker } from './Reactions';

export type CardEmphasis = 'normal' | 'focused' | 'hovered' | 'dimmed';

interface CommentCardProps {
  thread: Thread;
  deckId: string;
  emphasis: CardEmphasis;
  /** Resolving and replying need comment rights (BER-102). */
  canResolve: boolean;
  /** Extra context line, e.g. "Zwischen Folie 2 und 3". */
  location?: string | undefined;
  /** A done thread steps back – not while only done ones are shown. */
  fadeDone: boolean;
}

/**
 * Glass card for one thread (B1) that expands inline into the whole thread with a reply box
 * (B3). The root opens the thread panel; nested controls sit above the invisible full-size
 * button ("stretched button"), so there is no nested interactive content.
 */
export const CommentCard = memo(function CommentCard({
  thread,
  deckId,
  emphasis,
  canResolve,
  location,
  fadeDone,
}: CommentCardProps) {
  const dispatch = useViewerDispatch();
  const selection = useCommentSelection();
  const selected = selection.selected.has(thread.id);
  const [expanded, setExpanded] = useState(false);
  const repliesId = useId();
  const { root, replies } = thread;
  const proposalsOf = useCommentProposals(deckId);
  const { aiAuthor } = useViewerData();
  const done = root.status === 'done';
  const highlighted = expanded || emphasis === 'focused' || emphasis === 'hovered';
  const aiAnswers = [root, ...replies]
    .flatMap((comment) => proposalsOf(comment.id))
    .filter((proposal) => proposal.status !== 'discarded');
  const aiWorking = aiAnswers.some((proposal) => proposal.status === 'running');
  // Only a change it made (taken back or not) is one; otherwise it just answered.
  const aiChanged = aiAnswers.some((proposal) => ['applied', 'reverted'].includes(proposal.status));
  // Its latest answer asks back: the thread waits for the people.
  const aiAsks = aiAnswers.filter((proposal) => proposal.status !== 'running').at(-1)?.asks;
  const stacked = (replies.length > 0 || aiAnswers.length > 0) && !expanded;
  const canReply = canResolve;
  const removed = isRemovedInSource(root);
  const menu = useCommentMenu({
    comment: root,
    deckId,
    isRoot: true,
    onEdit: () =>
      dispatch({ type: 'commentEditRequested', threadId: thread.id, commentId: root.id }),
  });

  // An expanded thread is the selected one: its line stays lit, the other cards dim (B3).
  const expand = () => {
    if (expanded) return;
    setExpanded(true);
    dispatch({ type: 'threadFocused', threadId: thread.id, openPanel: false });
  };
  const collapse = () => {
    setExpanded(false);
    dispatch({ type: 'threadUnfocused', threadId: thread.id });
  };

  return (
    <article
      data-comment-card={thread.id}
      data-hover-thread={thread.id}
      data-selected={selected || undefined}
      // Not saved yet (written offline): dimmed like a reply on its way.
      aria-busy={isPendingComment(root) || undefined}
      onContextMenuCapture={(event) => selection.onContextMenuCapture(thread.id, event)}
      className={cn(
        // Raised while hovered or focused, so the reply bar overlaps the cards below.
        'group relative transition-opacity duration-200 focus-within:z-(--z-overlay) hover:z-(--z-overlay)',
        isPendingComment(root) && 'opacity-60',
        emphasis === 'focused' && 'z-(--z-overlay)',
        (emphasis === 'dimmed' || (done && fadeDone)) && 'opacity-45',
        emphasis === 'dimmed' && done && fadeDone && 'opacity-30',
      )}
      style={{ '--card-accent': accentColor(root.author.color) } as CSSProperties}
    >
      {menu.menus}
      <LiveThreadMarker threadId={thread.id} />
      {stacked && (
        // Stacked sheets behind the card hint at the thread (B1 "Thread Stack").
        <>
          <span
            aria-hidden
            className="glass absolute inset-x-3 -bottom-2 h-6 rounded-b-panel opacity-60"
          />
          <span aria-hidden className="glass absolute inset-x-1.5 -bottom-1 h-6 rounded-b-panel" />
        </>
      )}
      {aiWorking && (
        // The AI at work: its light glows under the glass while it runs round the rim (below).
        <span aria-hidden className="ai-glow pointer-events-none absolute -inset-1 rounded-panel" />
      )}
      <div className="group/message relative">
        <div
          onContextMenu={menu.onContextMenu}
          className={cn(
            'glass relative flex flex-col gap-2 rounded-panel px-3.5 py-3 transition-[background-color,box-shadow] duration-200 group-hover/message:bg-glass-hover',
            highlighted &&
              'shadow-[inset_0_0_0_1px_var(--card-accent),0_0_20px_color-mix(in_srgb,var(--card-accent)_50%,transparent)]!',
            // Selected under the slides, in the viewer's colour like the decks in "Präsentationen".
            selected && selectedOutlineClass,
          )}
        >
          <button
            type="button"
            aria-label={`Thread von ${root.author.name} öffnen`}
            onClick={(event) => {
              if (selection.onModifiedClick(thread.id, event)) return;
              dispatch({ type: 'threadFocused', threadId: thread.id, openPanel: true });
            }}
            className="absolute inset-0 rounded-panel"
          />
          {aiWorking && (
            <span
              aria-hidden
              className="ai-rim pointer-events-none absolute -inset-px rounded-[inherit]"
            />
          )}
          <AuthorLine
            comment={root}
            afterTime={<ReactionPicker comment={root} />}
            trailing={
              expanded ? (
                <span className="flex items-center gap-1">
                  {canResolve && <AskAiButton comment={root} deckId={deckId} className="-my-1" />}
                  <Button
                    variant="soft"
                    size="2xs"
                    weight="normal"
                    trailingIcon="expandLess"
                    expanded
                    aria-controls={repliesId}
                    onClick={collapse}
                    className="relative z-(--z-raised) -my-0.5"
                  >
                    Zuklappen
                  </Button>
                </span>
              ) : (
                canResolve && (
                  <span className="-my-1 -mr-1.5 flex items-center">
                    {/* Collapsed, the thread's last message is the one to act on. */}
                    {/* Done is done: asking the AI again takes opening the thread. */}
                    {!done && <AskAiButton comment={replies.at(-1) ?? root} deckId={deckId} />}
                    <ResolveButton comment={root} deckId={deckId} />
                  </span>
                )
              )
            }
          />
          {location && <p className="text-caption font-medium text-fg-subtle">{location}</p>}
          {removed && <RemovedInSourceNote source={root.source} />}
          <CommentContent
            comment={root}
            bodyClassName={cn(removed && 'text-fg-subtle line-through decoration-fg-faint')}
          />
          <ReactionChips comment={root} />
          {root.aiSummary && <ThreadSummary summary={root.aiSummary} compact />}
          {stacked && (
            <footer className="flex items-center gap-2 pt-0.5">
              <AvatarStack authors={thread.repliers} size={16} max={3} />
              <span className="text-xs text-fg-subtle">
                {[
                  replies.length > 0 && pluralize(replies.length, 'Antwort', 'Antworten'),
                  aiWorking
                    ? `${aiAuthor.name} arbeitet …`
                    : aiAsks
                      ? `${aiAuthor.name} fragt nach`
                      : aiChanged
                        ? `${aiAuthor.name} hat geändert`
                        : aiAnswers.length > 0 && `${aiAuthor.name} hat geantwortet`,
                ]
                  .filter(Boolean)
                  .join(' | ')}
              </span>
              <Button
                variant="ghost"
                tone="subtle"
                size="2xs"
                weight="normal"
                trailingIcon="expandMore"
                expanded={false}
                aria-controls={repliesId}
                onClick={expand}
                className="relative z-(--z-raised) ml-auto"
              >
                Aufklappen
              </Button>
            </footer>
          )}
        </div>
      </div>

      {expanded && (
        <ol id={repliesId} aria-label="Antworten" className="flex flex-col gap-1.5 pt-1.5 pl-11">
          {proposalsOf(root.id).map((proposal) => (
            <ThreadBranch key={proposal.id}>
              <AiProposalCard proposal={proposal} />
            </ThreadBranch>
          ))}
          {replies.map((reply) => (
            <Fragment key={reply.id}>
              <ThreadBranch>
                <InlineReply reply={reply} threadId={thread.id} deckId={deckId} />
              </ThreadBranch>
              {proposalsOf(reply.id).map((proposal) => (
                <ThreadBranch key={proposal.id}>
                  <AiProposalCard proposal={proposal} />
                </ThreadBranch>
              ))}
            </Fragment>
          ))}
        </ol>
      )}

      {canReply && (
        <ReplyBar
          root={root}
          deckId={deckId}
          replyCount={replies.length}
          // Below the stacked sheets, if any.
          offset={stacked ? 14 : 6}
          focused={emphasis === 'focused' && !expanded}
          onCompose={expand}
          onCancel={replies.length === 0 && expanded ? collapse : undefined}
        />
      )}
    </article>
  );
});

/**
 * One item of the inline thread with its branch of the accent tree line (Figma 110:460): a
 * rounded tick at avatar height into the item, the trunk continuing to the next item. The trunk
 * runs at x=26 of the card, items start at x=44.
 */
export function ThreadBranch({ children }: { children: ReactNode }) {
  // SVG rather than CSS borders: a 1.5px border snaps to 1px on standard-density screens.
  return (
    <li className="group/branch relative w-64 max-w-full scroll-mb-6 animate-fade-in">
      <svg
        aria-hidden
        width="18"
        height="30"
        className="pointer-events-none absolute -top-1.5 -left-[18px] overflow-visible text-(--card-accent)"
      >
        <path
          d="M0.75 0 V21.25 A8 8 0 0 0 8.75 29.25 H18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
      </svg>
      <svg
        aria-hidden
        width="2"
        className="pointer-events-none absolute -top-1.5 -left-[18px] h-[calc(100%+6px)] overflow-visible text-(--card-accent) group-last/branch:hidden"
      >
        <line x1="0.75" y1="0" x2="0.75" y2="100%" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      {children}
    </li>
  );
}

function InlineReply({
  reply,
  threadId,
  deckId,
}: {
  reply: Comment;
  threadId: string;
  deckId: string;
}) {
  const dispatch = useViewerDispatch();
  const { canComment } = useViewerData();
  const menu = useCommentMenu({
    comment: reply,
    deckId,
    isRoot: false,
    onEdit: () => dispatch({ type: 'commentEditRequested', threadId, commentId: reply.id }),
  });
  return (
    <div className="group/message relative">
      <article
        onContextMenu={menu.onContextMenu}
        aria-busy={isPendingComment(reply) || undefined}
        className={cn(
          'glass relative flex flex-col gap-2 rounded-panel px-3.5 py-3',
          isPendingComment(reply) && 'opacity-60',
        )}
      >
        <AuthorLine
          comment={reply}
          afterTime={<ReactionPicker comment={reply} />}
          trailing={
            canComment && <AskAiButton comment={reply} deckId={deckId} className="-my-1 -mr-1.5" />
          }
        />
        <CommentContent comment={reply} bodyClassName="text-fg-muted" />
        <ReactionChips comment={reply} />
        {menu.menus}
      </article>
    </div>
  );
}

/**
 * "Antworten mit …" field under a hovered or focused card (Figma B1 105:277): typing is the text
 * reply and expands the thread inline (B3), so sent replies show up between card and field.
 * Mic and camera record a voice or video reply (BER-116), ✓ resolves. It overlays the cards below instead of
 * pushing them, so the layout and the connector lines stay put; a transparent bridge keeps the
 * hover alive across the gap. A draft keeps it open.
 */
function ReplyBar({
  root,
  deckId,
  replyCount,
  offset,
  focused,
  onCompose,
  onCancel,
}: {
  root: Comment;
  deckId: string;
  replyCount: number;
  offset: number;
  focused: boolean;
  onCompose: () => void;
  onCancel: (() => void) | undefined;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const { body, setBody, canSend, submit, onKeyDown, textareaRef, voice, uploading } =
    useReplyDraft(root, deckId, {
      onCancel: () => {
        setBody('');
        textareaRef.current?.blur();
        onCancel?.();
      },
    });
  const mentions = useMentions(body, setBody, textareaRef);
  const hasDraft = body.length > 0 || voice.on;
  useKeepThreadListed(root.id, hasDraft);

  // Each sent reply pushes the field down; keep it in view while it has focus.
  useEffect(() => {
    if (formRef.current?.contains(document.activeElement))
      formRef.current.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [replyCount]);

  return (
    <form
      ref={formRef}
      onSubmit={submit}
      style={{ top: `calc(100% + ${offset}px)` }}
      className={cn(
        'glass-elevated absolute inset-x-0 flex scroll-mb-4 items-end gap-0.5 rounded-control py-1 pr-1 pl-3',
        'transition-[opacity,visibility,box-shadow] duration-150',
        'focus-within:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--card-accent)_45%,transparent)]!',
        'before:absolute before:inset-x-0 before:bottom-full before:h-4',
        focused || hasDraft
          ? 'visible opacity-100'
          : 'invisible opacity-0 group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100',
      )}
    >
      <div className="relative flex min-w-0 flex-1 flex-col gap-1.5 overflow-hidden py-[5px]">
        {voice.on && (
          <VoiceMemoBar
            onChange={voice.onChange}
            onRecordingChange={voice.onRecordingChange}
            onDiscard={voice.discard}
            onSend={(options) => submit(undefined, options)}
            onSendNow={voice.sendNow}
            disabled={uploading}
          />
        )}
        {/* The memo is the reply: no note beside it. */}
        {!voice.on && <MentionMenu mentions={mentions} />}
        {!voice.on && (
          <AutosizeTextarea
            {...mentions.fieldProps}
            ref={textareaRef}
            aria-label={`Antwort an ${root.author.name}`}
            maxLength={MAX_COMMENT_BODY_LENGTH}
            placeholder="Antworten mit …"
            value={body}
            maxHeight={120}
            onChange={(event) => {
              mentions.fieldProps.onChange(event);
              if (event.target.value.length > 0) onCompose();
            }}
            onKeyDown={(event) => {
              if (!mentions.onKeyDown(event)) onKeyDown(event);
            }}
            className="text-body leading-4.5 text-fg placeholder:text-fg-subtle"
          />
        )}
      </div>
      {hasDraft && !voice.running && (
        <IconButton
          type="submit"
          icon="arrowUpward"
          label="Antwort senden"
          title="Senden (Enter)"
          size="compact"
          iconTone="success"
          disabledStyle="dim"
          disabled={!canSend}
        />
      )}
      {/* The memo has the row: its own pause, send and bin – the other kinds and Erledigen come
          back once it is sent or dropped. */}
      {!voice.on && (
        <>
          <MediaReplyButtons root={root} voice={voice} />
          <ToolbarDivider size="sm" className="mb-1.5" />
          <ResolveButton comment={root} deckId={deckId} />
        </>
      )}
    </form>
  );
}
