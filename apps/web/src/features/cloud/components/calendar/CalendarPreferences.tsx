import { DEFAULT_MEETING_NOTICE, MEETING_NOTICE_CHOICES } from '@slider/shared';
import { useId } from 'react';
import { useMe, useSetMeetingNotice } from '@/lib/api';
import { Section, SegmentedControl, type ShowToast } from '@/ui';
import { AppTag } from '../AppMark';

const OFF = 'aus';
const SEGMENTS = MEETING_NOTICE_CHOICES.map((minutes) =>
  minutes === null
    ? { value: OFF, label: 'Aus' }
    : { value: String(minutes), label: `${minutes} Min` },
);

/**
 * The calendar's part of `/einstellungen`, marked as Cloud's: how long before a meeting it shows
 * beside the date in the header, with „Beitreten“ – or never. Kept with the account.
 */
export function CalendarPreferences({ onNotify }: { onNotify: ShowToast }) {
  const setting = useMe().data?.user?.meetingNoticeMinutes;
  const minutes = setting === undefined ? DEFAULT_MEETING_NOTICE : setting;
  const set = useSetMeetingNotice();
  const labelId = useId();
  return (
    <Section
      id="kalender"
      title="Kalender"
      aside={<AppTag app="cloud" />}
      description="Steht ein Meeting an, zeigt es sich oben neben dem Datum – mit „Beitreten“ für den Anruf oder den Link. Gilt auf allen deinen Geräten."
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span id={labelId} className="text-sm text-fg">
          Meetings vorher zeigen
          <span className="block text-xs text-fg-subtle">
            So viele Minuten vor Beginn, bis es endet
          </span>
        </span>
        <SegmentedControl
          label="Meetings vorher zeigen"
          size="sm"
          track="soft"
          segments={SEGMENTS}
          value={minutes === null ? OFF : String(minutes)}
          onChange={(value) =>
            set.mutate(value === OFF ? null : Number(value), {
              onError: () => onNotify('Einstellung konnte nicht gespeichert werden.', 'danger'),
            })
          }
        />
      </div>
    </Section>
  );
}
