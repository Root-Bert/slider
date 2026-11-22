import type { ReactNode } from 'react';
import { AppMark, type AppName } from '@/features/cloud';

/**
 * The AI's models are an app's: each app asks other things of it. Slider picks its three on the
 * key; the other apps run on two of them – their agents and chats on the review model
 * (`runTurn`), the mail's AI and quick summaries on the quick one (`runToolCall`).
 */
const APPS: readonly { app: AppName; name: string; models: string }[] = [
  { app: 'slider', name: 'Slider', models: 'Review, Erstellen, schnelle Aufträge' },
  { app: 'cloud', name: 'Cloud', models: 'Agenten und Chats – auf dem Modell für Review' },
  {
    app: 'writer',
    name: 'Writer',
    models: 'Kommentar, Anpassung, Sprachmodus – auf dem Modell für Review',
  },
  {
    app: 'sender',
    name: 'Sender',
    models: 'KI zur Mail, Spam, Neues – auf dem Modell für schnelle Aufträge',
  },
];

/** Once per section: which apps run on the keys below, and what each picks there. */
export function AppModelsOverview() {
  return (
    <ul aria-label="Apps mit eigenen Modellen" className="grid gap-2 sm:grid-cols-2">
      {APPS.map(({ app, name, models }) => (
        <li key={app} className="flex min-w-0 flex-col gap-1 rounded-panel bg-surface-1 p-3">
          <span className="flex items-center gap-2 text-sm font-medium text-fg">
            <AppMark app={app} width={18} />
            {name}
          </span>
          <span className="text-xs text-fg-subtle">{models}</span>
        </li>
      ))}
    </ul>
  );
}

/** One app's models on a key: its mark and name, then a line per thing it asks of the AI. */
export function AppModels({ app, children }: { app: 'slider'; children: ReactNode }) {
  const { name } = APPS.find((each) => each.app === app)!;
  return (
    <div
      role="group"
      aria-label={`Modelle für ${name}`}
      className="flex flex-col gap-3 rounded-panel bg-surface-1 p-3"
    >
      <span className="flex items-center gap-2 text-sm font-medium text-fg">
        <AppMark app={app} width={18} />
        {name}
      </span>
      {children}
    </div>
  );
}
