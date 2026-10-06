import type { ReviewLink } from '@slider/shared';
import { absoluteUrl, routes } from '@/app/routes';
import { Button, TextField } from '@/ui';
import { useCopyToClipboard } from '../hooks/useCopyToClipboard';

interface ShareLinkFieldProps {
  link: ReviewLink | null;
  loading: boolean;
  onCreate: () => void;
}

const COPY_LABELS = { idle: 'Kopieren', copied: 'Kopiert ✓', failed: 'Nicht kopiert' } as const;

/** Read-only review URL with a copy button; offers a fresh link after a revoke. */
export function ShareLinkField({ link, loading, onCreate }: ShareLinkFieldProps) {
  const { state, copy } = useCopyToClipboard();
  const url = link ? absoluteUrl(routes.invite(link.token)) : '';

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-end gap-2">
        <TextField
          label="Review-Link"
          icon="link"
          size="lg"
          readOnly
          value={url}
          placeholder={loading ? 'Link wird erstellt…' : 'Kein aktiver Link'}
          onFocus={(event) => event.currentTarget.select()}
          className="min-w-0 flex-1"
        />
        {link || loading ? (
          <Button variant="secondary" size="lg" disabled={!link} onClick={() => void copy(url)}>
            {COPY_LABELS[state]}
          </Button>
        ) : (
          <Button variant="secondary" size="lg" icon="add" onClick={onCreate}>
            Neuer Link
          </Button>
        )}
      </div>
      <p role="status" className="sr-only">
        {state === 'copied'
          ? 'Link in die Zwischenablage kopiert'
          : state === 'failed'
            ? 'Kopieren fehlgeschlagen'
            : ''}
      </p>
    </div>
  );
}
