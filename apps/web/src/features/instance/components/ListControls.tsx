import type { ReactNode } from 'react';
import { INSTANCE_PAGE_SIZE } from '@slider/shared';
import { Button, cn, TextField } from '@/ui';
import type { Column } from '../lib/table';

export function SearchField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <search>
      <TextField
        type="search"
        icon="search"
        aria-label={label}
        placeholder={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </search>
  );
}

/** "51–100 von 230" with back and forth – only when there is more than one page. */
export function Pager({
  offset,
  total,
  onChange,
}: {
  offset: number;
  total: number;
  onChange: (offset: number) => void;
}) {
  if (total <= INSTANCE_PAGE_SIZE) return null;
  const last = Math.min(offset + INSTANCE_PAGE_SIZE, total);
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-fg-subtle tabular-nums">
        {offset + 1}–{last} von {total}
      </span>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="secondary"
          icon="chevronLeft"
          disabled={offset === 0}
          onClick={() => onChange(Math.max(0, offset - INSTANCE_PAGE_SIZE))}
        >
          Zurück
        </Button>
        <Button
          size="sm"
          variant="secondary"
          trailingIcon="chevronRight"
          disabled={last >= total}
          onClick={() => onChange(offset + INSTANCE_PAGE_SIZE)}
        >
          Weiter
        </Button>
      </div>
    </div>
  );
}

/** A dashboard table: quiet header, hairline rows, scrolling sideways on phones. */
export function DataTable({
  label,
  columns,
  children,
}: {
  label: string;
  columns: readonly Column[];
  children: ReactNode;
}) {
  return (
    // Rows reach 12px past the text on both sides, so their hover wash has room.
    <div className="-mx-6 overflow-x-auto px-3">
      <table className="w-full min-w-[640px] border-collapse text-body" aria-label={label}>
        <thead>
          <tr className="border-b border-hairline">
            {columns.map((column) => (
              <th
                key={column.label}
                scope="col"
                className={cn(
                  'px-3 pb-2.5 text-xs font-medium text-fg-subtle',
                  column.numeric ? 'text-right' : 'text-left',
                  column.className,
                )}
              >
                {column.hidden ? <span className="sr-only">{column.label}</span> : column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
