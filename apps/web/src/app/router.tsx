import { createBrowserRouter, Outlet } from 'react-router';
import { CommandKey } from '@/features/commands';
import { PeoplePicturesSync } from './PeoplePicturesSync';
import { RouteError } from './RouteError';

/**
 * Feature pages are lazy-loaded so the viewer doesn't ship the whole app.
 * Each page module exports `Component` (React Router lazy-route convention).
 *
 * Member pages sit below `AccountGate` (signed-out visitors go to `/login?returnTo=…`); the
 * deck viewer (sends signed-out visitors to the login itself), login and the invitation page
 * stay outside it. There are no guests: sharing invites into the workspace.
 */
export const router = createBrowserRouter([
  {
    // Every page: the command panel (⌘K) and people's pictures for whoever is signed in.
    element: (
      <>
        <Outlet />
        <CommandKey />
        <PeoplePicturesSync />
      </>
    ),
    errorElement: <RouteError />,
    // Shown while the first lazy route module loads.
    hydrateFallbackElement: <div className="dot-grid min-h-full" aria-busy />,
    children: [
      { path: 'login', lazy: () => import('@/features/auth/LoginPage') },
      { path: 'registrieren', lazy: () => import('@/features/auth/RegisterPage') },
      { path: 'konto-bestaetigen/:token', lazy: () => import('@/features/auth/ConfirmSignUpPage') },
      { path: 'anmelden/:token', lazy: () => import('@/features/auth/EmailLoginPage') },
      // Self-hosting: setup token from the server log, or the instance admin (checked by the API).
      { path: 'einrichtung', lazy: () => import('@/features/setup/SetupPage') },
      { path: 'join/:token', lazy: () => import('@/features/workspaces/JoinPage') },
      { path: 'datenschutz', lazy: () => import('@/features/legal/PrivacyPage') },
      { path: 'impressum', lazy: () => import('@/features/legal/ImprintPage') },
      { path: 'datenanfrage', lazy: () => import('@/features/account/DataRequestFormPage') },
      { path: 'daten/:token', lazy: () => import('@/features/account/DataRequestPage') },
      { path: 'd/:deckId', lazy: () => import('@/features/viewer/DeckPage') },
      // Writer: one document, open – like the deck viewer it sends signed-out visitors on itself.
      { path: 't/:documentId', lazy: () => import('@/features/writer/DocumentPage') },
      // A diagram: drawn on in a page of its own, as a document is written in Writer.
      { path: 'diagramm/:diagramId', lazy: () => import('@/features/diagrams/DiagramPage') },
      // Reader: one PDF, open – it sends signed-out visitors on itself too.
      { path: 'r/:pdfId', lazy: () => import('@/features/reader/PdfPage') },
      // Cloud: what a link shows to someone outside – no account needed.
      { path: 's/:token', lazy: () => import('@/features/cloud/PublicPage') },
      {
        lazy: () => import('@/features/auth/AccountGate'),
        children: [
          { index: true, lazy: () => import('@/features/workspaces/HomePage') },
          { path: 'neu', lazy: () => import('@/features/onboarding/NewReviewPage') },
          { path: 'konto', lazy: () => import('@/features/account/AccountPage') },
          // The desktop app signs in here, in the browser (BER-201).
          {
            path: 'desktop-anmelden',
            lazy: () => import('@/features/auth/DesktopSignInPage'),
          },
          // An AI app asks to be let in (OAuth, „KI-Apps“).
          { path: 'verbinden', lazy: () => import('@/features/account/ConnectAppPage') },
          { path: 'einstellungen', lazy: () => import('@/features/account/PreferencesPage') },
          { path: 'nutzung', lazy: () => import('@/features/account/UsagePage') },
          // Slider's presentations; the installed Slider starts here (`manifest.webmanifest`).
          { path: 'slider', lazy: () => import('@/features/reviews/SliderStart') },
          // The installed Cloud starts here (`cloud.webmanifest`).
          { path: 'cloud', lazy: () => import('@/features/cloud/CloudStart') },
          // Its address before it was called Cloud: installed apps and old links still start there.
          { path: 'office', lazy: () => import('@/features/cloud/CloudStart') },
          // The installed Writer starts here (`writer.webmanifest`).
          { path: 'writer', lazy: () => import('@/features/writer/WriterStart') },
          // The installed Reader starts here.
          { path: 'reader', lazy: () => import('@/features/reader/ReaderStart') },
          // The installed Sender starts here (`sender.webmanifest`).
          { path: 'sender', lazy: () => import('@/features/sender/SenderStart') },
          { path: 'instanz', lazy: () => import('@/features/instance/InstancePage') },
          {
            path: 'w/:workspaceId',
            lazy: () => import('@/features/workspaces/WorkspaceLayout'),
            children: [
              { index: true, lazy: () => import('@/features/reviews/ReviewsPage') },
              // Writer – the workspace's text documents; „Papierkorb“ is a tab of the same page.
              { path: 'dokumente', lazy: () => import('@/features/writer/DocumentsPage') },
              // „Bibliothek“: Slider's pages, here beside the documents (`useLibrary`).
              {
                path: 'dokumente/bibliothek',
                lazy: () => import('@/features/workspaces/MaterialPage'),
              },
              {
                path: 'dokumente/bibliothek/neu',
                lazy: () => import('@/features/onboarding/NewMaterialPage'),
              },
              {
                path: 'dokumente/bibliothek/vorlagen/:masterId',
                lazy: () => import('@/features/workspaces/MasterPage'),
              },
              {
                path: 'dokumente/geloescht',
                lazy: () => import('@/features/writer/DocumentsPage'),
              },
              // Reader – the workspace's PDFs; „Papierkorb“ is a tab of the same page.
              { path: 'pdfs', lazy: () => import('@/features/reader/PdfsPage') },
              { path: 'pdfs/geloescht', lazy: () => import('@/features/reader/PdfsPage') },
              { path: 'material', lazy: () => import('@/features/workspaces/MaterialPage') },
              { path: 'material/neu', lazy: () => import('@/features/onboarding/NewMaterialPage') },
              {
                path: 'material/vorlagen/:masterId',
                lazy: () => import('@/features/workspaces/MasterPage'),
              },
              {
                // Links from before designs were called „Vorlagen“.
                path: 'material/folienmaster/:masterId',
                lazy: () => import('@/features/workspaces/MasterPage'),
              },
              {
                // Cloud – the workspace's files, with a side bar of its own.
                path: 'dateien',
                lazy: () => import('@/features/cloud/CloudLayout'),
                children: [
                  { index: true, lazy: () => import('@/features/cloud/RecentPage') },
                  { path: 'meine', lazy: () => import('@/features/cloud/FilesPage') },
                  { path: 'bereich/:areaId', lazy: () => import('@/features/cloud/AreaHomePage') },
                  {
                    path: 'bereich/:areaId/dateien',
                    lazy: () => import('@/features/cloud/FilesPage'),
                  },
                  { path: 'seite/:pageId', lazy: () => import('@/features/cloud/PagePage') },
                  { path: 'seiten', lazy: () => import('@/features/cloud/PagesPage') },
                  {
                    // Links from before „Seiten“.
                    path: 'notizen',
                    lazy: async () => ({
                      Component: (await import('@/features/cloud/PagesPage')).Redirect,
                    }),
                  },
                  {
                    path: 'bereich/:areaId/agenten',
                    lazy: () => import('@/features/cloud/AreaAgentsPage'),
                  },
                  {
                    path: 'bereich/:areaId/aufgaben',
                    lazy: () => import('@/features/cloud/AreaTodosPage'),
                  },
                  {
                    path: 'bereich/:areaId/chat/:channelId?',
                    lazy: () => import('@/features/cloud/AreaChatPage'),
                  },
                  { path: 'chat/:channelId', lazy: () => import('@/features/cloud/ChatPage') },
                  { path: 'ordner/:folderId', lazy: () => import('@/features/cloud/FilesPage') },
                  { path: 'geteilt', lazy: () => import('@/features/cloud/SharedPage') },
                  { path: 'geloescht', lazy: () => import('@/features/cloud/TrashPage') },
                  { path: 'entwuerfe', lazy: () => import('@/features/cloud/DraftsPage') },
                  { path: 'aufgaben', lazy: () => import('@/features/cloud/TodosPage') },
                  { path: 'kalender', lazy: () => import('@/features/cloud/CalendarPage') },
                  {
                    path: 'kalender/konten',
                    lazy: () => import('@/features/cloud/CalendarAccountsPage'),
                  },
                  {
                    // The list – wide, with the open mail beside it (`MailBody`).
                    path: 'mail',
                    lazy: () => import('@/features/cloud/MailPage'),
                    children: [
                      { index: true, element: null },
                      { path: ':threadId', lazy: () => import('@/features/cloud/MailThreadPage') },
                    ],
                  },
                  {
                    path: 'mail/postfaecher',
                    lazy: () => import('@/features/cloud/MailAccountsPage'),
                  },
                  {
                    path: 'mail/postfaecher/neu',
                    lazy: () => import('@/features/cloud/NewMailboxPage'),
                  },
                  { path: 'bereiche', lazy: () => import('@/features/cloud/AreasPage') },
                  { path: 'uebersicht', lazy: () => import('@/features/cloud/OverviewPage') },
                  { path: 'agenten', lazy: () => import('@/features/cloud/AgentsPage') },
                  { path: 'agenten/:agentId', lazy: () => import('@/features/cloud/AgentPage') },
                  {
                    path: 'agenten/:agentId/anruf/:callId',
                    lazy: () => import('@/features/cloud/AgentCallPage'),
                  },
                  {
                    path: 'verbindungen',
                    lazy: () => import('@/features/cloud/ConnectionsPage'),
                  },
                  // „Bibliothek“: Slider's pages, here beside the files (`useLibrary`).
                  { path: 'bibliothek', lazy: () => import('@/features/workspaces/MaterialPage') },
                  {
                    path: 'bibliothek/neu',
                    lazy: () => import('@/features/onboarding/NewMaterialPage'),
                  },
                  {
                    path: 'bibliothek/vorlagen/:masterId',
                    lazy: () => import('@/features/workspaces/MasterPage'),
                  },
                ],
              },
              {
                // Sender – the workspace's conversations, with a side bar of its own.
                path: 'nachrichten',
                lazy: () => import('@/features/sender/SenderLayout'),
                children: [
                  { index: true, lazy: () => import('@/features/sender/SenderHomePage') },
                  { path: 'kanal/:channelId', lazy: () => import('@/features/sender/ChannelPage') },
                  {
                    path: 'kanal/:channelId/anruf/:callId',
                    lazy: () => import('@/features/sender/CallPage'),
                  },
                  { path: 'agent/:agentId', lazy: () => import('@/features/sender/AgentChatPage') },
                  {
                    path: 'agent/:agentId/anruf/:callId',
                    lazy: () => import('@/features/sender/CallPage'),
                  },
                  { path: 'entwuerfe', lazy: () => import('@/features/sender/DraftsPage') },
                  { path: 'bereiche', lazy: () => import('@/features/sender/AreasPage') },
                  {
                    // The list – wide, with the open mail beside it (`MailBody`).
                    path: 'mail',
                    lazy: () => import('@/features/sender/MailPage'),
                    children: [
                      { index: true, element: null },
                      {
                        path: ':threadId',
                        lazy: () => import('@/features/sender/MailThreadPage'),
                      },
                    ],
                  },
                  {
                    path: 'mail/postfaecher',
                    lazy: () => import('@/features/sender/MailAccountsPage'),
                  },
                  {
                    path: 'mail/postfaecher/neu',
                    lazy: () => import('@/features/sender/NewMailboxPage'),
                  },
                ],
              },
              {
                // `integrationen`: the integrations tab – one route, so switching tabs keeps the page.
                path: 'einstellungen/:tab?',
                lazy: () => import('@/features/workspaces/SettingsPage'),
              },
            ],
          },
        ],
      },
      { path: '*', lazy: () => import('./NotFoundPage') },
    ],
  },
]);
