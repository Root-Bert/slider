import { cn, Icon } from '@/ui';
import { GUEST_COMMENT_HINT, useSignInFromGuest } from '../hooks/useSignInFromGuest';

/** "Zum Kommentieren brauchst du ein Konto …" with a sign-in link, e.g. under a thread. */
export function GuestCommentHint({ deckId, className }: { deckId: string; className?: string }) {
  const { leaving, signIn } = useSignInFromGuest(deckId);
  return (
    <p
      className={cn(
        'flex items-start gap-2 rounded-control bg-white/5 px-3 py-2.5 text-[13px] leading-5 text-fg-muted',
        className,
      )}
    >
      <Icon name="lock" size={18} className="mt-px shrink-0 text-fg-subtle" />
      <span>
        {GUEST_COMMENT_HINT}{' '}
        <button
          type="button"
          disabled={leaving}
          onClick={signIn}
          className="font-medium text-fg underline underline-offset-4 hover:text-white disabled:opacity-50 disabled:hover:text-fg"
        >
          Anmelden
        </button>
      </span>
    </p>
  );
}
