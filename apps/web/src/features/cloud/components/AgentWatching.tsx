import { useEffect, useState } from 'react';
import type { CloudAgentDetail, CloudAgentWatching } from '@slider/shared';
import { useAutoCloudAgent, useCloudAgent } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { Button, Icon, type IconName } from '@/ui';
import { useCloud } from '../hooks/useCloud';
import { AgentAvatar } from './AgentAvatar';

function Line({ icon, children }: { icon: IconName; children: string }) {
  return (
    <li className="flex min-w-0 items-center gap-2">
      <Icon name={icon} size={14} className="shrink-0" />
      <span className="truncate">{children}</span>
    </li>
  );
}

/** What it waits for, in its words – and whether its person can cut the wait short. */
function waiting(
  each: CloudAgentWatching,
  working: boolean,
  left: number | null,
): { text: string; start?: string } {
  if (each.uploading.length > 0) return { text: 'Ich warte, bis alles da ist.' };
  if (working) return { text: 'Ich arbeite noch. Danach sehe ich mir das an.' };
  if (each.until) {
    return { text: `Ich sammle bis ${formatDateTime(each.until)}.`, start: 'Jetzt berichten' };
  }
  if (left === null || left <= 0) return { text: 'Ich lege los.' };
  const seconds = Math.ceil(left / 1000);
  return {
    text: `Ich warte noch ${seconds < 90 ? `${seconds} s` : `${Math.round(seconds / 60)} Min.`}, ob sich mehr tut.`,
    start: 'Jetzt loslegen',
  };
}

/**
 * What the agent has noticed where it watches and not yet worked on, as the last thing in its
 * chat: files on their way up, what happened, and what it waits for – so its person sees that
 * it saw, before it starts. „Jetzt loslegen“ ends the wait. Shown to its owner (the server
 * tells nobody else), gone once it works on it: then its order stands in the chat.
 */
export function AgentWatching({ agent }: { agent: CloudAgentDetail }) {
  const ui = useCloud();
  const auto = useAutoCloudAgent(ui.workspace.id, agent.id);
  // When the answer came: the wait is counted down from there.
  const { dataUpdatedAt } = useCloudAgent(ui.workspace.id, agent.id);
  const counting = agent.watching.some((each) => each.startsIn !== null && !each.until);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!counting) return;
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(clock);
  }, [counting]);
  if (agent.watching.length === 0) return null;
  return (
    <li aria-live="polite" className="flex flex-col gap-2">
      <div className="flex min-h-6 min-w-0 items-center gap-1.5 text-xs text-fg-subtle">
        <AgentAvatar id={agent.id} size={22} className="rounded-mark" />
        <span className="truncate">{agent.title}</span>
      </div>
      {agent.watching.map((each) => {
        const wait = waiting(
          each,
          agent.running,
          each.startsIn === null ? null : each.startsIn - Math.max(0, now - dataUpdatedAt),
        );
        const hidden = each.count - each.seen.length;
        return (
          <div key={each.watchId} className="flex flex-col gap-1.5 text-caption text-fg-subtle">
            <ul className="flex flex-col gap-1">
              {each.seen.map((line) => (
                <Line key={line} icon="check">
                  {line}
                </Line>
              ))}
              {hidden > 0 && <Line icon="check">{`und ${hidden} weitere in „${each.name}“`}</Line>}
              {each.uploading.map((name, at) => (
                <Line key={`${name}-${at}`} icon="upload">{`„${name}“ wird hochgeladen`}</Line>
              ))}
            </ul>
            <div className="flex min-h-6 items-center gap-2">
              <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-fg-subtle" />
              <span className="min-w-0 truncate">{wait.text}</span>
              {wait.start && each.seen.length > 0 && (
                <Button
                  variant="secondary"
                  size="xs"
                  onClick={() =>
                    auto.mutate(
                      { startNow: true },
                      { onError: (error) => ui.notify(error.message, 'danger') },
                    )
                  }
                >
                  {wait.start}
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </li>
  );
}

/** The answers an agent offers under its question: one click sends one as its person's. */
export function AgentChoices({
  choices,
  onPick,
}: {
  choices: string[];
  onPick: (choice: string) => void;
}) {
  if (choices.length === 0) return null;
  return (
    <div role="group" aria-label="Antworten" className="mt-2 flex flex-wrap gap-2">
      {choices.map((choice) => (
        <Button key={choice} variant="secondary" size="sm" onClick={() => onPick(choice)}>
          {choice}
        </Button>
      ))}
    </div>
  );
}
