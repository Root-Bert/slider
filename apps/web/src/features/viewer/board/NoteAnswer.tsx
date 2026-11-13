import { MATERIAL_CITATION, markdownToRich, type Material } from '@slider/shared';
import { Fragment, useMemo, type ReactNode } from 'react';
import { formatDateTime, formatRelativeTime } from '@/lib/format';
import { Avatar, cn, Icon, IconButton } from '@/ui';
import { useViewerToast } from '../state/viewer-toast';
import type { NoteAnswerValue } from './note-answers';
import { RichText } from './rich-text';

/* The AI's answer under a note on the material page – asking and its stream: `note-answers.ts`. */

/** What the answer card under a note needs from the board. */
export interface NoteAnswerActions {
  ai: Parameters<typeof Avatar>[0]['author'];
  /** The deck's files by id: an answer's sources. */
  byId: ReadonlyMap<string, Material>;
  /** May ask again and delete (comment rights). */
  canComment: boolean;
  streaming: (noteId: string) => boolean;
  stop: (answer: NoteAnswerValue) => void;
  /** „Nochmal fragen“: the note's text as it is now. */
  retry: (answer: NoteAnswerValue) => void;
  /** „Antwort löschen“ (after asking). */
  remove: (answer: NoteAnswerValue) => void;
  /** A source chip: the file, opened at its page. */
  openSource: (material: Material, page: number | null) => void;
}

/**
 * The AI's answer under a note, as a reply under a comment: its avatar and name over the text,
 * the sources as chips; while written what it reads, „Stoppen“ for the asker; then „Nochmal
 * fragen“, „Kopieren“ and „Löschen“.
 */
export function NoteAnswer({
  answer,
  actions,
  className,
}: {
  answer: NoteAnswerValue;
  actions: NoteAnswerActions;
  className?: string;
}) {
  const toast = useViewerToast();
  const { ai, byId, canComment } = actions;
  const writing = answer.state === 'answering';
  // While it is written, a source half come is left out until it is whole.
  const text = writing ? answer.answer.replace(/\[\[[^\]]*\]?$/, '') : answer.answer;
  const rich = useMemo(() => (text.trim() ? markdownToRich(text) : null), [text]);
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();
  return (
    <article
      data-note-answer={answer.noteId}
      aria-label={`Antwort von ${ai.name}`}
      // Read and clicked, not dragged, panned or zoomed by the board; its text may be selected.
      className={cn(
        'nodrag nopan nowheel pointer-events-auto flex cursor-auto flex-col gap-1.5 rounded-control p-3 select-text',
        className,
      )}
      style={{
        backgroundColor: 'var(--color-glass-solid)',
        boxShadow: 'inset 0 0 0 1px var(--color-hairline-strong), var(--shadow-mark)',
      }}
      onClick={stop}
      onDoubleClick={stop}
      onPointerDown={stop}
      onContextMenu={stop}
    >
      <header className="flex min-w-0 shrink-0 items-center gap-1.5">
        <Avatar author={ai} size={20} />
        <span className="min-w-0 truncate text-caption font-medium text-fg">{ai.name}</span>
        {!writing && (
          <time
            dateTime={answer.createdAt}
            title={formatDateTime(answer.createdAt)}
            className="ml-auto shrink-0 text-caption text-fg-subtle"
          >
            {formatRelativeTime(answer.createdAt)}
          </time>
        )}
      </header>
      {rich && (
        <div className="max-h-80 overflow-y-auto overscroll-contain">
          <RichText
            rich={rich}
            className="flex flex-col gap-2 text-body leading-[1.45] break-words text-fg [&_li+li]:mt-1"
            renderText={(run) => <WithSources text={run} byId={byId} onOpen={actions.openSource} />}
          />
        </div>
      )}
      {writing && (
        <div className="flex items-center gap-2">
          <p
            className="flex min-w-0 flex-1 items-center gap-2 text-caption text-fg-subtle"
            aria-live="polite"
          >
            <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-fg-subtle" />
            <span className="truncate">
              {answer.reading ?? (rich ? 'Schreibt …' : 'Denkt nach …')}
            </span>
          </p>
          {actions.streaming(answer.noteId) && (
            <IconButton
              icon="stop"
              label="Stoppen"
              size="sm"
              onClick={() => actions.stop(answer)}
            />
          )}
        </div>
      )}
      {answer.state === 'stopped' && <p className="text-caption text-fg-subtle">Gestoppt</p>}
      {answer.error && <p className="text-caption text-danger">{answer.error}</p>}
      {!writing && (
        <div className="-mb-1 -ml-1.5 flex items-center gap-0.5">
          {canComment && (
            <IconButton
              icon="refresh"
              label="Nochmal fragen"
              size="sm"
              onClick={() => actions.retry(answer)}
            />
          )}
          {answer.answer.trim() && (
            <IconButton
              icon="contentCopy"
              label="Antwort kopieren"
              size="sm"
              onClick={() => {
                navigator.clipboard
                  .writeText(withoutSources(answer.answer, byId))
                  .then(() => toast('Antwort kopiert'))
                  .catch(() => toast('Nicht kopiert', 'danger'));
              }}
            />
          )}
          {canComment && (
            <IconButton
              icon="delete"
              label="Antwort löschen"
              size="sm"
              onClick={() => actions.remove(answer)}
            />
          )}
        </div>
      )}
    </article>
  );
}

/** A run of the answer's text with its sources (`[[id#page]]`) as chips that open the file. */
function WithSources({
  text,
  byId,
  onOpen,
}: {
  text: string;
  byId: ReadonlyMap<string, Material>;
  onOpen: (material: Material, page: number | null) => void;
}) {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const match of text.matchAll(new RegExp(MATERIAL_CITATION.source, 'g'))) {
    const before = text.slice(at, match.index);
    at = match.index + match[0].length;
    const material = byId.get(match[1]!);
    const page = match[2] && material?.pages ? Number(match[2]) : null;
    parts.push(before.replace(/\s+$/, material ? ' ' : ''));
    if (!material) continue;
    const pageLabel =
      page === null ? '' : material.kind === 'presentation' ? `Folie ${page}` : `S. ${page}`;
    parts.push(
      <button
        key={match.index}
        type="button"
        title={`„${material.name}“${pageLabel ? ` ${pageLabel}` : ''} öffnen`}
        onClick={() => onOpen(material, page)}
        className="mx-px inline-flex max-w-full translate-y-[-1px] items-center gap-1 rounded-chip bg-surface-2 px-1.5 align-middle text-caption leading-5 font-medium text-fg-muted hover:bg-hover hover:text-fg"
      >
        <Icon name="description" size={12} className="shrink-0" />
        <span className="max-w-40 truncate">{material.name}</span>
        {pageLabel && <span className="shrink-0">· {pageLabel}</span>}
      </button>,
    );
  }
  if (at === 0) return text;
  parts.push(text.slice(at));
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>{part}</Fragment>
      ))}
    </>
  );
}

/** The answer for the clipboard: its sources as the file's name (and page) in words. */
function withoutSources(answer: string, byId: ReadonlyMap<string, Material>): string {
  return answer
    .replace(new RegExp(`\\s*${MATERIAL_CITATION.source}`, 'g'), (_, id: string, page?: string) => {
      const material = byId.get(id);
      if (!material) return '';
      const where =
        page && material.pages
          ? `, ${material.kind === 'presentation' ? 'Folie' : 'S.'} ${page}`
          : '';
      return ` (${material.name}${where})`;
    })
    .trim();
}
