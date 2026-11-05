import {
  PROVIDER_LABELS,
  type AiFeature,
  type AiUsageSum,
  type InstanceAiUsage,
  type IntegrationProvider,
} from '@slider/shared';
import { cn, Section } from '@/ui';
import { WorkspaceMark } from '@/features/workspaces';
import { formatCount } from '../lib/period';
import { Figure, PartsBar } from './InsightCards';
import { KpiTile } from './KpiTile';

/** How the dashboard names what the AI was used for, and its colour in the bar. */
const FEATURES: Record<AiFeature, { label: string; color: string }> = {
  edit: { label: 'Folien ändern', color: 'bg-accent-blue' },
  create: { label: 'Präsentationen erstellen', color: 'bg-sage' },
  voice: { label: 'Sprechen mit der KI', color: 'bg-accent-green' },
  live: { label: 'Live-Untertitel', color: 'bg-accent-cyan' },
  recording: { label: 'Aufnahmen abschreiben', color: 'bg-accent-yellow' },
  summary: { label: 'Zusammenfassungen', color: 'bg-accent-violet' },
  image: { label: 'Bilder erzeugen', color: 'bg-accent-red' },
};

const minutes = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });

/** Seconds of audio as minutes: "0,4 min", "38 min", "1,2 Tsd. min". */
function formatMinutes(seconds: number): string {
  const value = seconds / 60;
  return `${value < 100 ? minutes.format(value) : formatCount(Math.round(value))} min`;
}

const tokensOf = (sum: AiUsageSum) =>
  sum.inputTokens + sum.outputTokens + sum.cacheReadTokens + sum.cacheWriteTokens;

const plural = (count: number, one: string, many: string) =>
  `${formatCount(count)} ${count === 1 ? one : many}`;

/** What a group used, in its own units: tokens, minutes of audio, pictures. */
function amountOf(sum: AiUsageSum): string {
  const parts = [
    tokensOf(sum) > 0 && `${formatCount(tokensOf(sum))} Tokens`,
    sum.audioSeconds > 0 && formatMinutes(sum.audioSeconds),
    sum.images > 0 && plural(sum.images, 'Bild', 'Bilder'),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : plural(sum.requests, 'Anfrage', 'Anfragen');
}

/**
 * What the AI used in the dashboard's window, only what is measured: requests, tokens, minutes
 * of audio and pictures as the services report them, by feature, model and workspace, and what
 * the AI did in the decks. No money: list prices would only be guesses.
 */
export function AiUsageSection({ usage, phrase }: { usage: InstanceAiUsage; phrase: string }) {
  const { total, instanceKeys, buckets } = usage;
  const trend = (pick: (bucket: InstanceAiUsage['buckets'][number]) => number) => buckets.map(pick);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 pt-4">
        <h2 className="text-base font-semibold text-fg">KI</h2>
        <p className="text-xs text-fg-subtle">Wie die Dienste es melden</p>
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiTile
          label="KI-Anfragen"
          value={formatCount(total.requests)}
          delta={`${formatCount(instanceKeys.requests)} über Instanz-Keys`}
          trend={trend((bucket) => bucket.requests)}
        />
        <KpiTile
          label="Tokens"
          value={formatCount(tokensOf(total))}
          delta={`${formatCount(total.inputTokens + total.cacheReadTokens + total.cacheWriteTokens)} ein, ${formatCount(total.outputTokens)} aus`}
          trend={trend((bucket) => bucket.tokens)}
        />
        <KpiTile
          label="Audio-Minuten"
          value={formatMinutes(total.audioSeconds)}
          delta={phrase}
          trend={trend((bucket) => bucket.audioSeconds)}
        />
        <KpiTile
          label="Bilder erzeugt"
          value={formatCount(total.images)}
          delta={phrase}
          trend={trend((bucket) => bucket.images)}
        />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <WorkCard usage={usage} />
        <FeatureCard usage={usage} />
        <ModelCard usage={usage} />
        <WorkspaceCard usage={usage} />
      </div>
    </div>
  );
}

const Empty = () => <p className="text-body text-fg-subtle">Im Zeitraum nichts genutzt.</p>;

/**
 * What the AI did in the decks: the requests to change slides by how they ended, and the
 * comments it left on its own.
 */
function WorkCard({ usage }: { usage: InstanceAiUsage }) {
  const { asked, kept, reverted, unchanged, failed, comments } = usage.work;
  const running = Math.max(0, asked - kept - reverted - unchanged - failed);
  return (
    <Section title="Was die KI gemacht hat" density="compact">
      {asked === 0 && comments === 0 ? (
        <p className="text-body text-fg-subtle">Im Zeitraum nichts gemacht.</p>
      ) : (
        <>
          <Figure
            value={formatCount(asked)}
            caption={`${asked === 1 ? 'Auftrag' : 'Aufträge'} an Folien, ${plural(comments, 'Kommentar', 'Kommentare')} von der KI`}
          />
          <PartsBar
            label="Aufträge an die KI nach Ausgang"
            parts={[
              { key: 'kept', label: 'Behalten', amount: kept, color: 'bg-accent-green' },
              {
                key: 'reverted',
                label: 'Zurückgenommen',
                amount: reverted,
                color: 'bg-accent-yellow',
              },
              { key: 'unchanged', label: 'Nur geantwortet', amount: unchanged, color: 'bg-fg/45' },
              { key: 'failed', label: 'Fehlgeschlagen', amount: failed, color: 'bg-accent-red' },
              ...(running > 0
                ? [{ key: 'running', label: 'Läuft noch', amount: running, color: 'bg-surface-4' }]
                : []),
            ]}
          />
        </>
      )}
    </Section>
  );
}

/** What the AI was used for, as parts of a bar by requests – each with what it used. */
function FeatureCard({ usage }: { usage: InstanceAiUsage }) {
  const [top] = usage.byFeature;
  return (
    <Section title="Wofür" density="compact">
      {!top ? (
        <Empty />
      ) : (
        <>
          <Figure
            value={`${Math.round((top.requests / Math.max(usage.total.requests, 1)) * 100)} %`}
            caption={`der Anfragen: ${FEATURES[top.feature].label}`}
          />
          <PartsBar
            label="KI-Anfragen nach Funktion"
            parts={usage.byFeature.map((each) => ({
              key: each.feature,
              label: FEATURES[each.feature].label,
              color: FEATURES[each.feature].color,
              amount: each.requests,
              value: amountOf(each),
            }))}
          />
        </>
      )}
    </Section>
  );
}

/** The models, most used first: service and what each used, its requests. */
function ModelCard({ usage }: { usage: InstanceAiUsage }) {
  return (
    <Section title="Modelle" density="compact">
      {usage.byModel.length === 0 ? (
        <Empty />
      ) : (
        <ul className="flex flex-col gap-3">
          {usage.byModel.map((each) => (
            <li key={`${each.provider}/${each.model}`} className="flex items-start gap-3 text-body">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-fg" title={each.model}>
                  {each.model}
                </span>
                <span className="truncate text-xs text-fg-subtle">
                  {PROVIDER_LABELS[each.provider as IntegrationProvider] ?? each.provider},{' '}
                  {amountOf(each)}
                </span>
              </div>
              <span className="shrink-0 text-fg-muted tabular-nums">
                {plural(each.requests, 'Anfrage', 'Anfragen')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/**
 * The workspaces that used the AI the most – like the largest by storage: each with its share of
 * all requests as a thin bar. Names and amounts only.
 */
function WorkspaceCard({ usage }: { usage: InstanceAiUsage }) {
  const whole = usage.total.requests;
  const share = (sum: AiUsageSum) => (whole > 0 ? (sum.requests / whole) * 100 : 0);
  return (
    <Section title="Workspaces mit der meisten KI" density="compact">
      {usage.byWorkspace.length === 0 ? (
        <Empty />
      ) : (
        <ol className="flex flex-col gap-3.5">
          {usage.byWorkspace.map((workspace, index) => (
            <li key={workspace.id} className="flex items-center gap-3">
              <WorkspaceMark name={workspace.name} logoUrl={workspace.logoUrl} size={32} />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="flex items-baseline gap-3 text-body">
                  <span className="min-w-0 flex-1 truncate text-fg">{workspace.name}</span>
                  <span className="shrink-0 text-fg-muted tabular-nums">{amountOf(workspace)}</span>
                </div>
                <div aria-hidden className="h-1 rounded-full bg-surface-2">
                  <div
                    className={cn(
                      'h-full min-w-1 rounded-full',
                      index === 0 ? 'bg-fg' : 'bg-fg/45',
                    )}
                    style={{ width: `${share(workspace)}%` }}
                  />
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}
