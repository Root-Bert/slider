/** Public API of Sender (the workspace's conversations) – what Cloud shows of it. */
export { Conversation } from './ChannelPage';
export { DraftList } from './components/DraftList';
export { MenuButton, SenderMenuContext } from './components/MenuButton';
export { useWorkspaceDrafts } from './hooks/useWorkspaceDrafts';
export { NewConversation } from './components/NewConversation';
export { NotifyOffer, NotifyPreferences } from './components/NotifyOffer';
export { SenderToast } from './components/SenderToast';
export { UnreadRow } from './components/SenderStart';
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
export { searchConversations } from './lib/search';
export { SenderProvider, useSenderOrNull, type ChannelPlace } from './hooks/useSender';
export { isNewKind, type NewKind } from './lib/new';
export { MailAccounts, NewMailbox, NewMailboxButton } from './components/mail/MailAccounts';
export {
  MailBody,
  MailboxTabs,
  MailSyncButton,
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
export { usePinAction } from './hooks/usePinAction';
export { ROW_MENU_CLASS, useRowMenu } from './hooks/useRowMenu';
export { PinnedMark } from './components/PinnedMark';
