/**
 * What „Neu“ opens in the page, picked there: an agent (its order typed where one's agents are) or
 * a group (`gruppe`; `direkt` is the same form – older links and desktop builds still say it, and
 * `kanal`: an area is its one chat, there is no other to make). One person is found by the side
 * bar's search: a click there starts the conversation.
 */
export type NewKind = 'agent' | 'kanal' | 'gruppe' | 'direkt';
export const NEW_KINDS: readonly NewKind[] = ['agent', 'kanal', 'gruppe', 'direkt'];

/** `base`: the page the form opens over – Sender's (`routes.messages`) or Cloud's. */
export const newPath = (base: string, kind: NewKind, areaId?: string) =>
  `${base}?neu=${kind}${areaId ? `&bereich=${areaId}` : ''}`;

export const isNewKind = (value: string | null): value is NewKind =>
  NEW_KINDS.includes(value as NewKind);

/** What can be picked on the page – `direkt` and `kanal` are shown as „Gruppe“. */
export type PickedKind = Exclude<NewKind, 'direkt' | 'kanal'>;

/** Agents for whoever may have them work, groups always. */
export const newKinds = (agents: boolean): PickedKind[] => [
  ...(agents ? (['agent'] as const) : []),
  'gruppe',
];
