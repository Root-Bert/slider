import type { CallOrder } from '@slider/shared';
import { cn, Icon, IconButton, TextLink } from '@/ui';

/**
 * What the agent in the call proposed for agents of their own and what was sent: a proposal
 * waits for a yes – said („Ja, schick los“) or its ✓ („Losschicken“), ✕ drops it – a sent one
 * shows what its agent does and opens it. In the dock a well under the tiles; on the called
 * agent's page (`box`) a card of its own beside its chat, like the cards under it.
 */
export function CallOrders({
  orders,
  ownCall,
  onAnswer,
  onOpen,
  place = 'dock',
}: {
  orders: CallOrder[];
  ownCall: boolean;
  onAnswer: (orderId: string, send: boolean) => void;
  onOpen: (agentId: string) => void;
  place?: 'dock' | 'box';
}) {
  if (orders.length === 0) return null;
  const say = ownCall ? '„Ja“' : '„Agent, ja“';
  const box = place === 'box';
  return (
    <section
      aria-label="Aufträge aus dem Anruf"
      className={
        box
          ? 'glass flex shrink-0 flex-col gap-2 rounded-panel p-4'
          : 'flex flex-col gap-0.5 rounded-control bg-surface-1 p-1 ring-hairline'
      }
    >
      {box ? (
        <div className="flex h-7 shrink-0 items-center gap-2">
          <Icon name="send" size={18} className="text-fg-muted" />
          <h2 className="flex-1 text-base font-semibold text-fg">Aufträge</h2>
        </div>
      ) : (
        <p className="px-1.5 pt-0.5 text-caption text-fg-subtle">Aufträge</p>
      )}
      <ul className={cn('flex flex-col', box ? '-mx-1.5' : 'max-h-44 overflow-y-auto')}>
        {orders.map((order) => (
          <li key={order.id} className="flex items-center gap-2 rounded-control px-1.5 py-1">
            <Mark state={order.state} />
            <div className="min-w-0 flex-1" title={order.text}>
              {order.agentId ? (
                <TextLink
                  size="body"
                  weight="medium"
                  className="block max-w-full truncate text-left text-fg"
                  onClick={() => onOpen(order.agentId!)}
                >
                  {order.title}
                </TextLink>
              ) : (
                <p className="truncate text-body font-medium text-fg">{order.title}</p>
              )}
              <p
                className={cn(
                  'truncate text-caption',
                  order.state === 'failed' ? 'text-danger' : 'text-fg-muted',
                )}
              >
                {order.state === 'proposed'
                  ? `Wartet auf dein Okay – ✓ oder ${say}`
                  : order.state === 'running'
                    ? (order.doing ??
                      `Läuft${order.sentBy ? ` | von ${firstName(order.sentBy.name)}` : ''}`)
                    : order.state === 'done'
                      ? 'Fertig'
                      : (order.error ?? 'Ließ sich nicht losschicken')}
              </p>
            </div>
            {order.state === 'proposed' && (
              <>
                <IconButton
                  size="xs"
                  variant="primary"
                  icon="check"
                  label="Losschicken"
                  onClick={() => onAnswer(order.id, true)}
                />
                <IconButton
                  size="xs"
                  icon="close"
                  label="Verwerfen"
                  onClick={() => onAnswer(order.id, false)}
                />
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

const firstName = (name: string) => name.split(' ')[0] ?? name;

function Mark({ state }: { state: CallOrder['state'] }) {
  if (state === 'running')
    return (
      <span className="flex size-4 shrink-0 items-center justify-center" aria-label="Läuft">
        <span className="size-2 animate-pulse rounded-full bg-info" />
      </span>
    );
  return (
    <Icon
      name={state === 'proposed' ? 'schedule' : state === 'done' ? 'checkCircle' : 'error'}
      size={16}
      label={
        state === 'proposed' ? 'Vorgeschlagen' : state === 'done' ? 'Fertig' : 'Fehlgeschlagen'
      }
      className={cn(
        'shrink-0',
        state === 'proposed' && 'text-fg-muted',
        state === 'done' && 'text-success',
        state === 'failed' && 'text-danger',
      )}
    />
  );
}
