import type { CallState } from '@slider/shared';
import { Badge, Icon, Tooltip } from '@/ui';

/**
 * „Wird mitgeschrieben“: a call whose agent writes along, or one an agent was brought into (what
 * is said goes into its chat when it is asked) – shown wherever one sees the call before and
 * while being in it (ringing, „Beitreten“, the dock), so nobody speaks unaware.
 */
export function NotesBadge({
  call,
  align = 'end',
}: {
  call: Pick<CallState, 'notes' | 'channelId' | 'agent'>;
  align?: 'start' | 'end';
}) {
  if (!call.channelId) return null;
  const brought = call.agent?.invitedBy && !call.notes ? call.agent : null;
  if (!call.notes && !brought) return null;
  return (
    <Tooltip
      label={
        brought
          ? `${brought.title} hört mit: Was seit der letzten Frage gesagt wurde, steht in seinem Chat, sobald ihn jemand mit „Agent, …“ fragt.`
          : 'Ein Agent schreibt mit und schickt danach Notizen und Aufgaben in die Unterhaltung. Sag „Agent, …“, um ihn im Anruf etwas zu fragen.'
      }
      align={align}
    >
      <Badge tone="info" tabIndex={0}>
        <Icon name="autoAwesome" size={12} />
        Wird mitgeschrieben
      </Badge>
    </Tooltip>
  );
}
