import { z } from 'zod';
import { accentColorSchema } from './model';
import { PLAN_IDS, storageBreakdownSchema } from './workspaces';

/**
 * The instance admin's dashboard (`/instanz`, BER-167): numbers for the whole instance, and the
 * accounts and workspaces to block or – where plans limit anything – to put on a plan.
 * Workspaces show sizes only, never what is in them (no review titles, no member names).
 */

const HOUR_MS = 3_600_000;

/**
 * The dashboard's window: how much of the history the chart shows at once, and how long one point
 * of its line is. A year is 52 whole weeks, so its stretches fill it exactly.
 */
export const INSTANCE_INTERVALS = {
  '1d': { days: 1, stretchHours: 1 },
  '7d': { days: 7, stretchHours: 6 },
  '31d': { days: 31, stretchHours: 24 },
  '1y': { days: 364, stretchHours: 168 },
} as const satisfies Record<string, { days: number; stretchHours: number }>;
export type InstanceInterval = keyof typeof INSTANCE_INTERVALS;
const INTERVAL_KEYS = Object.keys(INSTANCE_INTERVALS) as [InstanceInterval, ...InstanceInterval[]];

export const intervalMs = (interval: InstanceInterval) =>
  INSTANCE_INTERVALS[interval].days * 24 * HOUR_MS;
export const stretchMs = (interval: InstanceInterval) =>
  INSTANCE_INTERVALS[interval].stretchHours * HOUR_MS;

/** What was created in one stretch (accounts, workspaces, reviews). */
export const instanceBucketSchema = z.object({
  /** Start of the stretch; the stretches are equally long. */
  start: z.iso.datetime(),
  users: z.number().int(),
  workspaces: z.number().int(),
  decks: z.number().int(),
});
export type InstanceBucket = z.infer<typeof instanceBucketSchema>;

/**
 * `GET /instance/timeline?interval=&to=`: what was created in the window ending at `to` (now
 * without it). The browser ends it on a full hour or at midnight, so `to` may lie a little ahead.
 */
export const instanceTimelineQuerySchema = z.object({
  interval: z.enum(INTERVAL_KEYS),
  to: z.iso.datetime().optional(),
});
export type InstanceTimelineQuery = z.infer<typeof instanceTimelineQuerySchema>;

export const instanceTimelineSchema = z.object({
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  /** The window in stretches of its interval, oldest first. */
  buckets: z.array(instanceBucketSchema),
});
export type InstanceTimeline = z.infer<typeof instanceTimelineSchema>;

/**
 * `GET /instance/overview`: the instance as it is now – nothing depends on the chart's window.
 * "Active": used Slider in the last 30 days.
 */
export const instanceOverviewSchema = z.object({
  users: z.object({
    total: z.number().int(),
    active: z.number().int(),
    /** Used Slider in the last 7 / 90 days – with `active` the activity bar. */
    activeWeek: z.number().int(),
    activeQuarter: z.number().int(),
    blocked: z.number().int(),
  }),
  workspaces: z.object({
    total: z.number().int(),
    /** On the paid plan, through Stripe or granted. */
    paid: z.number().int(),
    /** Paid granted by the instance admin. */
    granted: z.number().int(),
    blocked: z.number().int(),
  }),
  /** Reviews, archived ones included. */
  decks: z.number().int(),
  /** The workspaces taking up the most storage – name and size only. */
  largest: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      logoUrl: z.string().nullable(),
      storageBytes: z.number().int(),
    }),
  ),
  /** Every file of every review, recordings included. */
  storage: storageBreakdownSchema,
  /**
   * The plans differ (the hosted instance, or limits set by `PLAN_FREE_*`): only then the admin
   * puts workspaces on a plan.
   */
  plans: z.boolean(),
});
export type InstanceOverview = z.infer<typeof instanceOverviewSchema>;

/**
 * `GET /instance/history`: everything since the first account (at least 31 days back), in at
 * most 200 stretches of whole days – the strip the window slides over.
 */
export const instanceHistorySchema = z.object({
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  stretchDays: z.number().int(),
  buckets: z.array(instanceBucketSchema),
});
export type InstanceHistory = z.infer<typeof instanceHistorySchema>;

/** Rows per page of the lists below. */
export const INSTANCE_PAGE_SIZE = 50;

/** `?q=` (name or e-mail / name or domain, any part) and `?offset=`. */
export const instanceListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});
export type InstanceListQuery = z.infer<typeof instanceListQuerySchema>;

export const instanceUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  color: accentColorSchema,
  createdAt: z.iso.datetime(),
  lastActiveAt: z.iso.datetime(),
  /** Workspaces the account is in. */
  workspaceCount: z.number().int(),
  isInstanceAdmin: z.boolean(),
  blockedAt: z.iso.datetime().nullable(),
});
export type InstanceUser = z.infer<typeof instanceUserSchema>;

/** `GET /instance/users`: newest first. `total` counts every match, not just this page. */
export const instanceUserListSchema = z.object({
  users: z.array(instanceUserSchema),
  total: z.number().int(),
});
export type InstanceUserList = z.infer<typeof instanceUserListSchema>;

export const instanceWorkspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  logoUrl: z.string().nullable(),
  /** Company workspace of this domain; `null` = private. */
  joinDomain: z.string().nullable(),
  createdAt: z.iso.datetime(),
  /** Usually a `PlanId`. */
  plan: z.string(),
  /** Paid granted by the instance admin, without Stripe. */
  planGranted: z.boolean(),
  /** A Stripe subscription runs (also when cancelled to the period end): the plan is Stripe's. */
  subscribed: z.boolean(),
  memberCount: z.number().int(),
  deckCount: z.number().int(),
  storageBytes: z.number().int(),
  blockedAt: z.iso.datetime().nullable(),
});
export type InstanceWorkspace = z.infer<typeof instanceWorkspaceSchema>;

/** `GET /instance/workspaces`: newest first. */
export const instanceWorkspaceListSchema = z.object({
  workspaces: z.array(instanceWorkspaceSchema),
  total: z.number().int(),
});
export type InstanceWorkspaceList = z.infer<typeof instanceWorkspaceListSchema>;

/** `PUT /instance/users/:id/blocked`, `PUT /instance/workspaces/:id/blocked`. */
export const setBlockedInputSchema = z.object({ blocked: z.boolean() });

/**
 * `PUT /instance/workspaces/:id/plan`: `paid` grants the paid plan without Stripe, `free` takes a
 * grant back. Not while a subscription runs – then Stripe decides.
 */
export const setWorkspacePlanInputSchema = z.object({ plan: z.enum(PLAN_IDS) });
