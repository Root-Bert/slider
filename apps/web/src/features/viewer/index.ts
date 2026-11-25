import { lazy } from 'react';

/*
 * Public API of the viewer for other features. The deck page itself is a lazy route
 * (`app/router.tsx` imports `DeckPage` directly), so it is not exported here.
 */
export {
  buildThreads,
  doneByAi,
  isBareDrawing,
  isRemovedInSource,
  type Thread,
} from './comments/lib/comment-selectors';
export { CommentPreview } from './comments/CommentPreview';
export {
  cssFamily,
  editorFonts,
  officeFontStyles,
  registerOfficeFonts,
} from './editing/live/fonts';
// The font and size fields of the format panel, for a document's text too.
export { FontField } from './editing/FontField';
export { PickField, SizeField } from './editing/StyleControls';
export { gridTracks } from './template/layout-grid';
// The editor's outbox: installed with the app, it sends unsent edits whichever page is open.
export { editsUnsentBeforeSignOut, installEditOutbox } from './editing/edit-outbox-app';
// The last run through a deck („Letzter Durchgang“ in the deck's menu).
export { useShowRun, useShowRuns, type ShowRun } from './presentation/lib/show-runs';
export { SummaryLine, SummaryRows } from './presentation/RunSummary';
// What is typed into a creation prompt, kept in this browser (Folie 1, and Neue Präsentation).
export {
  clearCreationDraft,
  loadCreationDraft,
  saveCreationDraft,
  type CreationDraft,
} from './creation/creation-draft';
// The chat with the AI in a side panel – beside the material, and beside the files in Cloud.
export {
  AnswerBody,
  ChatAnswer,
  ChatMessage,
  ChatPanel,
  type Chat,
  type ChatEntry,
} from './board/ChatPanel';
export { useAgentChat } from './board/agent-chat';
// „Material“ beside a text document too: the board's page (loaded when first needed), the tile
// that opens it, and what the page asks of its host (`BoardOwner`).
export const MaterialPage = lazy(() =>
  import('./board/MaterialPage').then((module) => ({ default: module.MaterialPage })),
);
export { MaterialTile } from './board/MaterialTile';
export { BoardOwnerContext, DOCUMENT_WORDING, type BoardOwner } from './board/board-owner';
export { useMaterialUrlSync } from './hooks/useSlideUrlSync';
// Speaking to the AI: the microphone, its pieces, the live words and the bar – for a text document
// too (Writer's `WriterVoiceProvider` gives the same `VoiceContext`).
export { VoiceBarView, type VoiceBarHost, type VoiceBarItem } from './voice/VoiceBar';
export { VoiceContext, type VoiceState, type VoiceStatus } from './voice/voice-context';
export { encodeWav, levelOf } from './voice/lib/audio';
export { pieceWords, type LiveCaption } from './voice/lib/caption';
export { LiveTranscript, type LiveSignal } from './voice/lib/live-transcript';
export { Segmenter } from './voice/lib/segmenter';
export { openMicrophone, prepareMicrophone, type Microphone } from './voice/lib/vad';
export { canRecord } from './media/lib/recording';
// Recording a video to send – with its editor (a message in Sender).
export { RecorderPanel } from './media/RecorderPanel';
export { describeError } from './media/lib/recorder-errors';
// The photo search, for a text document's pictures too.
export { PhotoGrid } from './editing/photos/StockPhotoSearch';
export { ImagePrompt } from './editing/photos/GenerateImage';
export { PhotoCredit } from './editing/photos/PhotoCredit';
export { usePhotoTerm } from './editing/photos/photo-term';
// The comment filter's chips, for a text document's comments too.
export { statusSegments } from './comments/lib/status-segments';
// @mentions in a comment field and its text, for a text document's comments too.
export { CommentBody } from './comments/CommentBody';
export { MentionMenu } from './comments/MentionMenu';
export { MentionTextarea } from './comments/MentionTextarea';
export { useMentions } from './comments/hooks/useMentions';
export { MentionPeopleContext, type MentionPeople } from './comments/mention-people';
// An unsent reply kept per thread while the field comes and goes.
export { useReplyDraftBody } from './comments/lib/reply-drafts';
// Reactions held elsewhere (a document's comment): their state, chips and menu entries.
export { ReactionChipsOf, ReactionPickerOf } from './comments/Reactions';
export {
  reactionMenuActions,
  reactionState,
  type ReactionState,
} from './comments/hooks/useCommentReaction';
