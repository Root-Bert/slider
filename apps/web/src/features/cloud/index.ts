/** Public API of Cloud (the workspace's files). Route pages stay out: each keeps its own chunk. */
export {
  AppLogo,
  AppSwitcher,
  CloudLogo,
  SenderLogo,
  ReaderLogo,
  WriterLogo,
} from './components/AppSwitcher';
export { CloudChatButton, WorkspaceChat } from './components/CloudChat';
export { DateButton } from './components/calendar/DateButton';
export { AppMark, AppTag, type AppName } from './components/AppMark';
export { FilesPreferences } from './components/FilesPreferences';
export { DestinationDialog, type Destination } from './components/DestinationDialog';
export {
  canPlaceApps,
  cloudBridge,
  type AppWhere,
  type CloudApps,
  type PlacedApp,
} from './lib/computer';
/** Parts Sender's agent conversations share with Cloud's agent page. */
export { AgentAvatar } from './components/AgentAvatar';
export { useDeleteAgentAction } from './components/AgentActions';
export { AgentChat } from './components/AgentChat';
export { messageWords } from './lib/message-words';
export { CallEntry, CallMeta, CallRecordView } from './components/CallRecord';
export { AgentComposer } from './components/AgentComposer';
export { AsideAgent, AsideBullets, AsidePart } from './components/AsidePart';
export { AgentDesk } from './components/AgentDesk';
export { useAgentAside, useKeptWidth } from './components/AgentAside';
export { GIVE_WAY_TO_PANEL } from './lib/panel';
export { AgentList, AgentListSkeleton } from './components/AgentList';
export { CloudProvider } from './hooks/useCloud';
export { Empty, LoadFailed } from './components/Empty';
export { NamedIcon, WithNamed } from './components/Named';
export { namedHref, plainNamed, type Named } from './lib/named';
export { AgentChoices } from './components/AgentWatching';
export { AreaDot } from './components/AreaDot';
export { VersionList } from './components/VersionList';
export { choicesIn, withoutChoices } from './lib/choices';
