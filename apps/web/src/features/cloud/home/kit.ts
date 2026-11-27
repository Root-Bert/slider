import type { ReactNode } from 'react';
import type { IconName } from '@/ui';
import type { BoardSpec } from './layout';

/** What the list of widgets says of each: its name, its mark, a line about it. */
export interface WidgetInfo {
  label: string;
  icon: IconName;
  about: string;
}

/**
 * A page of widgets as `HomeBoard` draws it: its spec (kinds, defaults, where it is kept), what
 * the panel says of each kind, and what each draws – „Zuletzt“ in Cloud, „Aktuell“ and a
 * mailbox's „Übersicht“ in Sender.
 */
export interface BoardKit {
  spec: BoardSpec;
  info: Readonly<Record<string, WidgetInfo>>;
  views: Readonly<Record<string, () => ReactNode>>;
}
