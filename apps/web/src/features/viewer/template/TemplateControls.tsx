import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { templateScope, useUpdateDeck } from '@/lib/api';
import { ConfirmDialog, GlassPanel, TextField, ToolbarDivider } from '@/ui';
import { useViewerData } from '../state/viewer-data';
import { useViewerDispatch, useViewerState } from '../state/viewer-state';
import { TemplateColors } from './TemplateColors';
import { useTemplate } from './useTemplate';

/**
 * A field that keeps what is typed and sends it once it loses the focus (or on ↵). Keyed by its
 * value where it is used, so a new value from elsewhere starts it over.
 */
function NameField({
  value,
  onCommit,
  label,
  placeholder,
  className,
}: {
  value: string;
  onCommit: (value: string) => void;
  label: string;
  placeholder?: string;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  /** What is typed as of now – Esc's blur comes before the render that clears it. */
  const typed = useRef(value);
  const type = (next: string) => {
    typed.current = next;
    setDraft(next);
  };
  const committed = useRef(value);
  const commit = () => {
    const next = typed.current.trim();
    if (next === value || next === committed.current) return;
    committed.current = next;
    onCommit(next);
  };
  // Started over (another slide, a name from elsewhere) while typing: what was typed is kept.
  const latest = useRef(commit);
  useEffect(() => {
    latest.current = commit;
  });
  useEffect(() => () => latest.current(), []);
  return (
    <input
      aria-label={label}
      title={label}
      value={draft}
      placeholder={placeholder}
      maxLength={100}
      onChange={(event) => type(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        if (event.key === 'Escape') {
          type(value);
          event.currentTarget.blur();
        }
      }}
      className={
        'h-8 min-w-0 rounded-control-sm bg-transparent px-2 text-sm text-fg outline-none ' +
        'placeholder:text-fg-subtle hover:bg-hover focus:bg-hover ' +
        (className ?? '')
      }
    />
  );
}

/** „Layout umbenennen“ (a slide's right-click menu): one name field. */
function LayoutNameDialog({
  initialName,
  onSubmit,
  onClose,
}: {
  initialName: string;
  onSubmit: (name: string) => void;
  onClose: () => void;
}) {
  const formId = useId();
  const [name, setName] = useState(initialName);
  const trimmed = name.trim();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (trimmed) onSubmit(trimmed);
  };
  return (
    <ConfirmDialog
      onClose={onClose}
      title="Layout umbenennen"
      tone="primary"
      confirmLabel="Umbenennen"
      form={formId}
      confirmDisabled={!trimmed}
    >
      <form id={formId} onSubmit={submit}>
        <TextField
          aria-label="Name des Layouts"
          icon="slideMaster"
          maxLength={100}
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </form>
    </ConfirmDialog>
  );
}

/**
 * In a template being designed, in the controls row: its name, its colours („Farben“) and,
 * while the active slide's layout has none, a field to name it – named, it is renamed from the slide's right-click menu
 * („Layout umbenennen“, here as a dialog). No saving: the server keeps the template in the
 * library by itself, from the moment it is made. A template opens in editing.
 */
export function TemplateControls() {
  const { deck } = useViewerData();
  const { activeSlideId, layoutRenamePageId } = useViewerState();
  const dispatch = useViewerDispatch();
  const { template, update, pageIdOf } = useTemplate();
  // In line with the template's changes.
  const rename = useUpdateDeck(deck.id, templateScope(deck.id));

  // Designing is editing: the tool bar opens it in editing (`ToolBar`).

  if (!template) return null;
  const pageId = activeSlideId ? pageIdOf(activeSlideId) : null;
  const layoutName = pageId ? (template.layoutNames[pageId] ?? '') : '';
  const nameLayout = (id: string, name: string) =>
    update({ layoutNames: { ...template.layoutNames, [id]: name } });
  const closeRename = () => dispatch({ type: 'layoutRenameSet', pageId: null });

  return (
    <GlassPanel className="flex h-10 shrink-0 items-center gap-1 px-1.5" data-template-controls="">
      <NameField
        key={`title:${deck.title}`}
        label="Name der Vorlage"
        value={deck.title}
        onCommit={(title) => title && rename.mutate({ title })}
        className="w-36"
      />
      <ToolbarDivider />
      <TemplateColors />
      {pageId && !layoutName && (
        <>
          <ToolbarDivider />
          <NameField
            key={`layout:${pageId}`}
            label="Name des Layouts dieser Folie"
            placeholder="Layout …"
            value=""
            onCommit={(name) => name && nameLayout(pageId, name)}
            className="w-36"
          />
        </>
      )}
      {layoutRenamePageId && (
        <LayoutNameDialog
          key={layoutRenamePageId}
          initialName={template.layoutNames[layoutRenamePageId] ?? ''}
          onClose={closeRename}
          onSubmit={(name) => {
            nameLayout(layoutRenamePageId, name);
            closeRename();
          }}
        />
      )}
    </GlassPanel>
  );
}
