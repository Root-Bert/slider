import { routes } from '@/lib/routes';
import { CloudPage } from './components/CloudPage';
import {
  CalendarAccounts,
  ConnectGoogleButton,
  useCalendarOAuthOutcome,
} from './components/calendar/CalendarAccounts';
import { useCloud } from './hooks/useCloud';

/** The calendar's „Konten“: the accounts whose calendars stand in it – as Post's „Postfächer“. */
export function Component() {
  const ui = useCloud();
  // Back from Google or Microsoft: connected or signed in anew – a toast says so.
  useCalendarOAuthOutcome();
  return (
    <CloudPage
      docTitle="Kalenderkonten"
      title="Konten"
      crumbs={[
        { label: ui.workspace.name },
        { label: 'Kalender', to: routes.cloudCalendar(ui.workspace.id) },
        { label: 'Konten' },
      ]}
      actions={<ConnectGoogleButton />}
      nodes={[]}
    >
      {() => <CalendarAccounts />}
    </CloudPage>
  );
}
