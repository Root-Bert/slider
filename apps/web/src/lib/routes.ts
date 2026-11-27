import { loginPath } from './return-to';

/** Typed URL builders – the only place that knows the URL structure. */
export const routes = {
  /** Redirects to the last used workspace (or the onboarding without one). */
  /** `/`: Cloud of the workspace last open (onboarding without one). */
  home: () => '/',
  /** Slider's presentations of the workspace last open (`SliderStart`). */
  reviews: () => '/slider',
  workspace: (workspaceId: string) => `/w/${workspaceId}`,
  /**
   * "Bibliothek" next to "Projekte": the workspace's material – fonts, slide masters – with the
   * filter shown as `?filter=` (none: the one last shown).
   */
  workspaceMaterial: (workspaceId: string, filter?: string) =>
    filter
      ? `/w/${workspaceId}/material?filter=${encodeURIComponent(filter)}`
      : `/w/${workspaceId}/material`,
  /** „Neues Asset“: a template to design in the editor, or templates and fonts to upload. */
  newMaterial: (workspaceId: string) => `/w/${workspaceId}/material/neu`,
  /** One uploaded design with all its layouts. */
  workspaceMaster: (workspaceId: string, masterId: string) =>
    `/w/${workspaceId}/material/vorlagen/${masterId}`,
  workspaceSettings: (workspaceId: string) => `/w/${workspaceId}/einstellungen`,
  /** The settings' second tab, „Integrationen“: the workspace's AI – keys, model, its name (admins). */
  workspaceIntegrations: (workspaceId: string) => `/w/${workspaceId}/einstellungen/integrationen`,
  /** The invitations on the settings page (BER-130). */
  workspaceInvites: (workspaceId: string) => `/w/${workspaceId}/einstellungen#einladen`,
  /**
   * The workspace the new deck goes into rides along as `?workspace=`; made from a folder or an
   * area in Cloud, that place as `?ordner=` / `?bereich=` – else it lies in „Meine Dateien“.
   */
  newReview: (workspaceId?: string | null, place?: { parentId?: string; areaId?: string }) => {
    const query = new URLSearchParams();
    if (workspaceId) query.set('workspace', workspaceId);
    if (place?.parentId) query.set('ordner', place.parentId);
    else if (place?.areaId) query.set('bereich', place.areaId);
    const said = query.toString();
    return said ? `/neu?${said}` : '/neu';
  },
  /** Deep links use the stable slide id, never the slide number (BER-95). */
  deck: (deckId: string, slideId?: string | null) =>
    slideId ? `/d/${deckId}?slide=${encodeURIComponent(slideId)}` : `/d/${deckId}`,
  /** The deck with its „Material“ open (`MATERIAL_PARAM`). */
  deckMaterial: (deckId: string) => `/d/${deckId}?${MATERIAL_PARAM}`,
  /** Workspace invitation link (BER-129). */
  join: (token: string) => `/join/${token}`,
  login: (returnTo?: string | null) => loginPath(returnTo),
  /** The login page while signed in: one more account on this browser, to switch between. */
  addAccount: (returnTo?: string) =>
    `/login?add=1${returnTo ? `&returnTo=${encodeURIComponent(returnTo)}` : ''}`,
  /** "Konto & Anmeldung": connected logins and passkeys. */
  account: () => '/konto',
  /** "Einstellungen": your colour and how decks open – kept apart from the account. */
  preferences: () => '/einstellungen',
  /** "Nutzung": plan, limits, storage and billing of a workspace (BER-151..155). */
  usage: (workspaceId?: string | null) =>
    workspaceId ? `/nutzung?workspace=${encodeURIComponent(workspaceId)}` : '/nutzung',
  /** Logins, mail and sign-up of a self-hosted instance (instance admin). */
  setup: () => '/einrichtung',
  /** The instance admin's dashboard: numbers, workspaces, accounts (BER-167). */
  instance: () => '/instanz',
  /** Privacy policy and imprint of the instance (BER-141). */
  privacy: () => '/datenschutz',
  imprint: () => '/impressum',
  /** Ask for a copy or deletion of one's data without login (BER-146). */
  dataRequestForm: () => '/datenanfrage',
  /** Same page as the login – the first login creates the account (BER-130). */
  register: () => '/registrieren',
  /**
   * Cloud's „Bibliothek“: the same pages as Slider's (`workspaceMaterial` and its two
   * neighbours), beside the files – what is in it serves every app. Pick between the two with
   * `useLibrary` (`lib/apps`).
   */
  cloudLibrary: (workspaceId: string, filter?: string) =>
    filter
      ? `/w/${workspaceId}/dateien/bibliothek?filter=${encodeURIComponent(filter)}`
      : `/w/${workspaceId}/dateien/bibliothek`,
  cloudLibraryNew: (workspaceId: string) => `/w/${workspaceId}/dateien/bibliothek/neu`,
  cloudLibraryMaster: (workspaceId: string, masterId: string) =>
    `/w/${workspaceId}/dateien/bibliothek/vorlagen/${masterId}`,
  /** Cloud – the workspace's files; its start is „Zuletzt“. */
  cloud: (workspaceId: string) => `/w/${workspaceId}/dateien`,
  /**
   * „Dateien“: tabs as the title, as „Agenten“ and „Aufgaben“ – all one reaches, one's own, the
   * workspace's, each area's (`?von=`).
   */
  cloudFiles: (workspaceId: string) => `/w/${workspaceId}/dateien/meine`,
  /** One's own files („Meine Dateien“): „Dateien“'s first tab. */
  cloudOwn: (workspaceId: string) => `/w/${workspaceId}/dateien/meine`,
  /** An area's top: its Startseite („Startseite.md“ in it), the files beside it. */
  cloudArea: (workspaceId: string, areaId: string) => `/w/${workspaceId}/dateien/bereich/${areaId}`,
  /** An area's files: the view beside its Startseite. */
  cloudAreaFiles: (workspaceId: string, areaId: string) =>
    `/w/${workspaceId}/dateien/bereich/${areaId}/dateien`,
  /** A page (a Markdown file), read and written in Cloud. */
  cloudPage: (workspaceId: string, pageId: string) => `/w/${workspaceId}/dateien/seite/${pageId}`,
  /** „Seiten“: one's own pages (in „Meine Dateien“' folder „Notizen“) and the areas'. */
  cloudPages: (workspaceId: string) => `/w/${workspaceId}/dateien/seiten`,
  /** An area's agents: the view beside its files. */
  cloudAreaAgents: (workspaceId: string, areaId: string) =>
    `/w/${workspaceId}/dateien/bereich/${areaId}/agenten`,
  /** An area's chat: its own channel, or another of its channels. */
  cloudAreaChat: (workspaceId: string, areaId: string, channelId?: string) =>
    `/w/${workspaceId}/dateien/bereich/${areaId}/chat${channelId ? `/${channelId}` : ''}`,
  /** A group or direct conversation, in Cloud. */
  cloudChat: (workspaceId: string, channelId: string) =>
    `/w/${workspaceId}/dateien/chat/${channelId}`,
  /** A folder, wherever it lies. */
  cloudFolder: (workspaceId: string, folderId: string) =>
    `/w/${workspaceId}/dateien/ordner/${folderId}`,
  /** A file by itself, from elsewhere (an agent's desk): its details over the files' start. */
  cloudFile: (workspaceId: string, nodeId: string) =>
    `/w/${workspaceId}/dateien?${CLOUD_FILE_PARAM}=${encodeURIComponent(nodeId)}`,
  cloudShared: (workspaceId: string) => `/w/${workspaceId}/dateien/geteilt`,
  cloudTrash: (workspaceId: string) => `/w/${workspaceId}/dateien/geloescht`,
  /** „Entwürfe“: what was written in any conversation and not sent. */
  cloudDrafts: (workspaceId: string) => `/w/${workspaceId}/dateien/entwuerfe`,
  cloudTodos: (workspaceId: string) => `/w/${workspaceId}/dateien/aufgaben`,
  /** „Kalender“: the month with the to-dos due; a day given, its month with that day marked. */
  cloudCalendar: (workspaceId: string, day?: string, view?: string) => {
    const query = new URLSearchParams();
    if (day) query.set(CLOUD_DAY_PARAM, day);
    if (view) query.set(CLOUD_VIEW_PARAM, view);
    return `/w/${workspaceId}/dateien/kalender${query.size ? `?${query}` : ''}`;
  },
  /** „Konten“: the accounts whose calendars stand in the calendar (as Post's „Postfächer“). */
  cloudCalendarAccounts: (workspaceId: string) => `/w/${workspaceId}/dateien/kalender/konten`,
  cloudAreaTodos: (workspaceId: string, areaId: string) =>
    `/w/${workspaceId}/dateien/bereich/${areaId}/aufgaben`,
  /** „Post“: one's mail conversations, one of them, one's mailboxes – as in Sender. */
  cloudMail: (workspaceId: string) => `/w/${workspaceId}/dateien/mail`,
  cloudMailThread: (workspaceId: string, threadId: string) =>
    `/w/${workspaceId}/dateien/mail/${threadId}`,
  cloudMailAccounts: (workspaceId: string) => `/w/${workspaceId}/dateien/mail/postfaecher`,
  /** „Neues Postfach“: the form alone, a page of its own (agent beside it). */
  cloudNewMailbox: (workspaceId: string) => `/w/${workspaceId}/dateien/mail/postfaecher/neu`,
  /** „Agenten“: the orders the AI works on in the server, and one of them. */
  cloudAgents: (workspaceId: string) => `/w/${workspaceId}/dateien/agenten`,
  cloudAgent: (workspaceId: string, agentId: string) =>
    `/w/${workspaceId}/dateien/agenten/${agentId}`,
  /** A call with the agent, over: what was said, and the notes after it. */
  cloudAgentCall: (workspaceId: string, agentId: string, callId: string) =>
    `/w/${workspaceId}/dateien/agenten/${agentId}/anruf/${callId}`,
  /** „Verbindungen“: the services outside one's agents work in. */
  cloudConnections: (workspaceId: string) => `/w/${workspaceId}/dateien/verbindungen`,
  /** Every area with its people. */
  cloudAreas: (workspaceId: string) => `/w/${workspaceId}/dateien/bereiche`,
  /** The admins' overview: storage, people, links. */
  cloudOverview: (workspaceId: string) => `/w/${workspaceId}/dateien/uebersicht`,
  /** Sender – where the installed app starts: on to the messages of the workspace last open. */
  senderStart: () => '/sender',
  /** „Nachrichten“: the workspace's conversations. */
  messages: (workspaceId: string) => `/w/${workspaceId}/nachrichten`,
  /** A channel, group or direct conversation. */
  messagesChannel: (workspaceId: string, channelId: string) =>
    `/w/${workspaceId}/nachrichten/kanal/${channelId}`,
  /** A call in it, over: what was said, and the notes after it. */
  messagesChannelCall: (workspaceId: string, channelId: string, callId: string) =>
    `/w/${workspaceId}/nachrichten/kanal/${channelId}/anruf/${callId}`,
  /** „Entwürfe“: what was written in any conversation and not sent. */
  messagesDrafts: (workspaceId: string) => `/w/${workspaceId}/nachrichten/entwuerfe`,
  /** Sender's „Bereiche“: the areas' people, to find whom to write to. */
  messagesAreas: (workspaceId: string) => `/w/${workspaceId}/nachrichten/bereiche`,
  /** „Post“: one's mail conversations, one of them, one's mailboxes („Postfächer“). */
  messagesMail: (workspaceId: string) => `/w/${workspaceId}/nachrichten/mail`,
  messagesMailThread: (workspaceId: string, threadId: string) =>
    `/w/${workspaceId}/nachrichten/mail/${threadId}`,
  messagesMailAccounts: (workspaceId: string) => `/w/${workspaceId}/nachrichten/mail/postfaecher`,
  messagesNewMailbox: (workspaceId: string) => `/w/${workspaceId}/nachrichten/mail/postfaecher/neu`,
  /** An agent as a conversation of its own. */
  messagesAgent: (workspaceId: string, agentId: string) =>
    `/w/${workspaceId}/nachrichten/agent/${agentId}`,
  messagesAgentCall: (workspaceId: string, agentId: string, callId: string) =>
    `/w/${workspaceId}/nachrichten/agent/${agentId}/anruf/${callId}`,
  /** Writer – where the installed app starts: on to the documents of the workspace last open. */
  writerStart: () => '/writer',
  /** „Dokumente“: the workspace's text documents. */
  documents: (workspaceId: string) => `/w/${workspaceId}/dokumente`,
  documentsTrash: (workspaceId: string) => `/w/${workspaceId}/dokumente/geloescht`,
  /** Writer's „Bibliothek“: the same pages again, beside the documents (`useLibrary`). */
  writerLibrary: (workspaceId: string, filter?: string) =>
    filter
      ? `/w/${workspaceId}/dokumente/bibliothek?filter=${encodeURIComponent(filter)}`
      : `/w/${workspaceId}/dokumente/bibliothek`,
  writerLibraryNew: (workspaceId: string) => `/w/${workspaceId}/dokumente/bibliothek/neu`,
  writerLibraryMaster: (workspaceId: string, masterId: string) =>
    `/w/${workspaceId}/dokumente/bibliothek/vorlagen/${masterId}`,
  /** One document, open; `?kommentar=` leads to a comment in it. */
  document: (documentId: string, commentId?: string | null) =>
    commentId ? `/t/${documentId}?kommentar=${encodeURIComponent(commentId)}` : `/t/${documentId}`,
  /** One diagram, open – drawn on where it is. */
  diagram: (diagramId: string) => `/diagramm/${diagramId}`,
  /** The document with its „Material“ open (`MATERIAL_PARAM`). */
  documentMaterial: (documentId: string) => `/t/${documentId}?${MATERIAL_PARAM}`,
  /** Reader – where the installed app starts: on to the PDFs of the workspace last open. */
  readerStart: () => '/reader',
  /** „PDFs“: the workspace's PDFs. */
  pdfs: (workspaceId: string) => `/w/${workspaceId}/pdfs`,
  pdfsTrash: (workspaceId: string) => `/w/${workspaceId}/pdfs/geloescht`,
  /** One PDF, open; `?kommentar=` leads to a comment on it. */
  pdf: (pdfId: string, commentId?: string | null) =>
    commentId ? `/r/${pdfId}?kommentar=${encodeURIComponent(commentId)}` : `/r/${pdfId}`,
  /** What a link shows to someone outside. */
  cloudLink: (token: string) => `/s/${token}`,
};

/** `?material` on a deck's or document's address: its „Material“ opens with it. */
export const MATERIAL_PARAM = 'material';

/** `?datei=<id>` on any page of Cloud opens that file over it. */
export const CLOUD_FILE_PARAM = 'datei';
/** `?aufgabe=<id>` on any page of Cloud opens that to-do in the side panel beside it. */
export const CLOUD_TODO_PARAM = 'aufgabe';
/**
 * „Kalender“: the day it shows (`?tag=YYYY-MM-DD`, else today), how (`?ansicht=tag|woche|monat|
 * jahr|agenda`, else as last), an event beside it (`?termin=<id>`, `neu` for a new one).
 */
export const CLOUD_DAY_PARAM = 'tag';
export const CLOUD_VIEW_PARAM = 'ansicht';
export const CLOUD_EVENT_PARAM = 'termin';
/** `?anruf=<id>` on any page of Cloud: a call over in the side panel beside it (`CallPanel`). */
export const CLOUD_CALL_PARAM = 'anruf';

/** The current location as a `returnTo` value. */
export const currentPath = () =>
  `${window.location.pathname}${window.location.search}${window.location.hash}`;
