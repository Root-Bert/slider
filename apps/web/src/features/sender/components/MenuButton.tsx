import { createContext, useContext } from 'react';
import { IconButton } from '@/ui';

export interface SenderMenu {
  open: boolean;
  toggle: () => void;
  /** What the panel shows – Sender's conversations, Cloud's places. */
  label?: string;
}

export const SenderMenuContext = createContext<SenderMenu | null>(null);

/**
 * Below the wide layout the side bar is a panel: its button stands at the start of the
 * page's head (a floating one would lie over the messages and the composer) – in Sender and
 * in Cloud alike.
 */
export function MenuButton() {
  const menu = useContext(SenderMenuContext);
  if (!menu) return null;
  return (
    <IconButton
      icon="menu"
      label={menu.label ?? 'Unterhaltungen zeigen'}
      size="sm"
      expanded={menu.open}
      onClick={menu.toggle}
      className="-ml-1.5 lg:hidden"
    />
  );
}
