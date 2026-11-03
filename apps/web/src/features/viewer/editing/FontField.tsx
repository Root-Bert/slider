import { Icon } from '@/ui';
import { fontCss } from './live/fonts';
import { useTryList } from './TryList';

/**
 * The font: a field with its name in its own face, a click (↓, ↵, Space) opens the list of fonts,
 * each written in itself – hovered or stepped through, the text shows each at once (`useTryList`).
 */
export function FontField({
  value,
  fonts,
  onTry,
  onPick,
  onDone,
}: {
  /** `null`: the text has several. */
  value: string | null;
  fonts: readonly string[];
  onTry: (font: string | null) => void;
  onPick: (font: string) => void;
  /** Takes the focus once the list closes (the text typed in); else the field keeps it. */
  onDone?: () => void;
}) {
  const { toggleList, triggerProps, wrapperRef, onTriggerKey, panel } = useTryList({
    items: fonts,
    value,
    label: 'Schrift',
    onTry,
    onPick,
    onDone,
    typed: (font, text) => font.toLowerCase().startsWith(text),
    render: (font) => (
      <span className="truncate text-[15px]" style={{ fontFamily: fontCss(font) }}>
        {font}
      </span>
    ),
  });

  return (
    <div ref={wrapperRef} className="flex min-w-0 flex-1">
      <button
        type="button"
        {...triggerProps}
        aria-label={`Schrift: ${value ?? 'Gemischt'}`}
        title="Schrift"
        onClick={toggleList}
        onKeyDown={onTriggerKey}
        className="field-well focus-field flex h-8 min-w-0 flex-1 items-center gap-1 rounded-control-sm pr-1 pl-2 text-left text-sm"
      >
        <span
          className="min-w-0 flex-1 truncate"
          style={value ? { fontFamily: fontCss(value) } : undefined}
        >
          {value ?? 'Gemischt'}
        </span>
        <Icon name="expandMore" size={16} className="shrink-0 text-fg-subtle" />
      </button>
      {panel}
    </div>
  );
}
