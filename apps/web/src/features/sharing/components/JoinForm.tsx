import { useState } from 'react';
import { useNavigate } from 'react-router';
import { routes } from '@/app/routes';
import { useJoinInvite } from '@/lib/queries';
import { Button, Icon, TextField } from '@/ui';

const MAX_NAME_LENGTH = 80;

/** Name (+ optional e-mail) form of the guest entry (C2). Joining sets the guest session cookie. */
export function JoinForm({ token }: { token: string }) {
  const navigate = useNavigate();
  const join = useJoinInvite(token);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [showEmail, setShowEmail] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  const submit = () => {
    const trimmedName = name.trim();
    if (trimmedName === '') {
      setNameError('Bitte gib deinen Namen an.');
      return;
    }
    const trimmedEmail = email.trim();
    join.mutate(
      { name: trimmedName, email: trimmedEmail === '' ? undefined : trimmedEmail },
      {
        onSuccess: ({ viewer }) => {
          if (viewer.kind === 'guest') void navigate(routes.deck(viewer.deckId), { replace: true });
        },
      },
    );
  };

  return (
    <form
      noValidate
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <TextField
        aria-label="Dein Name"
        placeholder="Dein Name"
        autoComplete="name"
        autoFocus
        required
        maxLength={MAX_NAME_LENGTH}
        value={name}
        onChange={(event) => {
          setName(event.target.value);
          setNameError(null);
        }}
        error={nameError}
      />
      {showEmail ? (
        <TextField
          type="email"
          aria-label="E-Mail (optional)"
          placeholder="E-Mail (optional)"
          autoComplete="email"
          autoFocus
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          hint="Nur für Benachrichtigungen zu Antworten."
        />
      ) : (
        <button
          type="button"
          aria-expanded={false}
          onClick={() => setShowEmail(true)}
          className="inline-flex items-center gap-1 self-start text-xs text-fg-subtle hover:text-fg"
        >
          <Icon name="add" size={14} />
          E-Mail angeben (optional)
        </button>
      )}
      {join.error && (
        <p role="alert" className="text-xs text-danger">
          {join.error.message}
        </p>
      )}
      <Button type="submit" size="lg" loading={join.isPending} className="w-full">
        Review starten
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="self-center"
        onClick={() => void navigate(routes.reviews())}
      >
        oder anmelden
      </Button>
    </form>
  );
}
