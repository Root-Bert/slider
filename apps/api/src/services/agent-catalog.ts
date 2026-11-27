/*
 * The agents' tools, each once, with what the harness needs to know of it: which app it belongs
 * to (the tools of the app one works in come first, the others are found when needed), whether
 * it only reads, the word on the card when it waits for the person („Löschen“), and who may set
 * it off. The rules are kept here; `refuse()` in `cloud-agents.ts` enforces them for every call
 * – the tool list and tool search only decide what the model sees, never what it may do.
 */

/** The app a tool belongs to – its tools load together, and its mark shows while it works. */
export type ToolApp =
  | 'cloud'
  | 'slider'
  | 'writer'
  | 'diagram'
  | 'sender'
  | 'todo'
  | 'calendar'
  | 'mail'
  | 'connections'
  | 'settings'
  | 'agent';

export interface ToolCard {
  app: ToolApp;
  /** Only reads: nothing changes, nothing goes out – a helper that only reads may have it. */
  reads?: true;
  /** It waits for the person's „Bestätigen“ (`cloud-agent-asks.ts`): the word on the button. */
  ok?: string;
  /**
   * Only in the person's own private agent and on their message: what shows or opens their
   * private things to others (sharing, what they deleted, an area's people) or changes their
   * account – never in a shared agent, never in a run a watch or a repeat started.
   */
  askedOnly?: true;
  /**
   * Written under the person's own name: only on a message – a run a watch or a repeat started
   * must not speak for them where nothing shows an agent did.
   */
  inTheirName?: true;
  /** It changes a presentation: it is then on the agent's desk. */
  changesDeck?: true;
}

const reads = { reads: true } as const;
const askedOnly = { askedOnly: true } as const;

/** Every tool an agent may have, by name. */
export const TOOL_CARDS: Readonly<Record<string, ToolCard>> = {
  // Cloud: reading the files, the desk (what it writes waits there), areas, sharing, versions.
  list_folder: { app: 'cloud', ...reads },
  list_tree: { app: 'cloud', ...reads },
  search_files: { app: 'cloud', ...reads },
  read_file: { app: 'cloud', ...reads },
  write_file: { app: 'cloud' },
  change_file: { app: 'cloud' },
  create_folder: { app: 'cloud' },
  move: { app: 'cloud' },
  rename: { app: 'cloud' },
  delete: { app: 'cloud', ok: 'Löschen' },
  list_desk: { app: 'cloud', ...reads },
  read_desk: { app: 'cloud', ...reads },
  create_area: { app: 'cloud' },
  file_details: { app: 'cloud', ...reads, ...askedOnly },
  restore_version: { app: 'cloud' },
  list_areas: { app: 'cloud', ...reads, ...askedOnly },
  update_area: { app: 'cloud', ...askedOnly },
  share_file: { app: 'cloud', ok: 'Freigeben', ...askedOnly },
  unshare_file: { app: 'cloud', ...askedOnly },
  list_deleted: { app: 'cloud', ...reads, ...askedOnly },
  restore_files: { app: 'cloud', ...askedOnly },
  copy_files: { app: 'cloud', ok: 'Kopieren', ...askedOnly },
  set_color: { app: 'cloud', ...askedOnly },
  pin_folder: { app: 'cloud', ...askedOnly },
  share_link: { app: 'cloud', ok: 'Freigeben', ...askedOnly },
  end_link: { app: 'cloud', ...askedOnly },
  label_version: { app: 'cloud', ...askedOnly },
  delete_version: { app: 'cloud', ok: 'Löschen', ...askedOnly },
  delete_area: { app: 'cloud', ok: 'Löschen', ...askedOnly },
  // Slider: presentations and their material.
  list_presentations: { app: 'slider', ...reads },
  search: { app: 'slider', ...reads },
  get_presentation: { app: 'slider', ...reads },
  list_comments: { app: 'slider', ...reads },
  list_materials: { app: 'slider', ...reads },
  create_presentation: { app: 'slider' },
  build_presentation: { app: 'slider', changesDeck: true },
  edit_slides: { app: 'slider', changesDeck: true },
  undo_edit: { app: 'slider' },
  add_note: { app: 'slider', changesDeck: true },
  add_link: { app: 'slider', changesDeck: true },
  update_presentation: { app: 'slider', changesDeck: true },
  add_comment: { app: 'slider', inTheirName: true },
  resolve_comment: { app: 'slider', inTheirName: true },
  update_note: { app: 'slider' },
  delete_item: { app: 'slider', ok: 'Löschen' },
  set_access: { app: 'slider' },
  delete_presentation: { app: 'slider', ok: 'Löschen' },
  copy_presentation: { app: 'slider' },
  // Writer: text documents (files in Cloud; a change is a version of its own – on the desk,
  // taken back from there).
  list_documents: { app: 'writer', ...reads },
  read_document: { app: 'writer', ...reads },
  create_document: { app: 'writer' },
  edit_document: { app: 'writer' },
  // Diagrams: drawings in Cloud (a change is a version of its own – on the desk, taken back
  // from there, as a document's). An app of their own: the changes' guide is long, so they are
  // found by tool search when something is to be drawn, not read each turn.
  read_diagram: { app: 'diagram', ...reads },
  create_diagram: { app: 'diagram' },
  edit_diagram: { app: 'diagram' },
  // Sender: conversations.
  list_conversations: { app: 'sender', ...reads },
  read_conversation: { app: 'sender', ...reads },
  post_message: { app: 'sender' },
  edit_message: { app: 'sender' },
  delete_message: { app: 'sender', ok: 'Löschen' },
  react_message: { app: 'sender', inTheirName: true },
  mark_read: { app: 'sender', inTheirName: true },
  open_direct: { app: 'sender' },
  create_group: { app: 'sender' },
  // Others then see what was the person's: a group's whole history (so a file shared, a copy in
  // an area – `share_file`, `copy_files`).
  add_to_group: { app: 'sender', ok: 'Hinzufügen' },
  remove_from_group: { app: 'sender', ok: 'Entfernen' },
  leave_group: { app: 'sender', ok: 'Verlassen' },
  // To-dos.
  list_todos: { app: 'todo', ...reads },
  read_todo: { app: 'todo', ...reads },
  create_todo: { app: 'todo' },
  update_todo: { app: 'todo' },
  delete_todo: { app: 'todo', ok: 'Löschen' },
  list_milestones: { app: 'todo', ...reads },
  update_milestone: { app: 'todo' },
  delete_milestone: { app: 'todo', ok: 'Löschen' },
  // Calendar.
  list_calendars: { app: 'calendar', ...reads },
  list_events: { app: 'calendar', ...reads },
  create_event: { app: 'calendar' },
  update_event: { app: 'calendar' },
  delete_event: { app: 'calendar', ok: 'Löschen' },
  create_calendar: { app: 'calendar' },
  update_calendar: { app: 'calendar' },
  delete_calendar: { app: 'calendar', ok: 'Löschen' },
  // Mail: the person's mailboxes (their own private agent only – `MAIL_INPUTS`).
  list_mailboxes: { app: 'mail', ...reads },
  prepare_mailbox: { app: 'mail' },
  check_mailbox: { app: 'mail' },
  update_mailbox: { app: 'mail' },
  search_mail: { app: 'mail', ...reads },
  find_mail_address: { app: 'mail', ...reads },
  read_mail_thread: { app: 'mail', ...reads },
  file_mail_attachment: { app: 'mail' },
  draft_mail_reply: { app: 'mail' },
  draft_mail: { app: 'mail' },
  mark_mail: { app: 'mail' },
  delete_mail: { app: 'mail', ok: 'Löschen' },
  send_mail: { app: 'mail', ok: 'Senden' },
  list_mail_rules: { app: 'mail', ...reads },
  add_mail_rule: { app: 'mail' },
  delete_mail_rule: { app: 'mail' },
  unsubscribe_mail: { app: 'mail', ok: 'Abbestellen' },
  // Services outside („Verbindungen“): the person's (`CONNECTION_INPUTS`).
  list_connections: { app: 'connections', ...reads },
  connection_tools: { app: 'connections', ...reads },
  use_connection: { app: 'connections' },
  call_api: { app: 'connections' },
  propose_connection: { app: 'connections' },
  // The person's settings.
  read_settings: { app: 'settings', ...reads, ...askedOnly },
  change_settings: { app: 'settings', ...askedOnly },
  // The agent itself: its chat's name, what it does by itself, its memory (writes only on a
  // person's own message – `refuse()`).
  name_chat: { app: 'agent' },
  memory: { app: 'agent' },
  // A helper that looks into a question with the tools that only read (`agent-helpers.ts`).
  ask_helper: { app: 'agent', ...reads },
  repeat_order: { app: 'agent' },
  stop_repeating: { app: 'agent' },
  watch: { app: 'agent' },
  stop_watching: { app: 'agent' },
};

/** The names of the tools whose card says so. */
export const toolsWhere = (test: (card: ToolCard) => boolean): ReadonlySet<string> =>
  new Set(Object.entries(TOOL_CARDS).flatMap(([name, card]) => (test(card) ? [name] : [])));

/** The app a tool belongs to; `undefined`: not an agent's tool. */
export const appOf = (name: string): ToolApp | undefined => TOOL_CARDS[name]?.app;
