import type { CSSProperties, ReactNode } from 'react';
import { pluralize } from '@/lib/format';
import { cn } from '@/ui';
import { faceLabel, posterLook, type FontFamily, type FontStyle } from '../../lib/font-families';

/*
 * A font's card as a type-specimen poster: the family set huge and cut off by the frame, its name,
 * faces and where it comes from printed small on a grid of hairlines. One of five layouts – a
 * giant "Ag", a giant initial, a waterfall of the name, a glyph table, the name upright along the
 * edge – on dark or on paper, picked by the name,
 * so the wall of fonts reads like a wall of posters. Sized in container units: the poster scales
 * with the card.
 */

const SOURCE_LABELS: Record<FontFamily['source'], string> = {
  slider: 'Slider',
  workspace: 'Workspace',
};

/** The family's text in one face – nothing until the card is near the screen (no download). */
const set = (family: FontFamily, face: FontStyle | undefined, near: boolean) =>
  near
    ? ({
        fontFamily: family.css,
        fontWeight: face?.weight ?? 400,
        fontStyle: face?.italic ? 'italic' : 'normal',
      } satisfies CSSProperties)
    : undefined;

/** The upright bold if there is one, else the last face. */
const heaviest = (family: FontFamily) =>
  family.faces.find((face) => face.weight === 700 && !face.italic) ?? family.faces.at(-1);

const Meta = ({ children, className }: { children: ReactNode; className?: string }) => (
  <span
    className={cn('text-[2.1cqw] leading-tight tracking-[0.14em] uppercase opacity-60', className)}
  >
    {children}
  </span>
);

interface PosterProps {
  family: FontFamily;
  near: boolean;
}

/** Name top left, source and face count top right, over a hairline. */
function Header({ family, near }: PosterProps) {
  return (
    <div className="flex items-start justify-between gap-[3cqw] border-b border-current/15 pb-[2.2cqw]">
      <span
        style={set(family, family.faces[0], near)}
        className="truncate text-[5.2cqw] leading-none"
      >
        {family.family}
      </span>
      <span className="flex shrink-0 flex-col items-end">
        <Meta>{SOURCE_LABELS[family.source]}</Meta>
        <Meta>{pluralize(family.faces.length, 'Schnitt', 'Schnitte')}</Meta>
      </span>
    </div>
  );
}

/** A giant "Ag" in the heaviest face, cut off at the bottom right; the character set below left. */
function GlyphPoster({ family, near }: PosterProps) {
  return (
    <>
      <Header family={family} near={near} />
      <span
        style={set(family, heaviest(family), near)}
        className="absolute -right-[3cqw] -bottom-[11cqw] text-[60cqw] leading-none tracking-tight"
      >
        Ag
      </span>
      <span
        style={set(family, family.faces[0], near)}
        className="absolute bottom-[4.5cqw] left-[4.5cqw] flex flex-col text-[2.4cqw] leading-snug opacity-60"
      >
        <span>ABCDEFGHIJKLM</span>
        <span>NOPQRSTUVWXYZ</span>
        <span>abcdefghijklm</span>
        <span>0123456789</span>
      </span>
    </>
  );
}

/** The name's initial, giant and cut off on the left; name and faces, each in itself, on the right. */
function InitialPoster({ family, near }: PosterProps) {
  const name = family.family.trim();
  // A narrow letter alone is just a bar: it takes the next one along ("In").
  const initial = /^[IJijl1]/.test(name)
    ? `${name.charAt(0).toUpperCase()}${name.charAt(1)}`
    : name.charAt(0).toUpperCase() || 'A';
  return (
    <>
      <span
        style={set(family, family.faces[0], near)}
        className="absolute -top-[8cqw] -left-[5cqw] text-[78cqw] leading-none"
      >
        {initial}
      </span>
      {/* Over a wide initial: the column takes the poster's colour. */}
      <div className="absolute inset-y-0 right-0 flex w-[44.5cqw] flex-col justify-between border-l border-current/15 bg-inherit py-[4.5cqw] pr-[4.5cqw] pl-[3cqw]">
        <div className="flex flex-col gap-[1.2cqw]">
          <Meta>{SOURCE_LABELS[family.source]}</Meta>
          <span style={set(family, family.faces[0], near)} className="text-[5.6cqw] leading-none">
            {family.family}
          </span>
        </div>
        <ul className="flex flex-col gap-[0.6cqw] text-[2.8cqw] leading-tight">
          {family.faces.map((face) => (
            <li key={faceLabel(face)} style={set(family, face, near)} className="truncate">
              {faceLabel(face)}
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

const WATERFALL = [
  { size: 'text-[19cqw]', pt: 72 },
  { size: 'text-[11cqw]', pt: 42 },
  { size: 'text-[6.5cqw]', pt: 24 },
  { size: 'text-[3.8cqw]', pt: 14 },
];

/** The name in falling sizes, cut off on the right, each line in the next face; sizes in the margin. */
function WaterfallPoster({ family, near }: PosterProps) {
  return (
    <>
      <div className="flex items-start justify-between">
        <Meta>{SOURCE_LABELS[family.source]}</Meta>
        <Meta>{pluralize(family.faces.length, 'Schnitt', 'Schnitte')}</Meta>
      </div>
      <div className="mt-auto flex flex-col">
        {WATERFALL.map(({ size, pt }, i) => (
          <div
            key={pt}
            className="flex items-baseline gap-[2cqw] border-t border-current/15 first:border-t-0"
          >
            <Meta className="w-[6cqw] shrink-0">{pt}</Meta>
            <span
              style={set(family, family.faces[i % family.faces.length], near)}
              className={cn('leading-[1.05] whitespace-nowrap', size)}
            >
              {family.family}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

const GLYPHS = ['B', 'g', '&', 'Q', 'e', 'R', 'y', 'ß', '?', '1', '@', '%'];

/**
 * A glyph table: hairline cells, a big one with "Aa", one with the name and what it has, the
 * others one character each, going through the faces.
 */
function TablePoster({ family, near }: PosterProps) {
  return (
    // Every cell draws its right and bottom hairline; the table reaches 1px past the frame, so
    // the outer ones fall outside it.
    <div className="-m-[4.5cqw] grid h-[calc(100%+9cqw+1px)] w-[calc(100%+9cqw+1px)] grid-cols-6 grid-rows-3 [&>*]:border-r [&>*]:border-b [&>*]:border-current/15">
      <span
        style={set(family, family.faces[0], near)}
        className="col-span-2 row-span-2 flex items-end p-[2.5cqw] text-[25cqw] leading-[0.8]"
      >
        Aa
      </span>
      {GLYPHS.slice(0, 8).map((glyph, i) => (
        <span
          key={glyph}
          style={set(family, family.faces[i % family.faces.length], near)}
          className="flex items-center justify-center text-[7.5cqw] leading-none"
        >
          {glyph}
        </span>
      ))}
      <span className="col-span-2 flex flex-col justify-between p-[2.5cqw]">
        <span
          style={set(family, family.faces[0], near)}
          className="truncate text-[3.6cqw] leading-none"
        >
          {family.family}
        </span>
        <Meta>
          {SOURCE_LABELS[family.source]} · {pluralize(family.faces.length, 'Schnitt', 'Schnitte')}
        </Meta>
      </span>
      {GLYPHS.slice(8).map((glyph, i) => (
        <span
          key={glyph}
          style={set(family, family.faces[(i + 8) % family.faces.length], near)}
          className="flex items-center justify-center text-[7.5cqw] leading-none"
        >
          {glyph}
        </span>
      ))}
    </div>
  );
}

/**
 * The name set upright along the left edge in the heaviest face, huge and cut off; beside it a
 * line of copy in the family and its faces.
 */
function UprightPoster({ family, near }: PosterProps) {
  return (
    <>
      <span
        // Bottom-anchored and turned: the name starts at the bottom and runs out at the top.
        style={set(family, heaviest(family), near)}
        className="absolute bottom-[3cqw] -left-[3cqw] rotate-180 text-[24cqw] leading-[0.85] whitespace-nowrap [writing-mode:vertical-rl]"
      >
        {family.family}
      </span>
      <div className="ml-auto flex h-full w-[60%] flex-col justify-between border-l border-current/15 pl-[3.5cqw]">
        <div className="flex items-start justify-between gap-[2cqw]">
          <Meta>{SOURCE_LABELS[family.source]}</Meta>
          <Meta>{pluralize(family.faces.length, 'Schnitt', 'Schnitte')}</Meta>
        </div>
        <span style={set(family, family.faces[0], near)} className="text-[6.4cqw] leading-[1.05]">
          Gute Ideen brauchen gute Schrift.
        </span>
        <span className="flex flex-wrap gap-x-[2.5cqw] text-[2.6cqw]">
          {family.faces.map((face) => (
            <span key={faceLabel(face)} style={set(family, face, near)}>
              {faceLabel(face)}
            </span>
          ))}
        </span>
      </div>
    </>
  );
}

// As many as `POSTER_LAYOUTS`.
const LAYOUTS = [GlyphPoster, InitialPoster, WaterfallPoster, TablePoster, UprightPoster];

export function FontPoster({ family, near }: PosterProps) {
  const { layout, paper } = posterLook(family);
  const Layout = LAYOUTS[layout] as (typeof LAYOUTS)[number];
  return (
    // The container the poster's sizes (cqw) refer to, around the poster itself.
    <div aria-hidden className="@container size-full">
      <div
        className={cn(
          'relative flex size-full flex-col overflow-hidden p-[4.5cqw]',
          paper ? 'bg-fg text-canvas' : 'specimen-surface text-fg',
        )}
      >
        <Layout family={family} near={near} />
      </div>
    </div>
  );
}
