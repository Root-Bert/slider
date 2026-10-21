import { useState } from 'react';
import { USER_NAME_MAX } from '@slider/shared';
import { useRegisterPasskey, useUpdateMe } from '@/lib/api';
import { isPasskeyCancel, passkeyErrorMessage, passkeysSupported } from '@/lib/passkeys';
import { CenteredCard, CenteredLayout } from '@/shell/layouts/CenteredLayout';
import { Button, ErrorText, Icon, PasskeyMark, TextField } from '@/ui';
import { loadPage } from '../lib/load-page';

/** A new account by mail: how others see you, and a passkey so the next login needs no mail. */
export function EmailWelcome({ redirectTo }: { redirectTo: string }) {
  const [name, setName] = useState('');
  const [supported] = useState(passkeysSupported);
  const passkey = useRegisterPasskey();
  const updateMe = useUpdateMe();
  const passkeyError =
    passkey.error && !isPasskeyCancel(passkey.error) ? passkeyErrorMessage(passkey.error) : null;
  const error = updateMe.error?.message ?? passkeyError;

  const finish = () => {
    const trimmed = name.trim();
    if (!trimmed) return loadPage(redirectTo);
    updateMe.mutate({ name: trimmed }, { onSuccess: () => loadPage(redirectTo) });
  };

  return (
    <CenteredLayout docTitle="Willkommen | Slider">
      <CenteredCard
        icon={<Icon name="person" size={28} />}
        title="Dein Konto ist da"
        message="Sag noch, wie andere dich sehen – und leg einen Passkey an, dann meldest du dich künftig ohne Mail an."
      >
        <form
          className="flex w-full flex-col gap-3 text-left"
          onSubmit={(event) => {
            event.preventDefault();
            finish();
          }}
        >
          <TextField
            label="Dein Name"
            placeholder="Vor- und Nachname"
            autoComplete="name"
            autoFocus
            maxLength={USER_NAME_MAX}
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={updateMe.isPending}
          />
          {supported && (
            <Button
              variant="secondary"
              size="lg"
              className="w-full gap-2.5"
              loading={passkey.isPending}
              disabled={passkey.isSuccess}
              onClick={() => passkey.mutate()}
            >
              {!passkey.isPending &&
                (passkey.isSuccess ? <Icon name="check" size={18} /> : <PasskeyMark size={18} />)}
              {passkey.isSuccess ? 'Passkey angelegt' : 'Passkey anlegen'}
            </Button>
          )}
          <Button
            type="submit"
            size="lg"
            className="w-full"
            loading={updateMe.isPending || updateMe.isSuccess}
          >
            Weiter
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="mx-auto"
            onClick={() => loadPage(redirectTo)}
          >
            Später
          </Button>
          {error && (
            <ErrorText role="alert" size="xs">
              {error}
            </ErrorText>
          )}
        </form>
      </CenteredCard>
    </CenteredLayout>
  );
}
