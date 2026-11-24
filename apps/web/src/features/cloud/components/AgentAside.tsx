import {
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import { createStoredStore } from '@/lib/storage';
import { BarHandle } from '@/shell/BarHandle';
import { GlassPanel, IconButton } from '@/ui';

/** The cards' width beside an agent's chat as one pulls it – one for Cloud and Sender, kept in this browser. */
const KEY = 'slider.agent.asideWidth';
const MIN = 300;
/** What the chat keeps at least when the cards are pulled wide (its gap included). */
const CHAT_MIN = 380;

/** A width pulled with a handle, kept in this browser under `key`; `null`: the default. */
export function useKeptWidth(key: string) {
  const [width, setWidth] = useState<number | null>(() => {
    try {
      const kept = Number(localStorage.getItem(key));
      return kept > 0 ? kept : null;
    } catch {
      return null;
    }
  });
  const keep = (next: number | null) => {
    setWidth(next);
    try {
      if (next === null) localStorage.removeItem(key);
      else localStorage.setItem(key, String(next));
    } catch {
      // No storage: the width holds for this page only.
    }
  };
  return [width, keep] as const;
}

/**
 * The handle between an agent's chat and its cards (as Figma's panels): pulled, the cards take
 * that width; double-click back to `standard`. `beside`: chat and cards stand side by side –
 * stacked or the cards hidden, there is nothing to share and no handle. `kept`: another page's
 * column with its own width and name (the AI beside a mail).
 */
export function useAgentAside(
  beside: boolean,
  standard: number,
  /** The cards' column. */
  ref: RefObject<HTMLDivElement | null>,
  kept: { key: string; label: string; even?: boolean } = {
    key: KEY,
    label: 'Größe von Chat und Karten',
  },
): { style: CSSProperties | undefined; handle: ReactNode } {
  const [width, setWidth] = useKeptWidth(kept.key);
  if (!beside) return { style: undefined, handle: null };
  return {
    style: { width: width ?? standard, maxWidth: `calc(100% - ${CHAT_MIN}px)` },
    handle: (
      <BarHandle
        axis="x"
        label={kept.label}
        target={ref}
        min={MIN}
        max={() => Math.max(MIN, (ref.current?.parentElement?.clientWidth ?? 0) - CHAT_MIN)}
        onSize={setWidth}
        onReset={() => setWidth(null)}
        even={kept.even}
      />
    ),
  };
}

/** An agent's cards beside its chat, shown or hidden: remembered in this browser, for every agent. */
const cardsStore = createStoredStore<boolean>({
  key: 'slider.agent.aside',
  parse: (value) => value !== false,
  fallback: true,
});
export function useAgentCardsShown() {
  const shown = useSyncExternalStore(cardsStore.subscribe, cardsStore.getSnapshot);
  return [shown, cardsStore.set] as const;
}

/**
 * The switch for the AI's column at the tool bar's end – as „KI zum Kalender“ and „KI zur Mail“:
 * the same mark, in its glass; `bare` in a page's head beside its other buttons (a chat's).
 */
export function AsideToggle({
  shown,
  onToggle,
  label,
  title,
  bare = false,
}: {
  shown: boolean;
  onToggle: () => void;
  label: string;
  title?: string;
  bare?: boolean;
}) {
  const button = (
    <IconButton
      icon={shown ? 'aiPanelOpen' : 'aiPanel'}
      label={label}
      title={title}
      size="sm"
      variant={bare ? 'subtle' : undefined}
      active={shown}
      aria-expanded={shown}
      onClick={onToggle}
    />
  );
  if (bare) return button;
  return <GlassPanel className="flex shrink-0 p-1">{button}</GlassPanel>;
}
