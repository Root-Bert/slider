import type { EditableElement, LiveElement, LiveParagraph, LiveRun } from '@slider/shared';
import { useLayoutEffect, useRef, type CSSProperties, type ReactNode, type Ref } from 'react';
import { listLabels } from '@slider/shared/live-text';
import { boxCss, layoutSize, paragraphCss, strutOf, textCss, u } from './css';
import { fontCss } from './fonts';
import { DEFAULT_STYLE, plainParagraph } from './model';

/*
 * Live elements as the browser draws them (the live editor): plain, context-free components,
 * so the parity check (`scripts/live-parity.ts`) draws exactly what the editor does.
 */

/** `label`: what it shows – a number counted over the text (`listLabels`), else its character. */
export function Bullet({ paragraph, label }: { paragraph: LiveParagraph; label?: string | null }) {
  const bullet = paragraph.bullet;
  if (!bullet) return null;
  const strut = strutOf(paragraph);
  return (
    <span
      aria-hidden
      contentEditable={false}
      data-live-bullet=""
      style={{
        display: 'inline-block',
        // A label wider than its room pushes the text on, a little apart (as LibreOffice does).
        minWidth: u(bullet.width),
        boxSizing: 'border-box',
        paddingRight: u(bullet.size * 0.25),
        marginLeft: u(-bullet.width),
        textIndent: 0,
        fontFamily: fontCss(bullet.font ?? strut.font),
        fontSize: u(layoutSize(bullet.size)),
        lineHeight: 0,
        color: bullet.color,
        fontWeight: 400,
        fontStyle: 'normal',
        textDecoration: 'none',
        userSelect: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      {label ?? bullet.char}
    </span>
  );
}

export function RunView({ run, paragraph }: { run: LiveRun; paragraph: LiveParagraph }) {
  return (
    <span data-live-run="" style={textCss(run, paragraph)}>
      {run.text}
    </span>
  );
}

/** An empty line keeps its height: a character of nothing in the paragraph's mark. */
export function EmptyMark({ paragraph }: { paragraph: LiveParagraph }) {
  return (
    <span data-live-run="" data-live-empty="" style={textCss(paragraph.mark, paragraph)}>
      {'​'}
    </span>
  );
}

export function ParagraphView({
  paragraph,
  first = false,
  label,
}: {
  paragraph: LiveParagraph;
  first?: boolean;
  label?: string | null;
}) {
  const runs = paragraph.runs.filter((run) => run.text);
  const last = runs.at(-1);
  return (
    <p data-live-paragraph="" style={paragraphCss(paragraph, first)}>
      <Bullet paragraph={paragraph} label={label} />
      {runs.map((run, i) => (
        <RunView key={i} run={run} paragraph={paragraph} />
      ))}
      {/* A line break at the end opens a line CSS would not show. */}
      {(!last || last.text.endsWith('\n')) && <EmptyMark paragraph={paragraph} />}
    </p>
  );
}

/** LibreOffice centres a line on the box's edge; a hairline (0) is one pixel. */
export function StrokeView({ live }: { live: LiveElement }) {
  if (!live.stroke) return null;
  const width = live.stroke.width > 0 ? u(live.stroke.width) : '1px';
  return (
    <span
      aria-hidden
      style={{
        position: 'absolute',
        inset: `calc(${width} / -2)`,
        border: `${width} solid ${live.stroke.color}`,
        pointerEvents: 'none',
      }}
    />
  );
}

const PROMPT: Record<string, string> = {
  title: 'Titel hinzufügen',
  subtitle: 'Untertitel hinzufügen',
  outline: 'Text hinzufügen',
};

/**
 * What an empty placeholder asks for, greyed, in its own font, size and alignment – where its
 * text would go: its layout's text (typed in a Slider template), else what its kind takes. Only
 * the editor draws it: LibreOffice draws an empty placeholder not at all (Prüfen, exports).
 */
export function PromptText({
  element,
  live,
  hidden = false,
}: {
  element: Pick<EditableElement, 'role'>;
  live: LiveElement;
  /** Laid out unseen: the box as high as with it. */
  hidden?: boolean;
}) {
  const paragraph = live.paragraphs[0] ?? emptyParagraph(live);
  const lines = (live.prompt ?? PROMPT[element.role ?? ''] ?? 'Text hinzufügen').split('\n');
  return (
    <div
      data-live-prompt=""
      style={{ opacity: 0.45, ...(hidden ? { visibility: 'hidden' as const } : {}) }}
    >
      {lines.map((line, i) => (
        <p key={i} style={paragraphCss(paragraph, i === 0)}>
          {line || '\u200b'}
        </p>
      ))}
    </div>
  );
}

/** The text of a live element, read-only. */
export function TextView({ live }: { live: LiveElement }) {
  const labels = listLabels(live.paragraphs);
  return (
    <div data-live-text="">
      {live.paragraphs.map((paragraph, i) => (
        <ParagraphView key={i} paragraph={paragraph} first={i === 0} label={labels[i]} />
      ))}
    </div>
  );
}

/** LibreOffice shrinks text no further than this (autofit). */
const MIN_FIT = 0.25;

/**
 * Autofit, roughly as LibreOffice does it: the text scaled down until it fits its box – laid out
 * wider by as much, so it wraps as the smaller text would. Measured anew as the box or the text
 * changes (typing); set on the node directly, so typing does not re-render.
 */
function useShrinkToFit(enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const inner = ref.current;
    const box = inner?.parentElement;
    if (!enabled || !inner || !box) return;
    const fit = () => {
      const style = getComputedStyle(box);
      const room =
        box.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      let scale = 1;
      inner.style.width = '';
      inner.style.transform = '';
      inner.style.marginBottom = '';
      for (let i = 0; i < 6; i += 1) {
        const height = inner.offsetHeight * scale;
        if (room <= 0 || height <= room + 0.5) break;
        scale = Math.max(MIN_FIT, (scale * room) / height);
        inner.style.width = `${100 / scale}%`;
        inner.style.transform = `scale(${scale})`;
        if (scale === MIN_FIT) break;
      }
      // Laid out as high as it shows, so the box aligns it (middle, bottom) by that.
      if (scale < 1) inner.style.marginBottom = `${-inner.offsetHeight * (1 - scale)}px`;
    };
    fit();
    const resize = new ResizeObserver(fit);
    resize.observe(box);
    const mutation = new MutationObserver(fit);
    mutation.observe(inner, { subtree: true, childList: true, characterData: true });
    // A font come in lays the text out anew.
    document.fonts?.addEventListener('loadingdone', fit);
    return () => {
      resize.disconnect();
      mutation.disconnect();
      document.fonts?.removeEventListener('loadingdone', fit);
    };
  }, [enabled]);
  return ref;
}

/**
 * One live element. `prompt`: an empty placeholder shows what to type (`PromptText`) – `'room'`:
 * laid out unseen (the prompt layer draws it), `'alone'`: the prompt, nothing of its shape.
 * `children` replace the text (the inline editor). `textOnly`: just the text, over LibreOffice's
 * picture of its shape – but LibreOffice draws an empty placeholder not at all, so its fill and
 * border are drawn here until it holds text.
 */
export function LiveElementView({
  element,
  live,
  prompt = false,
  textOnly = false,
  children,
  style,
  ref,
}: {
  element: EditableElement;
  live: LiveElement;
  prompt?: boolean | 'room' | 'alone';
  textOnly?: boolean;
  children?: ReactNode;
  style?: CSSProperties;
  ref?: Ref<HTMLDivElement>;
}) {
  const empty = live.placeholder && !children;
  const shrink = live.shrink === true && !live.autoGrow;
  const fitRef = useShrinkToFit(shrink);
  const content = empty
    ? prompt && <PromptText element={element} live={live} hidden={prompt === 'room'} />
    : (children ?? <TextView live={live} />);
  const shapeShown = prompt !== 'alone' && (!textOnly || live.placeholder);
  return (
    <div
      ref={ref}
      data-live-element={element.id}
      style={{ ...boxCss(element, live, !shapeShown), ...style }}
    >
      {shapeShown && <StrokeView live={live} />}
      {shrink ? (
        <div ref={fitRef} data-live-fit="" style={{ transformOrigin: '0 0', flexShrink: 0 }}>
          {content}
        </div>
      ) : (
        content
      )}
    </div>
  );
}

const emptyParagraph = (live: LiveElement): LiveParagraph =>
  plainParagraph(live.paragraphs[0]?.mark ?? DEFAULT_STYLE);
