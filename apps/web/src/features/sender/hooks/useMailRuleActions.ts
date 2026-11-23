import type { MailRuleSender } from '@slider/shared';
import { useAddMailRule, useDeleteMailRule, useMailRules } from '@/lib/api';
import type { MenuAction } from '@/ui';
import { ruleActions } from '../lib/mail';

const mails = (count: number) => `${count} ${count === 1 ? 'Mail' : 'Mails'}`;

/**
 * The menu's rules for a mail's sender (`ruleActions`), in a row's menu and the open mail's: a
 * new rule places that sender's conversations at once and says how many moved; a lifted one
 * leaves them where they lie. A refusal toasts.
 */
export function useMailRuleActions(
  workspaceId: string,
  notify: (message: string, tone?: 'danger') => void,
) {
  const rules = useMailRules(workspaceId).data;
  const add = useAddMailRule(workspaceId);
  const remove = useDeleteMailRule(workspaceId);
  const fail = (error: Error) => notify(error.message, 'danger');
  return (
    threadId: string,
    sender: MailRuleSender | null | undefined,
    spam: boolean,
  ): MenuAction[] =>
    ruleActions(
      sender,
      spam,
      rules,
      (kind, match, value) =>
        add.mutate(
          { threadId, kind, match },
          {
            onSuccess: ({ moved }) =>
              notify(
                kind === 'block'
                  ? `${value} blockiert${moved ? ` – ${mails(moved)} in Spam verschoben` : ''}`
                  : `${value} gilt als vertraut${moved ? ` – ${mails(moved)} zurück im Posteingang` : ''}`,
              ),
            onError: fail,
          },
        ),
      (rule) =>
        remove.mutate(rule.id, {
          onSuccess: () =>
            notify(`${rule.value} nicht mehr ${rule.kind === 'block' ? 'blockiert' : 'vertraut'}`),
          onError: fail,
        }),
    );
}
