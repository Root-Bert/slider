import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { cn } from './cn';
import { decimalsOf, steppedValue, useScrub, type NumberRange, type StepKeys } from './scrub';

/**
 * The handle in front of a number: drag it sideways to change the number (`useScrub`). Its own
 * mark (a letter like „X“), else two small arrows pointing apart.
 */
export function ScrubHandle({
  ref,
  label,
  dragging = false,
  children,
}: {
  ref: RefObject<HTMLSpanElement | null>;
  label: string;
  dragging?: boolean;
  children?: ReactNode;
}) {
  return (
    <span
      ref={ref}
      aria-hidden
      title={`${label}: ziehen oder scrollen`}
      data-scrub-handle=""
      className={cn(
        'flex h-full shrink-0 cursor-ew-resize touch-none items-center justify-center px-1 text-xs text-fg-subtle select-none hover:text-fg',
        dragging && 'text-fg',
      )}
    >
      {children ?? (
        <svg viewBox="0 0 12 10" width={12} height={10} fill="currentColor">
          <path d="M0 5 L4 1.5 V8.5 Z M12 5 L8 1.5 V8.5 Z" />
        </svg>
      )}
    </span>
  );
}

/**
 * Every number of the editor and its panels: typed (taken at once once it is a number in range,
 * the field keeps what was typed till it is left), ↑ ↓ step it, the wheel steps it while the
 * pointer is over it, and its handle – in front, a mark of its own or two arrows – is dragged
 * sideways like Figma's (⇧ ten steps, ⌥ a tenth). Each change goes out as it comes (`onChange`):
 * the caller coalesces them into one step, as for typing.
 */
export function NumberField({
  value,
  onChange,
  label,
  title,
  unit,
  mark,
  decimals,
  align = 'right',
  size = 'sm',
  className,
  ...range
}: NumberRange & {
  /** `null`: several values (or none) – the field is empty. */
  value: number | null;
  onChange: (value: number) => void;
  /** Its name, read out (and the handle's tooltip). */
  label: string;
  title?: string;
  /** After the number: „pt“, „%“, „°“. */
  unit?: string;
  /** In front of the number, as its handle: „X“, „Y“. */
  mark?: ReactNode;
  /** Shown to this many decimals at most (by default the step's). */
  decimals?: number;
  align?: 'right' | 'center';
  /** `sm`: 28 px high, `md`: 32 px. */
  size?: 'sm' | 'md';
  className?: string;
}) {
  const { min, max, wrap } = range;
  const [draft, setDraft] = useState<string | null>(null);
  const fieldRef = useRef<HTMLSpanElement>(null);
  const handleRef = useRef<HTMLSpanElement>(null);
  const places = decimals ?? decimalsOf(range.step ?? 1);
  const shown = value === null ? '' : String(Number(value.toFixed(places)));
  // Steps faster than the answer comes (a quick drag) go on from the last one, not the shown one.
  const current = useRef(value);
  useLayoutEffect(() => {
    current.current = value;
  }, [value]);
  const step = (direction: 1 | -1, keys: StepKeys) => {
    const from = current.current;
    if (from === null) return;
    setDraft(null);
    const next = steppedValue(from, direction, keys, range);
    current.current = next;
    if (next !== from) onChange(next);
  };
  const { dragging } = useScrub(fieldRef, handleRef, step);
  return (
    <span
      ref={fieldRef}
      className={cn(
        'field-well focus-field flex shrink-0 items-center rounded-control-sm pr-1.5',
        size === 'sm' ? 'h-7 w-16' : 'h-8 w-18',
        className,
      )}
    >
      <ScrubHandle ref={handleRef} label={label} dragging={dragging}>
        {mark}
      </ScrubHandle>
      <input
        aria-label={label}
        title={title ?? label}
        inputMode={places > 0 || min < 0 ? 'decimal' : 'numeric'}
        value={draft ?? shown}
        placeholder="–"
        onChange={(event) => {
          setDraft(event.target.value);
          const next = Number(event.target.value.replace(',', '.'));
          // As typed: empty or a lone minus sign kept until it is a number.
          if (!/\d/.test(event.target.value) || !Number.isFinite(next)) return;
          if (wrap) onChange(((next % wrap) + wrap) % wrap);
          else if (next >= min && next <= max) onChange(next);
        }}
        onBlur={() => setDraft(null)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          else if (event.key === 'Escape' && draft !== null) {
            event.stopPropagation();
            setDraft(null);
          } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault();
            step(event.key === 'ArrowUp' ? 1 : -1, event);
          }
        }}
        className={cn(
          'w-full min-w-0 bg-transparent text-xs text-fg tabular-nums outline-none',
          align === 'right' ? 'text-right' : 'text-center',
        )}
      />
      {unit && <span className="pl-0.5 text-xs text-fg-subtle">{unit}</span>}
    </span>
  );
}
