import {
  ACCENT_COLORS,
  accentColorSchema,
  MAIL_SYNC_MINUTES,
  MEETING_NOTICE_CHOICES,
  USER_NAME_MAX,
  type Viewer,
} from '@slider/shared';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { users } from '../db/schema';
import type { AppDeps } from '../deps';
import { ApiError } from '../http/errors';
import { callVoices, pickCallVoice } from './call-voices';
import { mailSyncOf, setMailSync } from './mail';
import { ToolChatError } from './tool-chat';
import { setShowExtensions, setMeetingNotice, updateViewerColor, updateViewerName } from './users';

/**
 * The person's own settings an agent or a connected app may read and change for them – those kept
 * on the server. What lives in their browser alone (look, notifications, how things open) it
 * cannot reach: it names them and where the person sets them.
 */
export const SETTINGS_INPUTS = {
  read_settings: z.object({}).passthrough(),
  change_settings: z
    .object({
      name: z.string().trim().min(1).max(USER_NAME_MAX).optional(),
      color: accentColorSchema.optional(),
      call_voice: z.string().trim().min(1).max(200).nullable().optional(),
      mail_check_minutes: z
        .number()
        .int()
        .refine((each) => (MAIL_SYNC_MINUTES as readonly number[]).includes(each), {
          message: `One of ${MAIL_SYNC_MINUTES.join(', ')}.`,
        })
        .optional(),
      show_extensions: z.boolean().optional(),
      meeting_notice_minutes: z
        .number()
        .int()
        .nullable()
        .refine((each) => (MEETING_NOTICE_CHOICES as readonly (number | null)[]).includes(each), {
          message: `One of ${MEETING_NOTICE_CHOICES.map(String).join(', ')}.`,
        })
        .optional(),
    })
    .passthrough(),
} as const;
export type SettingsToolName = keyof typeof SETTINGS_INPUTS;

const READ_DESCRIPTION =
  "The person's own settings: their name and colour (others see them by it), the voice agents speak with in their calls (and those to pick from), how often their mailboxes are checked, whether Cloud's file names show their ending, how long before a meeting it shows beside the date in the header. Says too what only the person sets, in their browser, and where.";
const CHANGE_DESCRIPTION = `Changes the person's own settings – only the fields given, only when they ask for it: name (others see it, on their comments too), color (${ACCENT_COLORS.join(', ')}), call_voice (a voice id from read_settings; null: the automatic one), mail_check_minutes (${MAIL_SYNC_MINUTES.join(', ')} – 0: only when they pull the mail list down), show_extensions (true: „Bericht.pdf“ in Cloud's lists, false: „Bericht“), meeting_notice_minutes (${MEETING_NOTICE_CHOICES.map(String).join(', ')} – minutes before a meeting it shows beside the date in the header with „Beitreten“; null: never). A mailbox's own settings: update_mailbox; an area's: update_area.`;

export const SETTINGS_TOOLS = [
  {
    name: 'read_settings',
    description: READ_DESCRIPTION,
    input_schema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'change_settings',
    description: CHANGE_DESCRIPTION,
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string' },
        color: { type: 'string', enum: [...ACCENT_COLORS] },
        call_voice: { type: ['string', 'null'] },
        mail_check_minutes: { type: 'integer', enum: [...MAIL_SYNC_MINUTES] },
        show_extensions: { type: 'boolean' },
        meeting_notice_minutes: {
          type: ['integer', 'null'],
          enum: [...MEETING_NOTICE_CHOICES],
        },
      },
    },
  },
];

const BROWSER_ONLY =
  'Kept in the person’s browser only, set by them under „Einstellungen“ (/einstellungen): light or dark, notifications, where each app’s pages open, how files and presentations open and are sorted, how the mail list looks.';

const noticeWord = (minutes: number | null) =>
  minutes === null ? 'never in the header' : `${minutes} min before in the header`;

const minutesWord = (minutes: number) =>
  minutes === 0 ? 'only when they pull the mail list down' : minutes === 1 ? 'every minute' : `every ${minutes} minutes`;

/** Runs read_settings or change_settings for the person `viewer` is – nobody else's. */
export async function runSettingsTool(
  deps: AppDeps,
  viewer: Viewer,
  name: SettingsToolName,
  raw: unknown,
): Promise<string> {
  if (viewer.kind !== 'owner') throw new ToolChatError('Settings are only for a signed-in person.');
  const userId = viewer.author.id;
  const voicesOf = () =>
    callVoices(deps, userId).catch(() => ({ voices: [], automatic: null, picked: null }));
  if (name === 'read_settings') {
    const [voices, sync, [user]] = await Promise.all([
      voicesOf(),
      mailSyncOf(deps, userId),
      deps.db
        .select({
          showExtensions: users.showExtensions,
          meetingNoticeMinutes: users.meetingNoticeMinutes,
        })
        .from(users)
        .where(eq(users.id, userId)),
    ]);
    const picked = voices.voices.find((each) => each.id === voices.picked);
    return [
      `name: ${viewer.author.name}`,
      `color: ${viewer.author.color} (one of ${ACCENT_COLORS.join(', ')})`,
      `call_voice: ${picked ? `${picked.name} (${picked.id})` : (voices.picked ?? 'automatic')}`,
      voices.voices.length
        ? `voices to pick: ${voices.voices
            .slice(0, 40)
            .map((each) => `${each.id} ${each.name}${each.language ? ` (${each.language})` : ''}`)
            .join('; ')}`
        : 'voices to pick: none – the workspace has no speech service',
      `mail_check_minutes: ${sync.minutes} (${minutesWord(sync.minutes)})`,
      `show_extensions: ${user?.showExtensions ?? false} (Cloud's file names ${user?.showExtensions ? 'with' : 'without'} their ending)`,
      `meeting_notice_minutes: ${user?.meetingNoticeMinutes ?? null} (${noticeWord(user?.meetingNoticeMinutes ?? null)})`,
      BROWSER_ONLY,
    ].join('\n');
  }
  const input = SETTINGS_INPUTS.change_settings.parse(raw);
  if (
    input.name === undefined &&
    input.color === undefined &&
    input.call_voice === undefined &&
    input.mail_check_minutes === undefined &&
    input.show_extensions === undefined &&
    input.meeting_notice_minutes === undefined
  )
    throw new ToolChatError(
      'Say what to change: name, color, call_voice, mail_check_minutes, show_extensions or meeting_notice_minutes. ' +
        BROWSER_ONLY,
    );
  const done: string[] = [];
  let now = viewer;
  if (input.name !== undefined && input.name !== now.author.name) {
    const renamed = await updateViewerName(deps.db, now, input.name);
    now = renamed.viewer;
    for (const deckId of renamed.deckIds) deps.live?.commentsChanged(deckId);
    done.push(`name „${input.name}“`);
  }
  if (input.color !== undefined) {
    await updateViewerColor(deps.db, now, input.color);
    done.push(`color ${input.color}`);
  }
  if (input.call_voice !== undefined) {
    const voices = await pickCallVoice(deps, userId, input.call_voice).catch((error: unknown) => {
      if (error instanceof ApiError) throw new ToolChatError(error.message);
      throw error;
    });
    const picked = voices.voices.find((each) => each.id === voices.picked);
    done.push(`call voice ${picked?.name ?? 'automatic'}`);
  }
  if (input.mail_check_minutes !== undefined) {
    await setMailSync(deps, userId, input.mail_check_minutes);
    done.push(`mailboxes checked ${minutesWord(input.mail_check_minutes)}`);
  }
  if (input.show_extensions !== undefined) {
    await setShowExtensions(deps.db, userId, input.show_extensions);
    done.push(`file names ${input.show_extensions ? 'with' : 'without'} their ending`);
  }
  if (input.meeting_notice_minutes !== undefined) {
    await setMeetingNotice(deps.db, userId, input.meeting_notice_minutes);
    done.push(`meetings shown ${noticeWord(input.meeting_notice_minutes)}`);
  }
  return done.length ? `Changed: ${done.join(', ')}.` : 'Nothing was different.';
}
