import type { SelectHTMLAttributes } from 'react';
import { cn } from './cn';
import { Icon } from './Icon';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

interface SelectProps<T extends string> extends Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  'value' | 'onChange' | 'size'
> {
  value: T;
  onChange: (value: T) => void;
  options: readonly SelectOption<T>[];
  size?: 'sm' | 'md';
}

/**
 * Glass dropdown built on the native <select>: keyboard, screen-reader and mobile pickers for free.
 * Needs an accessible name via `aria-label` or a `<label htmlFor>`. Candidate for `ui/`.
 */
export function Select<T extends string>({
  value,
  onChange,
  options,
  size = 'md',
  className,
  ...props
}: SelectProps<T>) {
  return (
    <span className={cn('relative inline-flex', className)}>
      <select
        value={value}
        onChange={(event) => {
          const next = options.find((option) => option.value === event.target.value);
          if (next) onChange(next.value);
        }}
        className={cn(
          'glass w-full cursor-pointer appearance-none pr-8 text-fg-muted transition-colors hover:text-fg',
          'disabled:cursor-default disabled:opacity-50',
          size === 'md'
            ? 'h-9 rounded-control pl-3.5 text-[13px]'
            : 'h-7 rounded-chip pl-2.5 text-xs',
        )}
        {...props}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <Icon
        name="expandMore"
        size={size === 'md' ? 18 : 16}
        className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-fg-subtle"
      />
    </span>
  );
}
