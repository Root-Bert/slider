/*
 * Where components may still use raw colours (design-system rule 1, enforced by
 * `design-tokens.test.ts`). Paths are relative to `apps/web/src`.
 */

export interface RawColorException {
  /** A file, or a directory prefix ending in `/`. */
  path: string;
  /** `'all'`, or the raw colours (as the scanner reports them) that are fine here. */
  allow: 'all' | readonly RegExp[];
  reason: string;
}

const HEX = /^\[?#[0-9a-fA-F]{3,8}\]?$/;
const RGB = /^rgba?\($/;
const ON_ACCENT = /^(?:text-black|text-white|'black'|'white')$/;

/** Raw colours that stay, each with the reason. */
export const PERMANENT: readonly RawColorException[] = [
  {
    path: 'ui/brand/',
    allow: 'all',
    reason: 'Provider and app marks (Google, Microsoft, PowerPoint) keep their brand colours.',
  },
  {
    path: 'features/viewer/connectors/ConnectorLines.tsx',
    allow: [/^"(?:white|black)"$/],
    reason: 'SVG mask paint: white keeps, black cuts out – luminance, not a visible colour.',
  },
  {
    path: 'features/reviews/ReviewsPage.tsx',
    allow: [ON_ACCENT],
    reason: 'On-accent text for the selection colour, decided by isLightAccent (lib/accent.ts).',
  },
  {
    path: 'features/viewer/controls/ParticipantAvatars.tsx',
    allow: [ON_ACCENT],
    reason: 'On-accent check mark in the colour picker, decided by isLightAccent.',
  },
  {
    path: 'features/viewer/live/LiveCursor.tsx',
    allow: [ON_ACCENT],
    reason: 'On-accent name label of a live cursor, decided by isLightAccent.',
  },
  {
    path: 'features/account/components/PreferenceSections.tsx',
    allow: [ON_ACCENT],
    reason: 'On-accent check mark in the colour preference, decided by isLightAccent.',
  },
  {
    path: 'ui/CountBubble.tsx',
    allow: [/^text-white$/],
    reason: 'Comment count on an accent fill: white on every accent, as in the design.',
  },
  {
    path: 'features/viewer/import/',
    allow: [HEX, RGB],
    reason: 'Import stage: the ghost slides, tiles and minimap are a drawn illustration.',
  },
  {
    path: 'features/reviews/components/EmptyState.tsx',
    allow: [HEX, RGB, /^"white"$/],
    reason: 'Empty-state illustration (two stacked slides with a pin), drawn in SVG.',
  },
  {
    path: 'features/viewer/stage/GuideLayer.tsx',
    allow: [RGB, /^text-white$/],
    reason: 'PowerPoint guide colours (cyan guides, red overflow) shown over the slide image.',
  },
];

/**
 * Files not migrated to tokens yet (generated from the scanner when the guard was introduced).
 * Remove a file once it is clean; never add one – use a token or a PERMANENT entry instead.
 */
export const ALLOW_PENDING_MIGRATION: readonly string[] = [
  'features/account/AccountPage.tsx',
  'features/account/components/AccountSections.tsx',
  'features/account/components/PreferenceSections.tsx',
  'features/auth/LoginPage.tsx',
  'features/auth/components/LoginOptions.tsx',
  'features/onboarding/components/NoAccessCard.tsx',
  'features/onboarding/components/OneDrivePicker.tsx',
  'features/onboarding/components/UploadDropzone.tsx',
  'features/onboarding/components/UploadProgressCard.tsx',
  'features/reviews/components/DeckBits.tsx',
  'features/reviews/components/DeckCard.tsx',
  'features/reviews/components/DeckTitleInput.tsx',
  'features/reviews/components/FolderTiles.tsx',
  'features/reviews/components/MoveDecksDialog.tsx',
  'features/reviews/components/OpenComments.tsx',
  'features/setup/components/SetupForm.tsx',
  'features/viewer/comments/CommentBubble.tsx',
  'features/viewer/comments/CommentCard.tsx',
  'features/viewer/comments/CompactCard.tsx',
  'features/viewer/comments/Composer.tsx',
  'features/viewer/comments/MediaTabs.tsx',
  'features/viewer/comments/MentionMenu.tsx',
  'features/viewer/comments/ReplyComposer.tsx',
  'features/viewer/comments/ResolveButton.tsx',
  'features/viewer/comments/RevisionNotes.tsx',
  'features/viewer/comments/ThreadMessage.tsx',
  'features/viewer/comments/ThreadPanel.tsx',
  'features/viewer/controls/ParticipantAvatars.tsx',
  'features/viewer/controls/RevisionControls.tsx',
  'features/viewer/controls/SlideCounter.tsx',
  'features/viewer/controls/ToolBar.tsx',
  'features/viewer/import/ImportProgress.tsx',
  'features/viewer/import/ImportStage.tsx',
  'features/viewer/import/stage/GhostControls.tsx',
  'features/viewer/import/stage/GhostMinimap.tsx',
  'features/viewer/import/stage/SlideSketch.tsx',
  'features/viewer/live/LiveCursor.tsx',
  'features/viewer/media/CommentImageView.tsx',
  'features/viewer/media/MediaPlayer.tsx',
  'features/viewer/media/RecordReplyDialog.tsx',
  'features/viewer/media/RecorderPanel.tsx',
  'features/viewer/media/SketchPanel.tsx',
  'features/viewer/media/SketchReplyDialog.tsx',
  'features/viewer/media/Waveform.tsx',
  'features/viewer/revisions/ChangeBadge.tsx',
  'features/viewer/revisions/DeletedSlidesEntry.tsx',
  'features/viewer/revisions/DeletedSlidesPanel.tsx',
  'features/viewer/revisions/RevisionBanners.tsx',
  'features/viewer/revisions/RevisionNotice.tsx',
  'features/viewer/stage/DraftMark.tsx',
  'features/viewer/stage/EditableFrame.tsx',
  'features/viewer/stage/GapDivider.tsx',
  'features/viewer/stage/Pin.tsx',
  'features/viewer/stage/ShapeOutline.tsx',
  'features/viewer/stage/SlideFrame.tsx',
  'features/viewer/stage/TextBox.tsx',
  'features/viewer/timeline/CommentColumns.tsx',
  'features/viewer/timeline/Minimap.tsx',
  'features/viewer/timeline/SplitHandle.tsx',
  'features/viewer/timeline/Timeline.tsx',
  'features/workspaces/components/AccountMenu.tsx',
  'features/workspaces/components/HeaderPopover.tsx',
  'features/workspaces/components/Invites.tsx',
  'features/workspaces/components/JoinParts.tsx',
  'features/workspaces/components/MembersSection.tsx',
  'features/workspaces/components/PendingInvites.tsx',
  'features/workspaces/components/PlanUsage.tsx',
  'features/workspaces/components/WorkspaceMark.tsx',
  'features/workspaces/components/WorkspaceSwitcher.tsx',
];
