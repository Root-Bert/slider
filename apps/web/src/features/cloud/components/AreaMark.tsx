import type { CloudArea } from '@slider/shared';
import { WorkspaceMark } from '@/features/workspaces';
import { useCloud } from '../hooks/useCloud';
import { AreaDot } from './AreaDot';

/**
 * What stands before an area's name: its colour as a square – the workspace's own area shows
 * the workspace's mark, as the switcher in the header does.
 */
export function AreaMark({
  area,
  size = 'sm',
}: {
  area: Pick<CloudArea, 'color' | 'root'>;
  /** `md`: a folded side bar's, filling its row as an avatar there does. */
  size?: 'sm' | 'md' | 'lg';
}) {
  const { workspace } = useCloud();
  if (!area.root)
    return size === 'md' ? (
      <AreaDot color={area.color} size="md" className="size-3.5!" />
    ) : (
      <AreaDot color={area.color} size={size} />
    );
  return (
    <WorkspaceMark
      name={workspace.name}
      logoUrl={workspace.logoUrl}
      size={size === 'lg' ? 32 : size === 'md' ? 24 : 18}
    />
  );
}
