import type { KeyboardEvent } from 'react';
import { AGENT_AVATAR_STYLES, type AgentAvatarStyle, type Workspace } from '@slider/shared';
import { generatedAgentAvatar } from '@/lib/generated-avatar';
import { useSetAgentAvatars } from '@/lib/api';
import { cn, Icon, Section, type ShowToast } from '@/ui';

/** Each style's name, and whose it is. */
const STYLES: Record<AgentAvatarStyle, { label: string; source: string }> = {
  flowers: { label: 'Blumen', source: 'Eigener Stil „Glaze Flowers“' },
  cameo: { label: 'Köpfe', source: '„Cameo“ von DiceBear' },
};

/** Agents of the preview: the same ones in each style, so the styles compare. */
const PREVIEW_SEEDS = ['vorschau-1', 'vorschau-2', 'vorschau-3', 'vorschau-4'];

/**
 * „Agenten“: the pictures the workspace's agents get, everywhere they are drawn. One style is
 * always picked; admins pick another with a click or ←/→ (a radio group, roving focus), kept at
 * once – a refusal toasts and brings the old one back. The others see which one it is.
 */
export function AgentAvatarsSection({
  workspace,
  onNotify,
}: {
  workspace: Workspace;
  onNotify: ShowToast;
}) {
  const save = useSetAgentAvatars(workspace.id);
  const editable = workspace.role === 'admin';
  const picked = workspace.agentAvatars;

  const pick = (style: AgentAvatarStyle) => {
    if (!editable || style === picked) return;
    save.mutate(style, {
      onSuccess: () => onNotify(`Agenten: ${STYLES[style].label}`),
      onError: (error) => onNotify(error.message, 'danger'),
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!editable) return;
    const index = AGENT_AVATAR_STYLES.indexOf(picked);
    const last = AGENT_AVATAR_STYLES.length - 1;
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = index >= last ? 0 : index + 1;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = index <= 0 ? last : index - 1;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = last;
        break;
      default:
        return;
    }
    event.preventDefault();
    const style = AGENT_AVATAR_STYLES[next]!;
    pick(style);
    event.currentTarget.querySelector<HTMLElement>(`[data-style="${style}"]`)?.focus();
  };

  return (
    <Section
      title="Agenten"
      description={
        editable
          ? 'So sehen die Agenten des Workspace aus – überall, für alle Mitglieder.'
          : 'So sehen die Agenten des Workspace aus. Nur Admins können das ändern.'
      }
    >
      <div
        role="radiogroup"
        aria-label="Bilder der Agenten"
        onKeyDown={onKeyDown}
        className="grid gap-2 sm:grid-cols-2"
      >
        {AGENT_AVATAR_STYLES.map((style) => {
          const checked = style === picked;
          return (
            <button
              key={style}
              type="button"
              role="radio"
              data-style={style}
              aria-checked={checked}
              aria-disabled={!editable || undefined}
              tabIndex={checked ? 0 : -1}
              onClick={() => pick(style)}
              className={cn(
                'flex flex-col gap-3 rounded-control border p-3 text-left transition-colors',
                checked ? 'border-border-focus bg-selected' : 'border-hairline',
                editable ? (checked ? '' : 'hover:bg-hover') : 'cursor-default',
                !editable && !checked && 'opacity-60',
              )}
            >
              <span className="flex gap-2" aria-hidden>
                {PREVIEW_SEEDS.map((seed) => (
                  <img
                    key={seed}
                    src={generatedAgentAvatar(seed, style)}
                    alt=""
                    draggable={false}
                    className="size-10 shrink-0 rounded-control bg-placeholder object-cover"
                  />
                ))}
              </span>
              <span className="flex items-start justify-between gap-2">
                <span className="flex flex-col">
                  <span className="text-sm font-medium text-fg">{STYLES[style].label}</span>
                  <span className="text-xs text-fg-subtle">{STYLES[style].source}</span>
                </span>
                {checked && <Icon name="check" size={18} className="shrink-0 text-fg" />}
              </span>
            </button>
          );
        })}
      </div>
    </Section>
  );
}
