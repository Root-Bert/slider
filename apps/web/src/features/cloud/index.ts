/** Public API of Cloud (the workspace's files). Route pages stay out: each keeps its own chunk. */
export {
  AppLogo,
  AppSwitcher,
  CloudLogo,
  SenderLogo,
  ReaderLogo,
  WriterLogo,
  suiteApps,
  useOpenApp,
  type AppEntry,
} from './components/AppSwitcher';
export { CloudChatButton, WorkspaceChat } from './components/CloudChat';
export { DateButton } from './components/calendar/DateButton';
export { MeetingNotice } from './components/calendar/MeetingNotice';
export { CalendarPreferences } from './components/calendar/CalendarPreferences';
export { lastCalendarKey, plainEventCalendar } from './lib/event-calendar';
export { AppMark, AppTag, type AppName } from './components/AppMark';
export { FilesPreferences } from './components/FilesPreferences';
export { DestinationDialog, type Destination } from './components/DestinationDialog';
export { keptText } from './lib/kept';
export { appFor, whereOf } from './lib/kinds';
export { FileIcon } from './components/FileIcon';
export {
  canPlaceApps,
  cloudBridge,
  type AppWhere,
  type CloudApps,
  type PlacedApp,
} from './lib/computer';
/** Parts Sender's agent conversations share with Cloud's agent page. */
export { AgentAvatar } from './components/AgentAvatar';
export { AgentFace } from './components/AgentFace';
export { useDeleteAgentAction } from './components/AgentActions';
export { AgentChat } from './components/AgentChat';
export { CallEntry, CallMeta, CallRecordView } from './components/CallRecord';
export { AgentComposer } from './components/AgentComposer';
export { AsideAgent, AsideBullets, AsidePart } from './components/AsidePart';
export { AgentDesk } from './components/AgentDesk';
export {
  AsideToggle,
  useAgentAside,
  useAsideRoom,
  useAgentCardsShown,
  useKeptWidth,
} from './components/AgentAside';
export { GIVE_WAY_TO_PANEL } from './lib/panel';
export { AgentList, AgentListSkeleton, GRID as AGENT_GRID } from './components/AgentList';
export { CloudProvider } from './hooks/useCloud';
export { Empty, LoadFailed } from './components/Empty';
export { NamedIcon } from './components/Named';
export { namedHref, type Named } from './lib/named';
export { AgentAsks } from './components/AgentAsks';
export { AreaDot } from './components/AreaDot';
export { PeopleGraph } from './components/PeopleGraph';
export { peopleFound } from './lib/people-graph';
export { VersionList } from './components/VersionList';
