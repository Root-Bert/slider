import type { Author } from '@slider/shared';
import { Avatar } from '@/ui';

/** „Anna schreibt …“ under the messages – a line that is always there, so nothing jumps. */
export function TypingLine({ people }: { people: readonly Author[] }) {
  const [first, ...more] = people;
  return (
    <p
      aria-live="polite"
      className="-my-1.5 flex h-4 shrink-0 items-center gap-2 px-1 text-xs text-fg-subtle"
    >
      {first && (
        <>
          <Avatar author={first} size={16} nativeTitle={false} />
          {more.length === 0
            ? `${first.name} schreibt …`
            : `${first.name} und ${more.length === 1 ? (more[0]?.name ?? '') : `${more.length} weitere`} schreiben …`}
        </>
      )}
    </p>
  );
}
