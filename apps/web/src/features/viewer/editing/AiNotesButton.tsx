import { IconButton, Spinner } from '@/ui';
import { useAiNotes } from './hooks/useAiNotes';

const TITLE = 'Notizen mit der KI schreiben, für jede Folie ohne Notizen';

/**
 * The tool bar's AI button: the workspace's AI writes speaker notes for every slide that has
 * none, put in as one step (⌘Z takes them all back). A slide typed into meanwhile keeps its own.
 */
export function AiNotesButton() {
  const ai = useAiNotes();

  if (ai.pending) {
    return (
      <span
        role="status"
        title="Die KI schreibt Notizen"
        className="grid size-8 place-items-center"
      >
        <Spinner size="sm" label="Die KI schreibt Notizen" />
      </span>
    );
  }

  return (
    <IconButton
      icon="autoAwesome"
      label="Notizen schreiben"
      title={ai.reason ?? TITLE}
      size="sm"
      disabled={ai.reason !== null}
      onClick={() => ai.run()}
    />
  );
}
