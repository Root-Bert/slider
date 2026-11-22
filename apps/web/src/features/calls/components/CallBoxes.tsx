import { useLayoutEffect } from 'react';
import type { CallState } from '@slider/shared';
import { useCallsOrNull } from '../CallProvider';
import { CallDock } from './CallDock';
import { CallOrders } from './CallOrders';

/** One's own call with this agent, while one is in it – `null` otherwise. */
export function useAgentCall(agentId: string | undefined): CallState | null {
  const calls = useCallsOrNull();
  const active = calls?.snap.active;
  const call = active ? calls.snap.calls.get(active.callId) : undefined;
  return call && agentId && !call.channelId && call.agent?.id === agentId ? call : null;
}

/**
 * On the called agent's page the call is a card at the top of the cards beside its chat – the
 * dock's call and orders, each a card (the orders only when there are some); the corner's dock
 * stands back meanwhile. Elsewhere, and for any other call, the dock shows as always.
 */
export function CallBoxes({ call, className }: { call: CallState; className?: string }) {
  const calls = useCallsOrNull();
  const host = calls?.host;
  // Before paint: the corner's dock never shows beside the card.
  useLayoutEffect(() => host?.(call.id), [host, call.id]);
  if (!calls) return null;
  return (
    <div className={className}>
      <CallDock call={call} place="box" />
      <CallOrders
        place="box"
        orders={call.orders}
        ownCall={!call.channelId}
        onAnswer={(orderId, send) => calls.client.answerOrder(orderId, send)}
        onOpen={(agentId) => calls.openAgent(call.workspaceId, agentId)}
      />
    </div>
  );
}
