import { useMe, useOtherAccounts } from '@/lib/api';
import { Avatar, Button, ErrorText } from '@/ui';
import { useAccountSwitch } from '../hooks/useAccountSwitch';

/**
 * Where the account in use gets no further (no access, an invitation for someone else): the other
 * accounts signed in on this browser, each a button that switches to it and opens `to` again.
 * Nothing with only one account signed in. `only`: just the account with this address.
 */
export function OtherAccounts({
  to,
  label = (email) => `Als ${email} öffnen`,
  only,
}: {
  to: string;
  label?: (email: string) => string;
  only?: string | null;
}) {
  const signedIn = Boolean(useMe().data?.user);
  const others = useOtherAccounts(signedIn).data ?? [];
  const accounts = useAccountSwitch();
  const shown = only
    ? others.filter((other) => other.user.email.toLowerCase() === only.toLowerCase())
    : others;
  if (shown.length === 0) return null;
  return (
    <div className="flex w-full flex-col gap-2">
      {shown.map((other) => (
        <Button
          key={other.user.id}
          variant="secondary"
          size="lg"
          className="w-full"
          disabled={accounts.busy}
          onClick={() => accounts.switchTo(other.user.id, to)}
        >
          <Avatar author={{ ...other.user, type: 'owner' }} size={20} nativeTitle={false} />
          <span className="min-w-0 truncate">{label(other.user.email)}</span>
        </Button>
      ))}
      {accounts.error && (
        <ErrorText role="alert" size="xs">
          {accounts.error}
        </ErrorText>
      )}
      {accounts.dialog}
    </div>
  );
}
