import { formatFileSize, pluralize } from '@/lib/format';
import { routes } from '@/lib/routes';
import { useCloudOverview } from '@/lib/api';
import { ButtonLink, ErrorText, LoadingState, Section } from '@/ui';

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2 rounded-panel bg-surface-1 p-4">
      <span className="text-display leading-none font-semibold text-fg tabular-nums">{value}</span>
      <span className="text-body text-fg-muted">{label}</span>
      {hint && <span className="text-xs text-fg-subtle">{hint}</span>}
    </div>
  );
}

/**
 * Cloud's part of a workspace, in numbers: its files and what they take, per area. The whole
 * evaluation is Cloud's own „Übersicht“ – here stands what the settings and the usage need.
 * Only admins see the evaluation; everyone else gets the one number they may know.
 */
export function CloudUsage({
  workspaceId,
  admin,
  fileBytes,
}: {
  workspaceId: string;
  admin: boolean;
  /** What the files take, known without the evaluation. */
  fileBytes?: number;
}) {
  return admin ? (
    <Evaluation workspaceId={workspaceId} />
  ) : (
    <Section title="Dateien" description="Die Auswertung sieht nur ein Admin.">
      {fileBytes !== undefined && (
        <div className="flex">
          <Tile label="Speicher in der Cloud" value={formatFileSize(fileBytes)} />
        </div>
      )}
      <Links workspaceId={workspaceId} admin={false} />
    </Section>
  );
}

function Links({ workspaceId, admin }: { workspaceId: string; admin: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      <ButtonLink to={routes.cloud(workspaceId)} variant="secondary" size="sm" icon="folder">
        Zu den Dateien
      </ButtonLink>
      <ButtonLink to={routes.cloudAreas(workspaceId)} variant="secondary" size="sm">
        Bereiche
      </ButtonLink>
      {admin && (
        <ButtonLink to={routes.cloudOverview(workspaceId)} variant="secondary" size="sm">
          Übersicht
        </ButtonLink>
      )}
    </div>
  );
}

function Evaluation({ workspaceId }: { workspaceId: string }) {
  const overview = useCloudOverview(workspaceId);
  if (overview.isPending) return <LoadingState padding="lg" />;
  if (overview.isError) return <ErrorText role="alert">{overview.error.message}</ErrorText>;
  const { totals, byArea } = overview.data;
  const largest = Math.max(1, ...byArea.map((area) => area.bytes));
  return (
    <>
      <Section title="Dateien" description="Alles, was in der Cloud liegt.">
        <div className="flex flex-col gap-3 sm:flex-row">
          <Tile
            label={totals.files === 1 ? 'Datei' : 'Dateien'}
            value={String(totals.files)}
            hint={pluralize(totals.folders, 'Ordner', 'Ordner')}
          />
          <Tile
            label="Speicher"
            value={formatFileSize(totals.bytes)}
            hint={`davon ${formatFileSize(totals.versionBytes)} ältere Fassungen`}
          />
          <Tile
            label="Im Papierkorb"
            value={formatFileSize(totals.trashBytes)}
            hint={pluralize(totals.trashCount, 'Eintrag', 'Einträge')}
          />
        </div>
        <Links workspaceId={workspaceId} admin />
      </Section>
      <Section
        title="Bereiche"
        description={`${pluralize(totals.links, 'Link', 'Links')} nach außen, ${pluralize(totals.shares, 'Freigabe', 'Freigaben')} insgesamt.`}
      >
        <ul className="flex flex-col gap-3.5">
          {byArea.map((area) => (
            <li key={area.areaId ?? 'own'} className="flex flex-col gap-1.5">
              <div className="flex items-baseline gap-3 text-body">
                <span className="min-w-0 flex-1 truncate text-fg">{area.name}</span>
                <span className="shrink-0 text-fg-muted tabular-nums">
                  {pluralize(area.files, 'Datei', 'Dateien')} | {formatFileSize(area.bytes)}
                </span>
              </div>
              <div aria-hidden className="h-1 rounded-full bg-surface-2">
                <div
                  className="h-full min-w-1 rounded-full bg-fg/45"
                  style={{ width: `${(area.bytes / largest) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}
