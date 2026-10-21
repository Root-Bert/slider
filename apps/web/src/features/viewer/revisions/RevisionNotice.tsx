import { Button, cn, IconButton } from '@/ui';
import { useGoToSlide } from '../hooks/useGoToSlide';
import { revisionNoticeText } from './lib/revision-changes';
import { useRevisionData, type RevisionAnnouncement } from '../state/revision-data';
import { useViewerData } from '../state/viewer-data';
import { useViewerDispatch } from '../state/viewer-state';

/**
 * "V5 geladen | 3 Folien geändert, 1 neu, 1 gelöscht | Änderungen ansehen" in the version pill
 * after a new revision arrived (BER-109; replaces the "Neue Version" banner). It stays until it
 * is closed or its action is used: "Änderungen ansehen" turns the change markers on and goes to
 * the first changed slide – or opens the deleted slides when only slides were removed.
 *
 * Not a live region itself – `RevisionControls` keeps one mounted, so screen readers hear it
 * reliably (a region that appears together with its text is often not read).
 */
export function RevisionNotice({
  announcement,
  onDone,
}: {
  announcement: RevisionAnnouncement;
  onDone: () => void;
}) {
  const text = revisionNoticeText(announcement.revisionNumber, announcement.summary);
  const { slides } = useViewerData();
  const { badges, deletedSlides } = useRevisionData();
  const dispatch = useViewerDispatch();
  const goToSlide = useGoToSlide();
  const firstChanged = slides.findIndex((slide) => badges.has(slide.id));
  const canShow = firstChanged >= 0 || deletedSlides.length > 0;

  const showChanges = () => {
    dispatch({ type: 'showChangesSet', show: true });
    if (firstChanged >= 0) goToSlide(firstChanged);
    else dispatch({ type: 'deletedPanelSet', open: true });
    onDone();
  };

  return (
    <span
      data-revision-notice
      title={text}
      className={cn(
        'flex h-8 min-w-0 animate-slide-in-x items-center gap-1 rounded-control bg-surface-2 pr-0.5 pl-2.5 text-xs text-fg',
        'max-w-[440px]',
      )}
    >
      {/* Phones: the controls row has no room for more than the version and the action – the
          full text is the tooltip and the live region's. */}
      <span aria-hidden className="min-w-0 truncate">
        V{announcement.revisionNumber} geladen
        {announcement.summary?.text && (
          <span className="max-sm:hidden"> | {announcement.summary.text}</span>
        )}
      </span>
      {canShow && (
        <Button variant="soft" tone="strong" size="xs" onClick={showChanges} className="ml-1">
          Änderungen ansehen
        </Button>
      )}
      <IconButton icon="close" label="Hinweis schließen" size="sm" onClick={onDone} />
    </span>
  );
}
