import { useState } from 'react';
import { Button, TextField } from '@/ui';
import { parseInviteToken } from '../lib/plan';

/** Paste an invite link or code → the `/join/:token` page with its preview and "Beitreten". */
export function JoinByCodeForm({ onJoin }: { onJoin: (token: string) => void }) {
  const [value, setValue] = useState('');
  const [touched, setTouched] = useState(false);
  const token = parseInviteToken(value);
  const error =
    touched && value.trim() !== '' && !token
      ? 'Das ist kein Einladungslink. Er sieht so aus: …/join/abc123…'
      : null;

  return (
    <form
      noValidate
      className="flex flex-col gap-2 sm:flex-row sm:items-start"
      onSubmit={(event) => {
        event.preventDefault();
        setTouched(true);
        if (token) onJoin(token);
      }}
    >
      <TextField
        aria-label="Einladungslink oder Code"
        icon="link"
        size="lg"
        placeholder="Einladungslink oder Code"
        autoComplete="off"
        value={value}
        error={error}
        onChange={(event) => setValue(event.target.value)}
        className="min-w-0 flex-1"
      />
      <Button type="submit" size="lg" variant="secondary" disabled={value.trim() === ''}>
        Beitreten
      </Button>
    </form>
  );
}
