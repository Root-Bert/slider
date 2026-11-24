import type { ReactNode } from 'react';
import { Icon, type IconName } from '@/ui';

/**
 * The picture of an empty list, a little at work – the page's own thing doing what the page is
 * for: a page rises into the cloud, one drops into the folder, to-dos tick themselves off, the
 * agent's sparks twinkle, the glass looks around. Drawn in `currentColor`, moving only without
 * reduced motion (styles in index.css, `.empty-scene`); still, each is its plain symbol.
 */
/** A small page with a folded corner, its top left at x, y (6 × 7.5). */
const page = (x: number, y: number) =>
  `M${x + 1} ${y}h3l2 2v4.5a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-5.5a1 1 0 0 1 1-1zm2.6 .9v1.7h1.7z`;

const SCENES: Partial<Record<IconName, () => ReactNode>> = {
  cloud: () => (
    <svg width={34} height={34} viewBox="0 0 32 32" className="empty-scene" fill="currentColor">
      <defs>
        {/* Only under the cloud: in it, the page is gone. */}
        <clipPath id="empty-scene-under-cloud">
          <rect x="0" y="21.4" width="32" height="12" />
        </clipPath>
      </defs>
      <g clipPath="url(#empty-scene-under-cloud)">
        <path className="empty-scene-rise" d={page(13, 22)} />
      </g>
      <g className="empty-scene-gulp">
        <Icon name="cloud" x={4} y={1} />
      </g>
    </svg>
  ),
  folderOpen: () => (
    <svg width={34} height={34} viewBox="0 0 32 32" className="empty-scene" fill="currentColor">
      <path className="empty-scene-drop" d={page(13, 12.5)} />
      <g className="empty-scene-catch">
        <Icon name="folderOpen" x={4} y={4} />
      </g>
    </svg>
  ),
  checklist: () => (
    <svg
      width={34}
      height={34}
      viewBox="0 0 32 32"
      className="empty-scene"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {[9, 16, 23].map((y) => (
        <g key={y} className="empty-scene-todo">
          <path className="empty-scene-tick" d={`M5 ${y} l2.2 2.2 l4.3 -4.4`} pathLength={1} />
          <path className="empty-scene-line" d={`M15.5 ${y} H27`} />
        </g>
      ))}
    </svg>
  ),
  autoAwesome: () => (
    <svg width={30} height={30} viewBox="0 0 24 24" className="empty-scene" fill="currentColor">
      <path
        className="empty-scene-spark"
        d="M11.5 9.5 9 4 6.5 9.5 1 12l5.5 2.5L9 20l2.5-5.5L17 12z"
      />
      <path
        className="empty-scene-twinkle"
        d="M19 9l1.25-2.75L23 5l-2.75-1.25L19 1l-1.25 2.75L15 5l2.75 1.25z"
      />
      <path
        className="empty-scene-twinkle"
        d="M19 15l-1.25 2.75L15 19l2.75 1.25L19 23l1.25-2.75L23 19l-2.75-1.25z"
      />
    </svg>
  ),
  search: () => (
    <svg width={34} height={34} viewBox="-3 -3 30 30" className="empty-scene" fill="currentColor">
      {/* Room around the glass to look about in. */}
      <g className="empty-scene-look">
        <Icon name="search" />
      </g>
    </svg>
  ),
};

/** The moving picture for `icon` – where there is none, its plain symbol. */
export function EmptyScene({ icon }: { icon: IconName }) {
  const scene = SCENES[icon];
  return scene ? (
    <span aria-hidden="true" className="flex">
      {scene()}
    </span>
  ) : (
    <Icon name={icon} size={28} />
  );
}
