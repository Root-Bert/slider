import { useRef, type CSSProperties } from 'react';
import { AutosizeTextarea, Avatar, Button, cn, IconButton } from '@/ui';
import { SwapImage } from '../stage/SwapImage';
import { useViewerData } from '../state/viewer-data';
import type { useVariantAsk } from './hooks/useVariantFlow';

/** The AI field's sage edge and glow, as on the box drawn for the AI (`AiBoxComposer`). */
const AI_FIELD: CSSProperties = {
  boxShadow:
    'inset 0 0 0 1px color-mix(in srgb, var(--color-sage) 55%, transparent), 0 0 24px color-mix(in srgb, var(--color-sage) 25%, transparent), var(--shadow-float)',
};

/** What people ask for most – a click writes it into the field, to send or to add to. */
const IDEAS = ['Dunkler', 'Mit Bild', 'Weniger Text', 'Anderes Layout'] as const;

/**
 * The field of „Variante erstellen“ – on the slide's tile and in the phone's sheet: in the AI's
 * look (its avatar, its sage edge), what to ask for a click away, ↵ sends it to the AI. „Kopie
 * erstellen“ makes the variant a copy to work on by hand – as ↵ on the empty field does.
 */
export function VariantComposer({
  ask,
  onSubmit,
  onCopy,
  ideas = true,
  panel = false,
}: {
  ask: Pick<ReturnType<typeof useVariantAsk>, 'prompt' | 'setPrompt' | 'typed'>;
  /** ↵ or the send button: words to the AI, none a copy. */
  onSubmit: () => void;
  onCopy: () => void;
  /** No room for them on a small tile. */
  ideas?: boolean;
  /** Over the slide (its tile): all of it one panel in the AI's look, not the field alone. */
  panel?: boolean;
}) {
  const { aiAuthor } = useViewerData();
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const { prompt, setPrompt, typed } = ask;
  const add = (idea: string) => {
    const words = prompt.trim();
    // Added to what is there, as one would go on writing.
    setPrompt(words ? `${words}, ${idea[0]!.toLowerCase()}${idea.slice(1)}` : idea);
    fieldRef.current?.focus({ preventScroll: true });
  };
  return (
    <div
      className={cn('flex flex-col gap-2', panel && 'glass-elevated rounded-panel p-1.5')}
      style={panel ? AI_FIELD : undefined}
    >
      <div
        className={cn(
          'relative flex items-start gap-1.5',
          !panel && 'glass-elevated rounded-panel py-1 pr-1 pl-1.5',
        )}
        style={panel ? undefined : AI_FIELD}
      >
        <Avatar author={aiAuthor} size={24} nativeTitle={false} className="my-1" />
        <AutosizeTextarea
          ref={fieldRef}
          autoFocus
          aria-label="Was soll anders sein?"
          placeholder="Was soll anders sein?"
          maxHeight={120}
          maxLength={4_000}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            // ↵ creates, ⇧↵ is a new line – as in the comments.
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              onSubmit();
            }
          }}
          className="min-w-0 flex-1 py-1.5 text-body leading-5 text-fg"
        />
        <IconButton
          icon="send"
          label="Mit KI erstellen"
          title="Mit KI erstellen (↵)"
          size="compact"
          disabled={!typed}
          onClick={onSubmit}
        />
      </div>
      {ideas && (
        <div
          role="group"
          aria-label="Vorschläge"
          className={cn('flex flex-wrap gap-1.5', panel && 'px-1')}
        >
          {IDEAS.map((idea) => (
            <Button key={idea} variant="soft" tone="strong" size="xs" onClick={() => add(idea)}>
              {idea}
            </Button>
          ))}
        </div>
      )}
      <div className={cn('flex items-center gap-2', panel && 'pr-2')}>
        <Button variant="ghost" size="xs" icon="difference" onClick={onCopy}>
          Kopie erstellen
        </Button>
        <span className="ml-auto text-caption text-fg-subtle">
          {typed ? '↵ erstellt mit KI' : '↵ erstellt eine Kopie'}
        </span>
      </div>
    </div>
  );
}

/**
 * The slide a variant is made of, as the ground of its tile: dimmed under the field (one sees
 * what one asks to change), in full with the AI's light over it while the AI works – then
 * `preview`, the AI's latest drawing of the variant, takes its place without a blank frame.
 * Fills its positioned parent.
 */
export function VariantGround({
  slideId,
  preview = null,
  working = false,
}: {
  slideId: string;
  preview?: string | null;
  working?: boolean;
}) {
  const { slides, slideIndex } = useViewerData();
  const index = slideIndex.get(slideId);
  const slide = index === undefined ? undefined : slides[index];
  if (!slide) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]"
    >
      <SwapImage
        src={preview ?? slide.imageUrl}
        initialSrc={slide.thumbnailUrl}
        alt=""
        draggable={false}
        className={cn('object-cover transition-opacity duration-300', !working && 'opacity-40')}
      />
      {working && (
        // The light the AI reads a marked area with (`AiScan`), over the whole slide.
        <>
          <span className="ai-scan-tint absolute inset-0" />
          <span className="ai-scan-wash absolute inset-0" />
          <span className="ai-scan-dots absolute inset-0">
            <span className="ai-scan-wash ai-scan-wash-bright absolute inset-0" />
          </span>
          <span className="ai-rim absolute inset-0 rounded-[inherit]" />
        </>
      )}
    </div>
  );
}
