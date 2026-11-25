/** Public API of Sender (the workspace's conversations) – what Cloud shows of it. */
export { Conversation } from './ChannelPage';
export { Composer } from './components/Composer';
export { TypingLine } from './components/TypingLine';
export { MessageList } from './components/MessageList';
export { ReplyQuote } from './components/ReplyQuote';
export { quoteOf } from './lib/quote';
export { agentFiles, ChatFiles } from './components/ChatFiles';
export { ChatViews, useChatView } from './components/ChatTitle';
export { DraftList } from './components/DraftList';
export { DRAFT_KINDS, draftsOf, type DraftKind, type DraftView } from './lib/draft-kinds';
export { MenuButton, SenderMenuContext } from './components/MenuButton';
export { useWorkspaceDrafts } from './hooks/useWorkspaceDrafts';
export { NewConversation } from './components/NewConversation';
export { NotifyOffer, NotifyPreferences } from './components/NotifyOffer';
export { SenderToast } from './components/SenderToast';
export {
  SummaryAside,
  SummaryBody,
  UnreadRow,
  usePlace as useConversationPlace,
  type FileSummaryPart,
} from './components/SenderStart';
export { useUnreadNow } from './hooks/useUnreadNow';
export { Unread } from './components/SenderSidebar';
export { chatsOf } from './lib/direct';
export {
  BarSearchField,
  ConversationHitRows,
  HIT,
  hitClass,
  stepHits,
} from './components/ConversationSearch';
export { MailHitRows, useMailHits } from './components/mail/MailHits';
export { searchConversations } from './lib/search';
export { SenderProvider, useSenderOrNull, type ChannelPlace } from './hooks/useSender';
export { isNewKind, type NewKind } from './lib/new';
export { MailAccounts, NewMailbox, NewMailboxButton } from './components/mail/MailAccounts';
export {
  MailBody,
  MailboxTabs,
  MailToolbar,
  UnreadFilter,
} from './components/mail/MailView';
export { useMailSplit, useMailView } from './hooks/useMailView';
export { MailThreadView } from './components/mail/MailThreadView';
export { MailCompose } from './components/mail/MailCompose';
export { MailPreferences } from './components/mail/MailPreferences';
export { isMailChat, mailGroupName, NEW_MAIL, unreadMailOf, withMailChats } from './lib/mail';
export { handToNewMail } from './lib/mail-handoff';
export { pinKindOf } from './lib/pins';
export { useMuteAction } from './hooks/useMuteAction';
export { useUnreadAction } from './hooks/useUnreadAction';
export { PersonFace } from './components/PersonFace';
export { usePinAction } from './hooks/usePinAction';
export { ROW_MENU_CLASS, useRowMenu } from './hooks/useRowMenu';
export { MutedMark, PinnedMark } from './components/PinnedMark';
