import { useEffect, useId, useRef, useState } from 'react';
import { useAiProposals } from '@/lib/api';
import { AutosizeTextarea, Button, Icon, IconButton, useFocusLoop } from '@/ui';
import { AiProposalCard } from '../comments/AiProposalCard';
import { SidePanel, SidePanelHeader } from '../components/SidePanel';
import { useEditing } from '../editing/editing-context';
import { useRestoreFocus } from '../hooks/useRestoreFocus';
import { useViewerData } from '../state/viewer-data';
import { useViewerToast } from '../state/viewer-toast';
import { useVariantAsk } from './hooks/useVariantFlow';
import {
  madeByProposal,
  setVariantSheet,
  useVariantRequest,
  useVariantSheet,
} from './lib/variant-requests';

/**
 * „Variante erstellen“ on a phone, where no variant track holds the slide's tile: the tile's
 * field in a bottom sheet (`SidePanel`) – words to the AI, nothing typed „Kopie erstellen“ (the
 * copy made at once, as on the tile). Asked of the AI, the sheet shows it at work and then its
 * answer – what it did, „Änderung zurücknehmen“ – with the variant's picture and „Verwenden“ (no
 * variant track on a phone to see it on); closed meanwhile, the toast still says when it is in.
 */
export function VariantSheet() {
  const slideId = useVariantSheet();
  if (!slideId) return null;
  return <VariantSheetView key={slideId} slideId={slideId} />;
}

function VariantSheetView({ slideId }: { slideId: string }) {
  const { deck, variantsOf } = useViewerData();
  const editing = useEditing();
  const toast = useViewerToast();
  const request = useVariantRequest(slideId);
  const { prompt, setPrompt, typed, submit, pending } = useVariantAsk(slideId);
  // The run this sheet asked for (or found at work on the slide when it opened).
  // Kept once the request is done (`useVariantFlow` drops it).
  const [proposalId, setProposalId] = useState(request?.proposalId ?? null);
  if (request && request.proposalId !== proposalId) setProposalId(request.proposalId);
  const { data: proposals } = useAiProposals(deck.id, proposalId !== null);
  const proposal = proposals?.find((item) => item.id === proposalId);
  // The variant it made – shown here, since a phone has no variant track to show it on.
  const made =
    proposal?.status === 'applied'
      ? editing.state?.slides.find((item) => madeByProposal(item.pageId, proposal.id))
      : undefined;
  const variant = made && variantsOf.get(slideId)?.find((item) => item.id === made.slideId);
  const use = () => {
    if (!made) return;
    close();
    void editing
      .apply([{ type: 'useVariant', pageId: made.pageId }])
      .then((ok) => ok && toast('Variante verwendet'));
  };
  const asked = proposalId !== null || pending;

  const panelRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const close = () => setVariantSheet(null);
  useRestoreFocus();
  // The focus goes to the field (`autoFocus`), or to the panel once it was asked.
  useFocusLoop(panelRef);
  useEffect(() => {
    if (asked && !panelRef.current?.contains(document.activeElement))
      panelRef.current?.focus({ preventScroll: true });
  }, [asked]);

  const send = () => {
    if (submit() === 'copy') close();
  };

  return (
    <SidePanel
      ref={panelRef}
      data-variant-sheet={slideId}
      role="dialog"
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        // Esc leaves it, as every panel.
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        close();
      }}
    >
      <SidePanelHeader gap="sm">
        <div className="flex items-center gap-2">
          <Icon name="difference" size={20} className="shrink-0 text-fg-muted" />
          <h2 id={titleId} className="min-w-0 flex-1 truncate text-base font-semibold text-fg">
            Variante erstellen
          </h2>
          <IconButton icon="close" label="Schließen (Esc)" size="sm" onClick={close} />
        </div>
      </SidePanelHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-5 pt-4 pb-6">
        {asked ? (
          <>
            {request && <p className="line-clamp-3 text-xs text-fg-muted">{request.prompt}</p>}
            {proposal ? (
              <AiProposalCard proposal={proposal} />
            ) : (
              <p className="text-sm text-fg-muted">Variante wird erstellt …</p>
            )}
            {variant && (
              <img
                src={variant.thumbnailUrl}
                alt={variant.title ?? 'Variante'}
                draggable={false}
                className="w-full rounded-thumb border border-hairline"
                style={{ aspectRatio: variant.aspectRatio }}
              />
            )}
            {made && (
              // As the variant's badge: it takes its slide's place in the deck.
              <Button variant="primary" icon="compareArrows" disabled={editing.busy} onClick={use}>
                Verwenden
              </Button>
            )}
          </>
        ) : (
          <>
            <div className="field-well focus-field rounded-control-sm px-3 py-2">
              <AutosizeTextarea
                autoFocus
                aria-label="Was soll anders sein?"
                placeholder="Was soll anders sein? z. B. dunkler, mit Bild rechts"
                maxLength={4_000}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  // ↵ creates, ⇧↵ is a new line – as on the tile.
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    send();
                  }
                }}
                className="min-h-15 text-sm leading-5 text-fg"
              />
            </div>
            <Button
              variant="primary"
              icon={typed ? 'autoAwesome' : 'difference'}
              disabled={editing.busy}
              onClick={send}
            >
              {typed ? 'Mit KI erstellen' : 'Kopie erstellen'}
            </Button>
          </>
        )}
      </div>
    </SidePanel>
  );
}
