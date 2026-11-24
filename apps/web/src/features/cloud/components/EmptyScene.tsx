import type { ReactNode } from 'react';
import { Icon, type IconName } from '@/ui';

/**
 * The picture of an empty list, a little at work – the page's own thing doing what the page is
 * for: a page rises into the cloud, one drops into the folder, to-dos tick themselves off, the
 * agent's sparks twinkle, the glass looks around, the link snaps shut, the bin's lid peeks, the
 * pencil writes, a letter slips into the envelope, someone turns up in the shared folder, the
 * share reaches out, the areas hop. Drawn in `currentColor` on a 32-unit square (the symbol's 24
 * in the middle), filling the box it is given; moving only without reduced motion (styles in
 * index.css, `.empty-scene`); still, each is its plain symbol.
 */
/** A small page with a folded corner, its top left at x, y (6 × 7.5). */
const page = (x: number, y: number) =>
  `M${x + 1} ${y}h3l2 2v4.5a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-5.5a1 1 0 0 1 1-1zm2.6 .9v1.7h1.7z`;

/** The scene's canvas: 32 units, the symbol's 24 at 4, 4 – the box sets the size. */
function Scene({
  children,
  viewBox = '0 0 32 32',
  ...props
}: {
  children: ReactNode;
  viewBox?: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  strokeLinecap?: 'round';
  strokeLinejoin?: 'round';
}) {
  return (
    <svg
      width="100%"
      height="100%"
      viewBox={viewBox}
      className="empty-scene"
      fill="currentColor"
      {...props}
    >
      {children}
    </svg>
  );
}

const SCENES: Partial<Record<IconName, () => ReactNode>> = {
  cloud: () => (
    <Scene>
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
    </Scene>
  ),
  folderOpen: () => (
    <Scene>
      <path className="empty-scene-drop" d={page(13, 12.5)} />
      <g className="empty-scene-catch">
        <Icon name="folderOpen" x={4} y={4} />
      </g>
    </Scene>
  ),
  checklist: () => (
    <Scene
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
    </Scene>
  ),
  autoAwesome: () => (
    // The sparks fill their 24 a little less than the other symbols: a margin of their own.
    <Scene viewBox="-1.6 -1.6 27.2 27.2">
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
    </Scene>
  ),
  search: () => (
    <Scene viewBox="-3 -3 30 30">
      {/* Room around the glass to look about in. */}
      <g className="empty-scene-look">
        <Icon name="search" />
      </g>
    </Scene>
  ),
  link: () => (
    // The two loops come together, the bar between them shuts the link; then they part again.
    <Scene>
      <g transform="translate(4 4)">
        <path
          className="empty-scene-link-left"
          d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1z"
        />
        <path className="empty-scene-link-bar" d="M8 13h8v-2H8z" />
        <path
          className="empty-scene-link-right"
          d="M17 7h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"
        />
      </g>
    </Scene>
  ),
  delete: () => (
    // The bin's lid lifts to show there is nothing in it, and drops shut.
    <Scene>
      <g transform="translate(4 4)">
        <path
          className="empty-scene-bin"
          d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM8 9h8v10H8V9z"
        />
        <path className="empty-scene-lid" d="M15.5 4l-1-1h-5l-1 1H5v2h14V4z" />
      </g>
    </Scene>
  ),
  edit: () => (
    // The pencil writes a line, it fades, the pencil goes back to write it again.
    <Scene>
      <path
        className="empty-scene-written"
        // Where the pencil's tip runs: from 3.9 as far as it goes (10, index.css).
        d="M3.9 23.6q1.25-.9 2.5 0t2.5 0 2.5 0 2.5 0"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        pathLength={1}
      />
      <g className="empty-scene-write">
        <g transform="translate(1.45 6) scale(0.8)">
          <Icon name="edit" />
        </g>
      </g>
    </Scene>
  ),
  mail: () => (
    // A letter slips into the envelope (gone once in it), the envelope takes it.
    <Scene>
      <defs>
        <clipPath id="empty-scene-over-envelope">
          <rect x="0" y="-12" width="32" height="20.6" />
        </clipPath>
      </defs>
      <g clipPath="url(#empty-scene-over-envelope)">
        <path className="empty-scene-post" d={page(13, 0.5)} />
      </g>
      <g className="empty-scene-envelope">
        <Icon name="mail" x={4} y={4} />
      </g>
    </Scene>
  ),
  folderShared: () => (
    // Someone turns up in the folder, stays a while, and goes.
    <Scene>
      <g transform="translate(4 4)">
        <path
          className="empty-scene-catch-shared"
          d="M20 6h-8l-2-2H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V6h5.17l2 2H20v10z"
        />
        <path
          className="empty-scene-arrive"
          d="M15 13c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm-4 4h8v-1c0-1.33-2.67-2-4-2s-4 .67-4 2v1z"
        />
      </g>
    </Scene>
  ),
  share: () => (
    // From the one dot a line reaches out to each of the others, they turn up at its end.
    <Scene>
      <g transform="translate(4 4)">
        <g fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
          <path className="empty-scene-reach" d="M6 12 18 5" pathLength={1} />
          <path className="empty-scene-reach" d="M6 12 18 19" pathLength={1} />
        </g>
        <circle cx="6" cy="12" r="3" />
        <circle className="empty-scene-reached" cx="18" cy="5" r="3" />
        <circle className="empty-scene-reached" cx="18" cy="19" r="3" />
      </g>
    </Scene>
  ),
  workspaces: () => (
    // The three rings hop one after the other.
    <Scene>
      <g transform="translate(4 4)">
        <path
          className="empty-scene-hop"
          d="M6 15c1.1 0 2 .9 2 2s-.9 2-2 2-2-.9-2-2 .9-2 2-2m0-2c-2.2 0-4 1.8-4 4s1.8 4 4 4 4-1.8 4-4-1.8-4-4-4z"
        />
        <path
          className="empty-scene-hop"
          d="M12 5c1.1 0 2 .9 2 2s-.9 2-2 2-2-.9-2-2 .9-2 2-2m0-2C9.8 3 8 4.8 8 7s1.8 4 4 4 4-1.8 4-4-1.8-4-4-4z"
        />
        <path
          className="empty-scene-hop"
          d="M18 15c1.1 0 2 .9 2 2s-.9 2-2 2-2-.9-2-2 .9-2 2-2m0-2c-2.2 0-4 1.8-4 4s1.8 4 4 4 4-1.8 4-4-1.8-4-4-4z"
        />
      </g>
    </Scene>
  ),
};

/** The moving picture for `icon`, `size` px square – where there is none, its plain symbol. */
export function EmptyScene({ icon, size = 72 }: { icon: IconName; size?: number }) {
  const scene = SCENES[icon];
  return (
    <span
      aria-hidden="true"
      className="flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      {/* The symbol alone stands as large as in a scene: 24 of its 32. */}
      {scene ? scene() : <Icon name={icon} size={Math.round((size * 24) / 32)} />}
    </span>
  );
}
