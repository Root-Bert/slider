import type { ReactNode } from 'react';
import {
  IconButton,
  MenuItem,
  PopoverPanel,
  Toolbar,
  ToolbarDivider,
  usePopover,
  type IconName,
} from '@/ui';
import { isApplePlatform } from '@/lib/platform';
import type { Tool } from './PdfPageView';
import { SignaturePanel, type PickedSignature } from './SignaturePanel';
import { useMarks, useReader } from './session';

export type ZoomChoice = 'fit' | number;
export const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3] as const;

const mod = () => (isApplePlatform() ? '⌘' : 'Strg ');

/** A tool whose choices open above the bar, from its end of it. */
function Flyout({
  icon,
  label,
  active,
  align = 'left',
  children,
}: {
  icon: IconName;
  label: string;
  active?: boolean;
  align?: 'left' | 'right';
  children: (close: () => void) => ReactNode;
}) {
  const { open, close, wrapperRef, triggerProps, panelRef, panelId } = usePopover({
    hasPopup: true,
  });
  return (
    <div ref={wrapperRef} className="relative">
      <IconButton
        {...triggerProps}
        icon={icon}
        label={label}
        expanded={open}
        active={active}
        size="sm"
      />
      {open && (
        <PopoverPanel
          ref={panelRef}
          id={panelId}
          position="none"
          padding="sm"
          aria-label={label}
          className={
            align === 'left'
              ? 'absolute bottom-full left-0 mb-3 min-w-44 origin-bottom-left'
              : 'absolute right-0 bottom-full mb-3 min-w-44 origin-bottom-right'
          }
        >
          {children(close)}
        </PopoverPanel>
      )}
    </div>
  );
}

/**
 * The tools along the bottom, as in Slider and Writer: on the left what a click on the page does
 * (pick, write, tick, sign, comment) and what goes back, on the right how large the pages are.
 */
export function ReaderToolbar({
  tool,
  onTool,
  onSignature,
  zoom,
  shownZoom,
  onZoom,
  onUndo,
  onRedo,
}: {
  tool: Tool;
  onTool: (tool: Tool) => void;
  onSignature: (signature: PickedSignature) => void;
  zoom: ZoomChoice;
  shownZoom: number;
  onZoom: (zoom: ZoomChoice) => void;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const { pdf } = useReader();
  const state = useMarks();
  const canEdit = pdf.permissions.canEdit;
  const canComment = pdf.permissions.canComment;
  const pick = (kind: 'select' | 'text' | 'check' | 'comment') => () =>
    onTool(tool.kind === kind && kind !== 'select' ? { kind: 'select' } : { kind });

  return (
    <div
      data-chrome
      className="pointer-events-none fixed inset-x-3 bottom-3 z-(--z-chrome) flex items-end justify-between gap-3 *:pointer-events-auto"
    >
      <Toolbar label="Werkzeuge">
        <IconButton
          icon="cursor"
          label="Auswählen (V)"
          size="sm"
          active={tool.kind === 'select'}
          aria-pressed={tool.kind === 'select'}
          onClick={pick('select')}
        />
        {canEdit && (
          <>
            <IconButton
              icon="textFields"
              label="Text (T)"
              size="sm"
              active={tool.kind === 'text'}
              aria-pressed={tool.kind === 'text'}
              onClick={pick('text')}
            />
            <IconButton
              icon="check"
              label="Haken (X)"
              size="sm"
              active={tool.kind === 'check'}
              aria-pressed={tool.kind === 'check'}
              onClick={pick('check')}
            />
            <Flyout icon="draw" label="Unterschrift (S)" active={tool.kind === 'signature'}>
              {(close) => (
                <SignaturePanel
                  onPick={(signature) => {
                    close();
                    onSignature(signature);
                  }}
                />
              )}
            </Flyout>
          </>
        )}
        {canComment && (
          <IconButton
            icon="addComment"
            label="Kommentar (C)"
            title="Kommentar (C): Bereich ziehen oder klicken"
            size="sm"
            active={tool.kind === 'comment'}
            aria-pressed={tool.kind === 'comment'}
            onClick={pick('comment')}
          />
        )}
        {canEdit && (
          <>
            <ToolbarDivider />
            <IconButton
              icon="undo"
              label={`Rückgängig (${mod()}Z)`}
              size="sm"
              disabled={!state.canUndo}
              onClick={onUndo}
            />
            <IconButton
              icon="redo"
              label={`Wiederholen (⇧${mod()}Z)`}
              size="sm"
              disabled={!state.canRedo}
              onClick={onRedo}
            />
          </>
        )}
      </Toolbar>
      <Toolbar label="Ansicht" role="group">
        <Flyout icon="fitSize" label={`Größe (${Math.round(shownZoom * 100)} %)`} align="right">
          {(close) => (
            <>
              <MenuItem
                inset={4}
                selected={zoom === 'fit'}
                onClick={() => {
                  onZoom('fit');
                  close();
                }}
              >
                Einpassen
              </MenuItem>
              {ZOOMS.map((each) => (
                <MenuItem
                  key={each}
                  inset={4}
                  selected={zoom === each}
                  onClick={() => {
                    onZoom(each);
                    close();
                  }}
                >
                  {each * 100} %
                </MenuItem>
              ))}
            </>
          )}
        </Flyout>
      </Toolbar>
    </div>
  );
}
