import type { NodeKey } from 'lexical';
import { cn } from '@/ui';
import type { LiveKind } from '../lib/nodes';
import { usePageHost } from './PageHost';
import { useBlockPick } from './useBlockPick';

/** A live block: what the place shows now (`PageHost.live`), picked whole in Bearbeiten. */
export function LiveBlock({ live, nodeKey }: { live: LiveKind; nodeKey: NodeKey }) {
  const host = usePageHost();
  const { picked, pick } = useBlockPick(nodeKey);
  return (
    <div
      className={cn('page-live', picked && 'page-picked')}
      data-live={live}
      onClick={pick}
    >
      {host.live(live)}
    </div>
  );
}
