import { useState, type FormEvent } from 'react';
import { useCreateDataRequest } from '@/lib/api';
import { routes } from '@/lib/routes';
import { CenteredCard, CenteredLayout } from '@/shell/layouts/CenteredLayout';
import { Button, ErrorText, Icon, SegmentedControl, TextField, TextLink } from '@/ui';

type Purpose = 'export' | 'delete';

const PURPOSES = [
  { value: 'export', label: 'Kopie meiner Daten' },
  { value: 'delete', label: 'Daten löschen' },
] as const;

/**
 * `/datenanfrage` – ask for a copy or the deletion of one's data without login (BER-146). Slider
 * mails a link to the address entered; whoever has that mailbox is the person. The answer is the
 * same whether Slider knows the address or not.
 */
export function Component() {
  const [email, setEmail] = useState('');
  const [purpose, setPurpose] = useState<Purpose>('export');
  const create = useCreateDataRequest();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (email.trim()) create.mutate({ email: email.trim(), purpose });
  };

  return (
    <CenteredLayout
      docTitle="Datenanfrage | Slider"
      logoLink={{ to: routes.reviews(), label: 'Slider' }}
    >
      {create.isSuccess ? (
        <CenteredCard
          icon={<Icon name="send" size={24} />}
          title="Schau in dein Postfach"
          message={`Falls Slider Daten zu ${email.trim()} speichert, ist gerade eine Mail mit einem Link dorthin unterwegs. Der Link gilt ${purpose === 'delete' ? '24 Stunden' : '7 Tage'}. Keine Mail bekommen? Dann sind zu dieser Adresse keine Daten gespeichert – oder schau im Spam-Ordner nach.`}
        >
          <TextLink to={routes.login()}>Zur Anmeldung</TextLink>
        </CenteredCard>
      ) : (
        <CenteredCard
          icon={<Icon name="lock" size={24} />}
          title="Deine Daten anfragen"
          message="Du kannst dich nicht mehr anmelden? Hier bekommst du eine Kopie deiner Daten oder lässt sie löschen. Mit Zugang geht beides auch direkt unter „Konto & Anmeldung“."
        >
          <form noValidate onSubmit={submit} className="flex w-full flex-col gap-4 text-left">
            <SegmentedControl
              label="Was möchtest du?"
              segments={PURPOSES}
              value={purpose}
              onChange={setPurpose}
              track="soft"
            />
            <TextField
              label="E-Mail-Adresse"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <Button type="submit" size="lg" loading={create.isPending} disabled={!email.trim()}>
              Link anfordern
            </Button>
            {create.error && <ErrorText>{create.error.message}</ErrorText>}
          </form>
        </CenteredCard>
      )}
      <div className="flex flex-col gap-2 text-left text-body leading-5 text-fg-subtle">
        <p className="font-medium text-fg-muted">Wie wird geprüft, dass du es bist?</p>
        <p>
          Slider schickt den Link nur an die Adresse, die du eingibst. Herunterladen oder löschen
          kann nur, wer dieses Postfach hat – mehr musst du nicht nachweisen, kein Ausweis, kein
          Formular. Wer eine fremde Adresse eingibt, löst nur eine Mail an diese Person aus und
          sieht selbst nichts.
        </p>
        <p>
          Gelöscht wird erst, wenn du es im Link bestätigst. Kommentare in Präsentationen anderer
          bleiben dann ohne deinen Namen erhalten.
        </p>
        <p>
          Namen aus PowerPoint-Dateien hängen an keiner Adresse – dafür wende dich an die Person,
          der die Präsentation gehört, oder an den Betreiber.
        </p>
      </div>
    </CenteredLayout>
  );
}
