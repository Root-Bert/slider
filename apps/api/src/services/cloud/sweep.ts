import { and, eq, isNotNull, isNull, lt, ne } from 'drizzle-orm';
import { CLOUD_TRASH_DAYS, CLOUD_VERSION_DAYS } from '@slider/shared';
import { cloudNodes, cloudVersions } from '../../db/schema';
import type { AppDeps } from '../../deps';
import { DAY_MS } from '../retention-rules';
import { removeVersions } from './files';
import { purgeRow } from './nodes';
import { sweepRemoved } from './sync';

/**
 * The hourly tidy-up of Cloud's files: what lay in „Gelöscht“ for `CLOUD_TRASH_DAYS` goes for
 * good, earlier versions without a name go after `CLOUD_VERSION_DAYS`, and files of nobody –
 * the own files of an account that is gone – go too, as does the note of what went for good
 * once no computer keeping copies needs it any more.
 */
export async function sweepCloud(deps: AppDeps): Promise<void> {
  const now = deps.clock.now();
  const trashed = await deps.db
    .select()
    .from(cloudNodes)
    .where(
      and(
        isNotNull(cloudNodes.deletedAt),
        eq(cloudNodes.deletedRootId, cloudNodes.id),
        lt(cloudNodes.deletedAt, new Date(now.getTime() - CLOUD_TRASH_DAYS * DAY_MS)),
      ),
    );
  const orphans = await deps.db
    .select()
    .from(cloudNodes)
    .where(and(isNull(cloudNodes.areaId), isNull(cloudNodes.ownerId), isNull(cloudNodes.parentId)));
  for (const row of [...trashed, ...orphans]) {
    try {
      await purgeRow(deps, row);
    } catch (error) {
      deps.log.error(`Could not purge cloud node ${row.id}`, error);
    }
  }

  const old = await deps.db
    .select({ version: cloudVersions, node: cloudNodes })
    .from(cloudVersions)
    .innerJoin(cloudNodes, eq(cloudNodes.id, cloudVersions.nodeId))
    .where(
      and(
        isNull(cloudVersions.label),
        lt(cloudVersions.createdAt, new Date(now.getTime() - CLOUD_VERSION_DAYS * DAY_MS)),
        ne(cloudNodes.currentVersionId, cloudVersions.id),
      ),
    )
    .limit(2000);
  for (const { version, node } of old) {
    try {
      await removeVersions(deps, node, [version]);
    } catch (error) {
      deps.log.error(`Could not remove cloud version ${version.id}`, error);
    }
  }
  await sweepRemoved(deps);
}
