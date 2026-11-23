import type { MailRule } from '@slider/shared';
import { useState } from 'react';
import { useDeleteMailRule, useMailRules } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';
import { ContextMenu, Icon, ListRow, Menu, RowList, type MenuAction } from '@/ui';
import { useSender } from '../../hooks/useSender';

/**
 * One's rules for senders under „Postfächer“ – set in a mail's menu („Absender blockieren“,
 * „Absender vertrauen“), lifted here as there, without a question: the sender's mails stay where
 * they lie. Nothing shows while there is none.
 */
export function MailRules() {
  const ui = useSender();
  const rules = useMailRules(ui.workspace.id).data;
  const remove = useDeleteMailRule(ui.workspace.id);
  const [menu, setMenu] = useState<{ rule: MailRule; at: { x: number; y: number } } | null>(null);
  if (!rules?.length) return null;
  const actionsFor = (rule: MailRule): MenuAction[] => [
    {
      label: rule.kind === 'block' ? 'Nicht mehr blockieren' : 'Nicht mehr vertrauen',
      icon: 'undo',
      onSelect: () =>
        remove.mutate(rule.id, {
          onSuccess: () =>
            ui.notify(
              `${rule.value} nicht mehr ${rule.kind === 'block' ? 'blockiert' : 'vertraut'}`,
            ),
          onError: (error) => ui.notify(error.message, 'danger'),
        }),
    },
  ];
  return (
    <div className="flex flex-col gap-2">
      <h2 className="px-2 text-base font-semibold text-fg">Absender</h2>
      <RowList variant="hover" aria-label="Absender">
        {rules.map((rule) => (
          <ListRow
            key={rule.id}
            variant="hover"
            padding="wide"
            leading={
              <span className="flex size-8 items-center justify-center rounded-chip bg-surface-2 text-fg-muted">
                <Icon name={rule.kind === 'block' ? 'personRemove' : 'shield'} size={18} />
              </span>
            }
            title={rule.value}
            subtitle={[
              rule.kind === 'block'
                ? 'Blockiert – landet in Spam'
                : 'Vertraut – nie in Spam, wenn die Absender-Domain bestätigt ist',
              rule.match === 'domain' ? 'Ganze Domain' : null,
              formatRelativeTime(rule.createdAt),
            ]
              .filter(Boolean)
              .join(' | ')}
            onContextMenu={(event) => {
              if (event.shiftKey) return;
              event.preventDefault();
              setMenu({ rule, at: { x: event.clientX, y: event.clientY } });
            }}
            trailing={<Menu label={`Aktionen für ${rule.value}`} actions={actionsFor(rule)} />}
          />
        ))}
      </RowList>
      {menu && (
        <ContextMenu
          label={`Aktionen für ${menu.rule.value}`}
          at={menu.at}
          onClose={() => setMenu(null)}
          actions={actionsFor(menu.rule)}
        />
      )}
    </div>
  );
}
