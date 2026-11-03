import { and, gte, inArray, lt, sql } from 'drizzle-orm';
import {
  intervalMs,
  stretchMs,
  type AiFeature,
  type AiProposalStatus,
  type AiUsageSum,
  type AiWork,
  type InstanceAiUsage,
  type InstanceTimelineQuery,
} from '@slider/shared';
import { runInBackground } from '../background-work';
import { aiProposals, aiUsage, comments, workspaces } from '../db/schema';
import type { AppDeps } from '../deps';
import { fileUrl } from '../storage/blob-storage';
import type { AiMeter } from './ai-providers';

/*
 * What the AI uses (instance dashboard → „KI“): every request to an AI service is written down
 * with its tokens, seconds of audio or pictures as the service's answer tells them – never what
 * was asked or answered, and no money: list prices would only be guesses.
 */

// ── Writing it down ──────────────────────────────────────────────────────

/**
 * Writes down what a workspace's request used, after it answered – in the background, a failure
 * logged and nothing more: the AI's answer never waits for it, nor fails by it.
 */
export function usageMeter(
  deps: Pick<AppDeps, 'db' | 'clock' | 'log' | 'background'>,
  key: { workspaceId: string; keyId: string; instanceKey: boolean; provider: string },
): AiMeter {
  return (report) => {
    const round = (value = 0) => Math.max(0, Math.round(value));
    const row = {
      id: crypto.randomUUID(),
      at: deps.clock.now(),
      workspaceId: key.workspaceId,
      keyId: key.keyId,
      instanceKey: key.instanceKey,
      feature: report.feature,
      provider: key.provider,
      model: report.model,
      inputTokens: round(report.inputTokens),
      outputTokens: round(report.outputTokens),
      cacheReadTokens: round(report.cacheReadTokens),
      cacheWriteTokens: round(report.cacheWriteTokens),
      audioSeconds: Math.max(0, report.audioSeconds ?? 0),
      images: round(report.images),
    };
    runInBackground(deps, async () => {
      try {
        await deps.db.insert(aiUsage).values(row);
      } catch (error) {
        deps.log.warn('AI usage not recorded', error);
      }
    });
  };
}

// ── The dashboard ────────────────────────────────────────────────────────

/** Workspaces listed as using the AI the most. */
const TOP_WORKSPACES = 5;

const emptySum = (): AiUsageSum => ({
  requests: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  audioSeconds: 0,
  images: 0,
});

const SUM_KEYS = Object.keys(emptySum()) as (keyof AiUsageSum)[];

/** Adds the amounts only – a model's sum also carries its provider and name, kept as they are. */
function add(sum: AiUsageSum, part: AiUsageSum): void {
  for (const key of SUM_KEYS) sum[key] += part[key];
}

const tokensOf = (sum: AiUsageSum) =>
  sum.inputTokens + sum.outputTokens + sum.cacheReadTokens + sum.cacheWriteTokens;

/**
 * Most used first: by requests, the one unit every service shares (tokens, minutes and pictures
 * don't add up); then tokens, minutes of audio, pictures.
 */
const byWeight = (a: AiUsageSum, b: AiUsageSum) =>
  b.requests - a.requests ||
  tokensOf(b) - tokensOf(a) ||
  b.audioSeconds - a.audioSeconds ||
  b.images - a.images;

const sums = {
  requests: sql<number>`count(*)::int`,
  inputTokens: sql<number>`coalesce(sum(${aiUsage.inputTokens}), 0)::int`,
  outputTokens: sql<number>`coalesce(sum(${aiUsage.outputTokens}), 0)::int`,
  cacheReadTokens: sql<number>`coalesce(sum(${aiUsage.cacheReadTokens}), 0)::int`,
  cacheWriteTokens: sql<number>`coalesce(sum(${aiUsage.cacheWriteTokens}), 0)::int`,
  audioSeconds: sql<number>`coalesce(sum(${aiUsage.audioSeconds}), 0)::float8`,
  images: sql<number>`coalesce(sum(${aiUsage.images}), 0)::int`,
};

/** Numbers of a row of sums – drivers may hand sums over as text. */
const sumOf = (row: Record<keyof AiUsageSum, unknown>): AiUsageSum => {
  const sum = emptySum();
  for (const key of Object.keys(sum) as (keyof AiUsageSum)[]) sum[key] = Number(row[key] ?? 0);
  return sum;
};

/**
 * The AI's use in the window of `interval` ending at `to` (now without it) – per stretch as the
 * timeline, in all, on the instance's keys, per feature, model and workspace.
 */
export async function instanceAiUsage(
  deps: Pick<AppDeps, 'db' | 'clock'>,
  { interval, to }: InstanceTimelineQuery,
): Promise<InstanceAiUsage> {
  const end = to ? Date.parse(to) : deps.clock.now().getTime();
  const start = new Date(end - intervalMs(interval));
  const step = stretchMs(interval);
  const stretches = Math.round(intervalMs(interval) / step);
  const within = and(gte(aiUsage.at, start), lt(aiUsage.at, new Date(end)));
  // Raw SQL takes the time as text: the postgres-js driver can't send a Date there (PGlite can).
  const bucket = sql<number>`floor(extract(epoch from (${aiUsage.at} - ${start.toISOString()}::timestamptz)) * 1000 / ${step})::int`;
  const [perStretch, groups, work] = await Promise.all([
    deps.db
      .select({
        bucket,
        requests: sums.requests,
        tokens: sql<number>`coalesce(sum(${aiUsage.inputTokens} + ${aiUsage.outputTokens} + ${aiUsage.cacheReadTokens} + ${aiUsage.cacheWriteTokens}), 0)::int`,
        audioSeconds: sums.audioSeconds,
        images: sums.images,
      })
      .from(aiUsage)
      .where(within)
      // By position: the parameters make the expression a different one in `group by`.
      .groupBy(sql`1`),
    deps.db
      .select({
        feature: aiUsage.feature,
        provider: aiUsage.provider,
        model: aiUsage.model,
        workspaceId: aiUsage.workspaceId,
        instanceKey: aiUsage.instanceKey,
        ...sums,
      })
      .from(aiUsage)
      .where(within)
      .groupBy(
        aiUsage.feature,
        aiUsage.provider,
        aiUsage.model,
        aiUsage.workspaceId,
        aiUsage.instanceKey,
      ),
    aiWork(deps, start, new Date(end)),
  ]);

  const stretch = new Map(perStretch.map((row) => [Number(row.bucket), row]));
  const total = emptySum();
  const instanceKeys = emptySum();
  const features = new Map<AiFeature, AiUsageSum>();
  const models = new Map<string, AiUsageSum & { provider: string; model: string }>();
  const spaces = new Map<string, AiUsageSum>();
  for (const group of groups) {
    const sum = sumOf(group);
    add(total, sum);
    if (group.instanceKey) add(instanceKeys, sum);
    const feature = features.get(group.feature) ?? emptySum();
    add(feature, sum);
    features.set(group.feature, feature);
    const modelKey = `${group.provider}\n${group.model}`;
    const model = models.get(modelKey) ?? {
      ...emptySum(),
      provider: group.provider,
      model: group.model,
    };
    add(model, sum);
    models.set(modelKey, model);
    if (group.workspaceId) {
      const space = spaces.get(group.workspaceId) ?? emptySum();
      add(space, sum);
      spaces.set(group.workspaceId, space);
    }
  }
  const top = [...spaces].sort(([, a], [, b]) => byWeight(a, b)).slice(0, TOP_WORKSPACES);
  const named =
    top.length > 0
      ? await deps.db
          .select({ id: workspaces.id, name: workspaces.name, logoKey: workspaces.logoKey })
          .from(workspaces)
          .where(
            inArray(
              workspaces.id,
              top.map(([id]) => id),
            ),
          )
      : [];
  const nameOf = new Map(named.map((row) => [row.id, row]));

  return {
    from: start.toISOString(),
    to: new Date(end).toISOString(),
    buckets: Array.from({ length: stretches }, (_, index) => {
      const row = stretch.get(index);
      return {
        start: new Date(start.getTime() + index * step).toISOString(),
        tokens: Number(row?.tokens ?? 0),
        audioSeconds: Number(row?.audioSeconds ?? 0),
        images: Number(row?.images ?? 0),
        requests: Number(row?.requests ?? 0),
      };
    }),
    total,
    instanceKeys,
    byFeature: [...features].map(([feature, sum]) => ({ ...sum, feature })).sort(byWeight),
    byModel: [...models.values()].sort(byWeight),
    byWorkspace: top.flatMap(([id, sum]) => {
      const row = nameOf.get(id);
      return row
        ? [{ ...sum, id, name: row.name, logoUrl: row.logoKey ? fileUrl(row.logoKey) : null }]
        : [];
    }),
    work,
  };
}

/**
 * What the AI did between `from` and `to`, counted from its requests to change slides (by how
 * they ended) and the comments it left – both only as long as their deck is there.
 */
async function aiWork(deps: Pick<AppDeps, 'db'>, from: Date, to: Date): Promise<AiWork> {
  const status = (...names: AiProposalStatus[]) =>
    sql<number>`(count(*) filter (where ${inArray(aiProposals.status, names)}))::int`;
  const [[asked], [left]] = await Promise.all([
    deps.db
      .select({
        asked: sql<number>`count(*)::int`,
        kept: status('applied'),
        reverted: status('reverted', 'discarded'),
        unchanged: status('ready'),
        failed: status('failed', 'cancelled'),
      })
      .from(aiProposals)
      .where(and(gte(aiProposals.createdAt, from), lt(aiProposals.createdAt, to))),
    deps.db
      .select({ comments: sql<number>`count(*)::int` })
      .from(comments)
      .where(
        and(
          gte(comments.createdAt, from),
          lt(comments.createdAt, to),
          sql`${comments.author}->>'type' = 'ai'`,
        ),
      ),
  ]);
  return {
    asked: Number(asked?.asked ?? 0),
    kept: Number(asked?.kept ?? 0),
    reverted: Number(asked?.reverted ?? 0),
    unchanged: Number(asked?.unchanged ?? 0),
    failed: Number(asked?.failed ?? 0),
    comments: Number(left?.comments ?? 0),
  };
}
