import { useId, useState } from 'react';
import {
  MAX_CLOUD_AGENT_INSTRUCTIONS,
  MAX_CLOUD_AGENT_MEMORY_FILE,
  type CloudAgentDetail,
  type CloudAgentMemory,
} from '@slider/shared';
import { useInstructCloudAgent, useRememberCloudAgent } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';
import { AutosizeTextarea, ConfirmDialog, Icon, IconButton, ProgressBar } from '@/ui';
import { useCloud } from '../hooks/useCloud';

const tokens = new Intl.NumberFormat('de-DE', { notation: 'compact', maximumFractionDigits: 1 });

/**
 * „Arbeitsweise“: how its owner wants the agent to work („Anweisungen“, typed where they stand,
 * kept on leaving the field – in its prompt from its next turn on), and how full the model's
 * context was at its last turn in this chat. Others read both; an empty one they do not see.
 */
export function AgentWays({ agent }: { agent: CloudAgentDetail }) {
  const ui = useCloud();
  const instruct = useInstructCloudAgent(ui.workspace.id, agent.id);
  const [text, setText] = useState(agent.instructions);
  const fieldId = useId();
  // Changed elsewhere (another tab): shown here as well.
  const [shown, setShown] = useState(agent.instructions);
  if (shown !== agent.instructions) {
    setShown(agent.instructions);
    setText(agent.instructions);
  }
  const context = agent.chats.find((chat) => chat.id === agent.id)?.context ?? null;
  if (!agent.mine && !agent.instructions && !context && agent.memories.length === 0) return null;
  const keep = () => {
    if (text.trim() === agent.instructions.trim()) return;
    instruct.mutate(text.trim(), {
      onError: (error) => {
        setText(agent.instructions);
        ui.notify(error.message, 'danger');
      },
    });
  };
  const share = context?.window ? context.tokens / context.window : null;
  return (
    <section
      aria-label="Arbeitsweise"
      className="glass flex shrink-0 flex-col gap-3 rounded-panel p-4"
    >
      <div className="flex h-7 shrink-0 items-center gap-2">
        <Icon name="tune" size={18} className="text-fg-muted" />
        <h2 className="flex-1 text-base font-semibold text-fg">Arbeitsweise</h2>
      </div>
      {agent.mine ? (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={fieldId} className="text-xs text-fg-subtle">
            Anweisungen
          </label>
          <div className="field-well focus-field rounded-control px-3 py-2">
            <AutosizeTextarea
              id={fieldId}
              maxLength={MAX_CLOUD_AGENT_INSTRUCTIONS}
              maxHeight={180}
              rows={2}
              value={text}
              placeholder="Wie er arbeiten soll, etwa „Antworte kurz, in Stichpunkten.“"
              onChange={(event) => setText(event.target.value)}
              onBlur={keep}
              className="w-full text-body text-fg placeholder:text-fg-subtle"
            />
          </div>
        </div>
      ) : (
        agent.instructions && (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-fg-subtle">Anweisungen</span>
            <p className="text-body whitespace-pre-line text-fg">{agent.instructions}</p>
          </div>
        )
      )}
      <AgentMemory agent={agent} />
      {context && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs text-fg-subtle">Kontext</span>
            <span className="text-caption text-fg-muted">
              {share === null
                ? `${tokens.format(context.tokens)} Tokens`
                : `${Math.max(1, Math.round(share * 100))} % von ${tokens.format(context.window!)}`}
            </span>
          </div>
          {share !== null && <ProgressBar value={share} label="Wie voll sein Kontext ist" />}
          <span className="text-caption text-fg-subtle">
            {context.model ? `${context.model} | ` : ''}
            {formatRelativeTime(context.at)}
          </span>
        </div>
      )}
    </section>
  );
}

const fileName = (path: string) => path.replace(/^\/memories\//, '');

/**
 * „Gedächtnis“: what the agent keeps across its chats (`/memories`), one file a row – opened in
 * place, changed where it stands (kept on leaving the field), deleted after asking. A shared
 * agent's is everyone's who works with it.
 */
function AgentMemory({ agent }: { agent: CloudAgentDetail }) {
  const ui = useCloud();
  const remember = useRememberCloudAgent(ui.workspace.id, agent.id);
  const [open, setOpen] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<CloudAgentMemory | null>(null);
  const refused = (error: Error) => ui.notify(error.message, 'danger');
  if (agent.memories.length === 0 && !agent.canWrite) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-fg-subtle">Gedächtnis</span>
      {agent.memories.length === 0 ? (
        <p className="text-caption text-fg-muted">
          Hier merkt er sich, was ihm beim nächsten Mal hilft. Sag es ihm im Chat, etwa „Merk dir,
          dass …“.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {agent.memories.map((file) => (
            <MemoryFile
              key={file.path}
              file={file}
              open={open === file.path}
              canWrite={agent.canWrite}
              onToggle={() => setOpen(open === file.path ? null : file.path)}
              onKeep={(content) =>
                remember.mutate({ path: file.path, content }, { onError: refused })
              }
              onDelete={() => setDeleting(file)}
            />
          ))}
        </ul>
      )}
      {deleting && (
        <ConfirmDialog
          title={`„${fileName(deleting.path)}“ löschen?`}
          description="Der Agent weiß es dann nicht mehr – für alle, die mit ihm arbeiten."
          confirmLabel="Löschen"
          tone="danger"
          onClose={() => setDeleting(null)}
          onConfirm={() => {
            const file = deleting;
            setDeleting(null);
            remember.mutate({ path: file.path, content: '' }, { onError: refused });
          }}
        />
      )}
    </div>
  );
}

function MemoryFile({
  file,
  open,
  canWrite,
  onToggle,
  onKeep,
  onDelete,
}: {
  file: CloudAgentMemory;
  open: boolean;
  canWrite: boolean;
  onToggle: () => void;
  onKeep: (content: string) => void;
  onDelete: () => void;
}) {
  const [text, setText] = useState(file.content);
  const [shown, setShown] = useState(file.content);
  if (shown !== file.content) {
    setShown(file.content);
    setText(file.content);
  }
  return (
    <li className="flex flex-col gap-1.5">
      <div className="group flex items-center gap-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-control text-left"
        >
          <Icon name="description" size={16} className="shrink-0 text-fg-muted" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-body text-fg">{fileName(file.path)}</span>
            <span className="truncate text-caption text-fg-subtle">
              {file.updatedBy ? `${file.updatedBy} | ` : ''}
              {formatRelativeTime(file.updatedAt)}
            </span>
          </span>
        </button>
        {canWrite && (
          <IconButton
            icon="delete"
            label={`„${fileName(file.path)}“ löschen`}
            size="compact"
            iconSize={16}
            onClick={onDelete}
          />
        )}
      </div>
      {open &&
        (canWrite ? (
          <div className="field-well focus-field rounded-control px-3 py-2">
            <AutosizeTextarea
              aria-label={fileName(file.path)}
              maxHeight={240}
              rows={3}
              maxLength={MAX_CLOUD_AGENT_MEMORY_FILE}
              value={text}
              onChange={(event) => setText(event.target.value)}
              onBlur={() => {
                if (text !== file.content && text.trim()) onKeep(text);
                else setText(file.content);
              }}
              className="w-full font-mono text-caption text-fg"
            />
          </div>
        ) : (
          <p className="text-caption whitespace-pre-line text-fg-muted">{file.content}</p>
        ))}
    </li>
  );
}
