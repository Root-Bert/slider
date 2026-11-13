import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { answerAppRequest, useAppRequest, useMe } from '@/lib/api';
import { CenteredCard, CenteredLayout } from '@/shell/layouts/CenteredLayout';
import { Button, ErrorText, Icon, Select } from '@/ui';

const ALL = '__all__';
const DOC_TITLE = 'KI-App verbinden | Slider';

/**
 * `/verbinden?anfrage=…` – an AI app (Claude, ChatGPT …) asks to be let into the account over
 * MCP (OAuth, `routes/app-connections.ts`). Signed in (the account gate sees to that), the
 * person sees which app, where it goes back to, picks all workspaces or one, and allows or
 * declines; either way the browser goes back to the app. Never on opening – no page can let an
 * app in unasked.
 */
export function Component() {
  const [params] = useSearchParams();
  const request = params.get('anfrage') ?? '';
  const asked = useAppRequest(request);
  const { data: me } = useMe();
  const [workspaceId, setWorkspaceId] = useState(ALL);
  const [busy, setBusy] = useState<'approve' | 'deny' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<'approve' | 'deny' | null>(null);

  if (!request || asked.isError) {
    return (
      <CenteredLayout docTitle={DOC_TITLE}>
        <CenteredCard
          icon={<Icon name="error" size={28} />}
          title="Diese Anfrage gilt nicht mehr"
          message={asked.error?.message ?? 'Starte die Verbindung in der KI-App noch einmal.'}
        />
      </CenteredLayout>
    );
  }
  if (!asked.data) {
    return (
      <CenteredLayout docTitle={DOC_TITLE}>
        <CenteredCard
          icon={<Icon name="autoAwesome" size={28} />}
          title="KI-App verbinden"
          message="Einen Moment …"
        />
      </CenteredLayout>
    );
  }

  const { clientName, redirectHost, workspaces } = asked.data;
  const answer = async (choice: 'approve' | 'deny') => {
    setBusy(choice);
    setError(null);
    try {
      const { redirectUrl } = await answerAppRequest(
        choice,
        request,
        workspaceId === ALL ? null : workspaceId,
      );
      setDone(choice);
      window.location.assign(redirectUrl);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Das hat nicht geklappt.');
      setBusy(null);
    }
  };

  if (done) {
    return (
      <CenteredLayout docTitle={DOC_TITLE}>
        <CenteredCard
          icon={<Icon name={done === 'approve' ? 'checkCircle' : 'close'} size={28} />}
          title={done === 'approve' ? `${clientName} ist verbunden` : 'Abgelehnt'}
          message="Zurück zur App … Du kannst dieses Fenster schließen."
        />
      </CenteredLayout>
    );
  }

  return (
    <CenteredLayout docTitle={DOC_TITLE}>
      <CenteredCard
        icon={<Icon name="autoAwesome" size={28} />}
        title={`${clientName} mit Slider verbinden?`}
        message={
          <>
            {clientName} darf dann
            {me?.user ? ` als ${me.user.name}` : ''} deine Präsentationen, Kommentare und das
            Material lesen, Notizen, Links und Dateien auf Boards legen, kommentieren und neue
            Präsentationen erstellen. Zurück geht es an{' '}
            <strong className="font-medium text-fg">{redirectHost}</strong>.
          </>
        }
      >
        <div className="flex w-full flex-col gap-3">
          {workspaces.length > 1 && (
            <label className="flex flex-col gap-1.5 text-left text-xs text-fg-subtle">
              Workspaces
              <Select
                value={workspaceId}
                onChange={setWorkspaceId}
                options={[
                  { value: ALL, label: 'Alle Workspaces' },
                  ...workspaces.map((workspace) => ({
                    value: workspace.id,
                    label: workspace.name,
                  })),
                ]}
              />
            </label>
          )}
          <Button
            size="lg"
            glow
            loading={busy === 'approve'}
            disabled={busy !== null}
            className="w-full"
            onClick={() => void answer('approve')}
          >
            Zulassen
          </Button>
          <Button
            variant="ghost"
            loading={busy === 'deny'}
            disabled={busy !== null}
            className="w-full"
            onClick={() => void answer('deny')}
          >
            Ablehnen
          </Button>
          <p className="text-xs text-fg-subtle">
            Unter Konto → KI-Apps kannst du die Verbindung jederzeit entfernen.
          </p>
          {error && (
            <ErrorText role="alert" size="xs">
              {error}
            </ErrorText>
          )}
        </div>
      </CenteredCard>
    </CenteredLayout>
  );
}
