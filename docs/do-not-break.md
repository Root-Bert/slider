# Do not break

The user judges Slider by these; each one regressed before. Touching the area → run its check and
say so in your report. Fixing a regression → add the case to an existing test (or the parity
fixtures). Made something new perfect the user cares about → add a line here.

Parity script (from `apps/web`): `bun --tsconfig-override=tsconfig.app.json scripts/live-parity.ts`
– below `live-parity`.

## Editor drawing

- **Bearbeiten looks exactly like Prüfen** (also 3D „Ebenen“) – a whitelist of Slider-native
  elements (`paint`) is drawn by the browser, everything else is LibreOffice's picture of that
  element over its slide background; Prüfen and exports are always LibreOffice; edit mode only
  adds handles. Where: `packages/odp/src/live*.ts`, `apps/web/src/features/viewer/editing/`.
  Check: `live-parity --sample` (≤ 1.5 % per slide) and `--sample --compose` (≤ 2 % per element,
  incl. every upright text); real deck: agent-notes §LibreOffice.
- **Text keeps its font and size** in LibreOffice and the editor – blank decks/templates name
  Inter via a common „standard“ style with font _and_ padding; automatic parent styles folded in;
  content font names need a content.xml declaration; placeholders have 0 padding. Where:
  `packages/odp/src/blank.ts`, `live.ts` (`StyleIndex`, `standardUnder`,
  `inheritAutomaticParents`). Check: live-parity on a new blank deck and `--sample`; odp tests.
- **A list takes the bullet or numbering picked** – eight bullets, five ways to count, in a menu on
  right click on the list buttons (`ContextMenu`; Esc closes it alone, typing goes on after),
  per line while typing; the shapes are drawn in Inter (most
  text fonts lack them), the list's level otherwise as it was; ⌘Z brings the old one back; a
  bullet the editor only made up (list button, ⇥) is `assumed` and never asked for, so a
  template's own bullets stay. Where: `textListSchema` (`char`, `number`), `listOf`,
  `listBulletFont`, `withList`, `live-write.ts` `signedListStyle`. Check: odp `live.test.ts`,
  web `model.test.ts`; live-parity on a deck with each bullet picked (0.75 %).
- **soffice finds Slider's fonts** – every run (pool and single) gets `fontconfigEnv` →
  `fonts/google`. Where: `apps/api/src/import/libreoffice.ts`, `office-pool.ts`. Check: blank deck
  renders in Inter, not Liberation/serif.
- **Gradients are smooth**, not banded. Where: `apps/api/src/import/deband.ts` via
  `smoothGradients` in `pdf-render.ts`. Check: dark gradient slide has no bands; WebP stays q90.
- **Editor drawings are fast** (~0.05–0.1 s/page) – pool of running LibreOffices, lean drawing
  copies. Where: `office-pool.ts`, `OdpDocument.toDrawingBytes`. Check: never route editor
  drawings through a fresh `soffice`.
- **Instant fill/stroke/move/delete** – a `paint` element changes in the same frame from the
  model; a LibreOffice-drawn one keeps its last picture (moved/stretched/turned) until the new one
  is decoded; Bearbeiten acts on a slide only once composed (`useComposed`). Where:
  `SlideCompositor`, `ElementView`, `RasterItem`, `compose/composed.ts`, `EditLayer`. Check:
  `bun run e2e:live`; no flash/halo on a fill change.
- **No flicker after an edit** – never swap an `<img src>` (`SwapImage` layers new under old, drops
  old once decoded); an element's new picture shows only once decoded (`useSettledLayer`); what is
  drawn over a slide until its picture goes in the frame that picture shows (`whenPictureShown`).
  Where: `stage/SwapImage.tsx`, `shown-pictures.ts`, `SlideCompositor`. Check: `bun run e2e:live`
  (screencast: no frame jumps back or goes blank).
- **Slide background changes draw live** – the browser draws the slide's own background
  (`SlideGround`, from the panel draft) or the master's (`SlideLayers.masterGround`, once per
  master) beneath the master's shapes (`masterShapes`) and the elements; no picture waited for.
  Where: `SlideCompositor`, `SlideGround`, `background-previews.ts`, `OdpDocument.toLayerBytes`.
  Check: `bun run e2e:live`; Hintergrund → Verlauf, drag an end: 60 fps, no jump.
- **A picture fills alike everywhere** – picture element, shape picture fill and slide background
  offer the same „Rahmen füllen: Füllen | Strecken“ + „Ausschnitt“ (`PictureFitChoice`), part
  chosen on the slide (`CropOnSlide`), baked as `coverCrop`; a shape's change shows at once over
  its real area (presets, turned, mirrored, tilted) under its text (`FillOverlay`, `fillArea`);
  double click on a picture-filled shape without text starts „Ausschnitt“. Where:
  `ImageFitControls.tsx`, `PictureFitLayer.tsx`, `picture-fit.ts`, `fills/`, `shared/shape-path.ts`,
  `SlideBackgroundPanel`. Check: `bun run e2e:live` (20, 21); `live-parity --sample --compose`;
  `bake-fills.test`, `FillControls.test`.
- **Hintergrund-Unschärfe is LibreOffice's picture too** – baked by the server into the element's
  fill in the same step that made it stale (move, resize, turn, something under it, layers,
  strength; also group parts); undo takes both back; without LibreOffice the step still goes in,
  retried next step. Where: `OdpDocument.backdropWork`/`bakeBackdrop`,
  `services/edits/backdrops.ts`, `EffectControls`. Check: odp fills + api edits tests; identical in
  Prüfen.
- **Lines and arrows are first-class shapes** – „Linie“/„Pfeil“ in „Form“; a `draw:line` whose ends
  are its box corners, direction by `flip` (`lineEnds`), heads LibreOffice's „Arrow“ marker 3× line
  width; browser-drawn (`LineView`); end handles (snap, ⇧ 45°); no fill/effects in its panel.
  Where: `packages/odp/src/lines.ts`, `LineFrame.tsx`, `ElementView`, `turnedLine`. Check: odp
  `live.test.ts`, `undo-ops.test.ts`, `live-parity --sample --compose` (lines slide),
  `bun run e2e:live` (6b).

- **The room around a slide zoomed out is worked in** (Figma's canvas round a frame) – what lies
  off the slide is drawn whole and sharp there, in Bearbeiten by the compositor (`open`: only the
  ground is cut, the corners covered), in Prüfen as the server's pictures (`OffSlideLayer`);
  picked, moved, a frame drawn, a picture dropped, a click on the free room lets go; comments too
  (pin, area, sticker, drawing – `aroundPointSchema` / `aroundRectSchema`, bounds as an element's
  box). The layers stay as large as the slide, only where they are hit reaches out (`slide-room`,
  `--room-*` from `SlideFrame`); a pointer is read on the slide or in that room (`toSlidePoint`,
  `slideRoom`). At 100 % there is no room: nothing new goes off the slide, a mark wholly beside
  it shows only while looked at. Where: `SlideFrame`, `SlideCompositor`, `lib/geometry.ts`,
  `useInsertFrame`, `AnnotationLayer`. Check: zoom out (⌃ + wheel), drag an element off the slide
  and back, draw a frame and click a comment beside it; `rect-edit.test`, api `comments.test`;
  `bun run e2e:live`.

## Editing behaviour

- **Undo is instant and works offline** – ⌘Z/⇧⌘Z invert one's own edits in the browser
  (`inverseOf`), sent like any edit, queued offline; others' later changes stay (toast); only steps
  with no browser inverse (slide deleted, picture swapped, tilt) go to the server, online. Where:
  `hooks/useOwnUndo.ts`, `undo-ops.ts`, `edit-outbox.ts` (merges only into the last edit). Check:
  `undo-ops.test.ts`; `bun run e2e:live` (4, 19); `bun run e2e:live:bundle`.
- **Someone else's edits draw in the same frame** – each step reaches others with its operations
  (`slides` event `step`), applied at once under one's own pending edits (`rebased`, nothing jumps
  back), dropped once the edit state has it; others' drags/picks via presence. Where: `commit.ts` →
  `LiveHub.slidesChanged`, `live-store.ts` `onLiveStep`, `remote-steps.ts`, `compose/peers.ts`.
  Check: `remote-steps.test.ts`, `pending-slides.test.ts`, api `edits.test.ts`, `bun run e2e:live`
  „two editors see each other at once“ (p50 < 100 ms).
- **Concurrent edits of one element both survive** – server applies each edit by element id, last
  change per _property_ wins; co-typed text via Yjs. Where: `services/edits/steps.ts` `applyEdit`,
  `@slider/shared/live-text`. Check: api `edits.test.ts`, `shared-text.test.ts`, `bun run e2e:live`
  two editors d, e, g.
- **Elements copy, cut, paste, duplicate** – ⌘C/⌘X/⌘V/⌘D, also while typing with nothing marked;
  a cut element is pasted from the file before its delete step; the copy is picked at once; group
  copies get final part ids in the browser (`partIds`). Where: `EditingProvider`, `copyElement` +
  `loadSources`, `OdpDocument.elementSource`, `newPartIds`. Check: odp + api edits tests,
  `model.test.ts`; ⌘X ⌘V puts it back in place.
- **⌘V from outside puts anything in** (Figma) – text from another app or a web page becomes a
  text box in the slide's body style, as wide as its lines (measured in the editor's face, ≤ 80 %),
  centred, picked; pictures become picture elements, any format the browser reads (HEIC, TIFF,
  SVG … drawn into a PNG); text beside an office app's own picture of it (HTML without `<img>`)
  is text; typing in a text box or a field, the text goes there. Where: `paste.ts`
  (`pastedOf`, `pastedTextBox`), `insert-image.ts` (`shownImage`, `readClipboard`),
  `EditingProvider` `onPaste`/`insertText`. Check: `model.test.ts`; in the editor paste text from
  another app → one box, no wrap of its lines.
- **A locked element is out of the pointer's way** – not picked/moved (also 3D, frame-select, ⌘A);
  a frame drawn on it makes a new box; double click or its lock in Ebenen (⇧L) unlocks; stored as
  `style:protect`. Where: `EditLayer`, `useInsertFrame`, `LayerStage`, `LayersPanel`,
  `readLocked`/`writeLock`. Check: odp + api edits tests.
- **Elements picked together resize and turn as one** (Figma) – one frame, corner scales each in
  the box, turn handle turns round the box centre; live from `ElementPreview.group.frames`, one
  `setBox` step, one ⌘Z. Where: `GroupSelection`, `lib/group-layout.ts`. Check:
  `group-layout.test.ts`.
- **Group / ungroup** – ⌘G/⇧⌘G; a `draw:g`, ids kept, at the topmost's place; drawn from its parts
  (no gap); ⌘Z of group in browser, of ungroup on server. Where: `groupElements`/`ungroupElements`,
  `EditingProvider` `groupPicked`, `SlideCompositor` `partsOf`, `undo-ops.ts`. Check: odp
  `document.test.ts`, api `edits.test.ts`, `undo-ops.test.ts`.
- **A double click enters a group** (Figma) – the part is edited by its id like any element (op on
  a part = change of its top group, `applyInGroup`); Esc picks the group; ⌘Z of a deleted part
  restores it in the group; empty group goes; Ebenen lists parts indented. Where:
  `OdpDocument.locate`, `EditingProvider` `entered`/`enterGroup`/`topOf`, `EditLayer`,
  `remote-steps.ts`, `LayersPanel` `PartRows`. Check: odp `document.test.ts`, api `edits.test.ts`,
  `undo-ops.test.ts`, `remote-steps.test.ts`, `live-parity --sample --compose`.
- **⇧ + drag adds inside other boxes** – no mode of its own: in Bearbeiten, ⇧ pressed on an
  element's body (not handles: ⇧ resizes in proportion / tilts there; not text being typed in)
  draws a new frame as on the free slide (crosshair while ⇧ is held); ⇧-click without a drag still
  picks it together with those picked; square only with ⇧ pressed again. Where: `useInsertFrame`
  `onPointerDownCapture`, `EditLayer`. Check: in the editor, ⇧-drag inside a text box → chooser;
  ⇧-click two boxes → both picked; ⇧ on a corner → proportional resize.

## AI

- **A box drawn while speaking to the AI goes to the AI** – in any mode, a small AI-look field
  beside the box takes the live words (cut from the voice session at open/close); ↵ sends a comment
  and asks the AI, Esc drops it; anything taking its place sends it first, never nudged; drawn
  again on a running request of one's own → adds to that thread („Ergänzt den laufenden
  Auftrag“). Where: `AiBoxComposer`, `useSendAiBox`, `usePlaceAiBox`, `voice/lib/ai-additions.ts`,
  `draft-reducer`. Check: `viewer-state.test.ts`.
- **A request about an open thread's subject goes on in that thread** – same element(s) or box IoU
  ≥ 0.6 on the same slide (`threadForRequest`) → reply there, a running run stopped and re-asked;
  own session thread → addition; threads people resolved / whole slide / typed comments unchanged.
  The AI's applied change resolves its thread itself (`resolvedBy` `ai`, sparkles instead of the
  check, listed under „Erledigt“); such a thread still takes requests, and opens again when the
  AI asks back (filter „KI“) or its change is taken back – unless another applied change of the
  AI in it stands; applied again, done again. Where: `ai-proposals.ts` `resolveThread`/`reopenThread`,
  `shared/shapes.ts`, `voice/session.ts` `joinOpenThread`/`stopRunsIn`, `useSendAiBox`. Check:
  `voice.test.ts`, `viewer-state.test.ts`.
- **The AI makes new elements as a person does** – shapes, text, lines, copies, pictures, icons,
  new slide content via `change_elements` / quick edits → `quickPlan` → the editor's
  `addElement`/`copyElement`/`addImage` (ids `sl…`, browser-drawn, typable); an empty list
  placeholder filled shows bullets; a picture or gradient as a shape's fill via `setShapeStyle`
  fills (a picture cut to the shape: `composite`); icons carry their `symbol` (searched and drawn
  from the editor's sets, `@slider/shared/icons`, `services/icons.ts`, Dockerfile copies the sets);
  XML only for tables and charts. Where: `voice/quick-edits.ts`, `ai-proposals.ts`,
  `quick-requests.ts`, `voice/router.ts`. Check: api `ai-proposals.test.ts`, `voice.test.ts`.
- **Entrances play by themselves and survive LibreOffice** – `setEntrance` writes LibreOffice's
  presets (`ooo-entrance-*`) into the page's main sequence, the first group `smil:begin="next"`,
  each after the one before or with it (no clicks; foreign effects kept); copied with the slide,
  gone with the element. The show plays them after the transition from the slide's layers (edit
  rights; else the plain picture), the morph leaving new entrance elements to them. Where:
  `odp/src/entrance.ts`, `presentation/EntranceStage.tsx`, `lib/entrances.ts`,
  `editing/EntranceControls.tsx`. Check: odp `document.test.ts`, web `morph.test.ts`.
- **A sticker is a comment, also for the AI** – sent alone its text is the body (counted, listed,
  but no card under the slide until it has a comment of its own, a reply or the AI's answer –
  `isBareSticker`, `useCommentThreads`);
  ⌘↵ sends and asks the AI; „An die KI geben“ in its menu; AI reads its text + box (`markText`);
  the AI stickers only what people must notice. Where: `stage/lib/text-box.ts`, `TextBox.tsx`,
  `useMarkMenu`, `services/comments.ts`, `ai-proposals.ts`. Check: api `ai-proposals.test.ts`,
  `comments.test.ts`.

## Material and deck creation

- **Material never goes into the file** – what is attached for a deck (the paper clip on Folie 1,
  MCP `add_file`/`add_note`) lives in `deck_materials`/`deck_board_items` + media store; never in
  the ODP, exports, LibreOffice or slide count; no page or tile of its own (the board is gone);
  the AI reads it, „Material“ lists it with „Löschen“ (`viewer/material/MaterialList.tsx`); rights
  as comments, from deck access. Where: `services/materials.ts`,
  `routes/materials.ts`, `lib/api/deck-material.ts`, `timeline-layout.ts`. Check: api
  `materials.test.ts`, `timeline-layout.test.ts`, e2e `02-upload`.
- **The AI reads material through tools** – first message only lists files (`materialsBrief`);
  content only via `list_materials`, `read_material`, `read_sheet`, `search_materials`,
  `view_material`; text extracted in background, encrypted in `material_chunks`, searched in the
  server. Where: `material-extract.ts`, `material-tools.ts`, `ai-context.ts`. Check: api
  `materials.test.ts`, `ai-proposals.test.ts`.
- **A new deck is built from the prompt on Folie 1** – „Neue Präsentation“ opens on Folie 1, the
  prompt; while the deck is its blank start Folie 1 is the prompt (description kept per deck, takes live speech
  with a strict `claim`; 8 kinds; Stil = templates; 5–30 pages; material always used); „Erstellen“
  closes at once, outline shows, each slide its own AI step, Abbrechen keeps what is built; „Leer
  anfangen“ closes for good. Where: `services/deck-creation/`, `CreatePrompt`, `creation-draft.ts`,
  `useHeardWords`, `CreationProgress`, `Timeline`. Check: api `deck-creation.test.ts`,
  `creation-draft.test.ts`.
- **A deck opens at once** – a blank „Neue Präsentation“ is ready in its own request (the blank
  slide drawn once at start-up, `BlankDecks`); an upload opens on its SVG previews – a file Cloud
  already drew (≤ 8 slides) on those pictures (`openingPages`; Cloud draws presentation files as
  their deck is – `materialPdf` with `fonts`, a single run with the replacement table and the
  workspace's fonts, never the pool – so the swap keeps the fonts) – and LibreOffice's pictures
  follow as a `fresh` re-render (viewer reloads on `renderedAt`); no import
  animation, an upload is a small toast (`UploadToast`). Where: `import/ready-blank.ts`,
  `import-deck.ts` (`later`), `DeckPage`. Check: api `odp.test.ts`, `import.test.ts`; e2e `02-upload`.

## KI-Apps (MCP)

- **AI apps act only with their bearer token, never the cookie** – `/api/mcp` reads no session;
  OAuth (PKCE, rotating refresh) or a token from „KI-Apps“ on /konto, each held to its workspace if
  chosen, „Entfernen“ ends it at once; the OAuth routes stay public, everything else needs a
  session. Where: `routes/app-connections.ts`, `services/app-connections.ts`, `services/mcp.ts`,
  `app.ts` (CORS, `sameOriginWrites`), `http/desktop-guard.ts`. Check: api `materials.test.ts`
  (MCP), `auth.test.ts`.

## Comments

- **Comment marks stay visible and clickable over the editor**; hover boxes from one source, one
  look. Where: `useSlideBoxes`, `ShapeOutline`, `markTint`, `EditLayer`. Check: hover/click a mark
  in Bearbeiten and Prüfen – identical.
- **Comments work offline** – every comment action shown at once (pending dimmed), queued in the
  browser (`browserQueue` store `comments`), sent per deck in order, also after reload; a new
  comment carries its own id (`newCommentId`, server dedupes retries); a refusal toasts once and
  drops dependents. Where: `lib/api/comment-outbox.ts`, `comment-cache.ts`, `lib/api/comments.ts`,
  api `retriedComment`. Check: `comment-outbox.test.ts`, api `comments.test.ts`,
  `bun run e2e:bundle` 12-offline.

## App shell

- **No jerk switching Präsentationen ⇄ Bibliothek in Safari** – view switch scrolls to top. Where:
  `features/workspaces/components/WorkspaceViews.tsx`. Check: real Safari, not Playwright WebKit.
- **A template is saved the moment it exists** – no draft or save button; failed saves retried
  server-side. Check: create, reload, it is in Bibliothek → Vorlagen.
- **Closing returns to where you came from** – Vorlage → Bibliothek → Vorlagen
  (`routes.workspaceMaterial(id, 'vorlagen')`), Präsentation → Präsentationen.
- **Unsplash guideline compliance** – hotlinks, `download_location` once, visible credit. See
  agent-notes §Unsplash.

- **Completed presentation runs survive a browser change** – slide times and optional recording
  kept server-side, newest five per deck; leaving before the end or closing the tab stores no run.
  Where: `routes/show-runs.ts`, `presentation/lib/show-runs.ts`. Check: api
  `deck-creation.test.ts` (uploads, ranges, retention, retry); e2e `04-keyboard.spec.ts`.

## Cloud (the workspace's files)

- **What goes up comes down byte for byte, and nothing is overwritten** – a second upload of a
  name is the file's next version, earlier ones stay to look at and bring back; deleting keeps
  30 days. Where: `services/cloud/files.ts`, `nodes.ts`, `sweep.ts`. Check: api `cloud.test.ts`.
- **One's own files are one's own** – not even workspace admins see them (members and admins
  have them; who only looks or comments has none and may only look, whatever a share says).
  Sharing by hand is off unless `CLOUD_SHARING=true`; a share (a presentation's chosen people) opens the
  shared file or folder and what is in it, never what lies above or beside it; links for people outside are off
  unless the instance sets `CLOUD_PUBLIC_LINKS=true` (then: only its file or folder, read only,
  until it expires or is removed; turned off again, old links open nothing). Where: `services/cloud/context.ts`,
  `shares.ts`. Check: api `cloud.test.ts` (rights, link).
- **Uploaded files run nothing in Slider's origin** – only pictures, video, audio and PDFs are
  sent as what they are; text as plain text, the rest as a download, with a sandbox CSP. Where:
  `routes/cloud.ts` `inlineType` / `sendVersion`. Check: api `cloud.test.ts`.
- **The panel beside the page stays until ✕ or Esc** (the user, 2026-11-26) – a to-do, a file's
  details, an event or a call goes along to every other Cloud page (side bar, links, the to-do's
  „Zu den Aufgaben“/„Chat mit …“), set on the way itself so it neither closes nor slides in
  anew; a click beside the files lets go of the pick only. Closes otherwise only when another
  panel takes its place or its thing is deleted. Where: `hooks/useKeptPanel.ts`, `CloudPage`
  (Esc-only unpick), `CloudLayout`. Check: by hand – open a to-do, click through the side bar, the
  panel's node stays (no slide-in), ✕ and Esc close it.

## Writer (text documents)

- **The file stays a real text file, and what Writer does not know stays in it** – an edit is
  written as single operations into the file's XML; unknown content is locked in the editor,
  never dropped. Where: `packages/odt/src/document.ts`, `services/documents.ts`. Check:
  `packages/odt/test/document.test.ts`, api `documents.test.ts`.
- **What is typed is what is saved and what others see** – the editor sends the steps between
  two states of its model; undo is the older state sent the same way. Where:
  `features/writer/lib/model.ts` (`stepsBetween`, `applySteps`), `editor/engine.ts`. Check: web
  `features/writer/lib/model.test.ts`.
- **The layout: pages left one under the other, the sheet in the middle, comments left and
  right of it, tools on the right** – and the sheet never jumps when comments come or go (the
  room beside it is always kept). Where: `features/writer/editor/Editor.tsx`. Check: look at it
  (docs/agent-notes.md, Writer).

## Reader (PDFs)

- **The PDF file is never changed** – what is filled in, typed, ticked and signed lies over it
  (`pdf_marks`) and is baked in only for export and print. Where: `services/pdfs.ts`,
  `services/pdf-bake.ts`. Check: api `pdfs.test.ts`.
- **What is filled in is what is exported and what others see** – one mark per field
  (`field:<name>`), sent through the viewer's outbox (`viewer/marks.ts`), live to everyone on the
  PDF; a field sized „fit to the box“ gets the same size on screen and in the file. Check: api
  `pdfs.test.ts`, e2e `14-reader.spec.ts`.

## Sender (messages)

- **Only who may read a conversation sees its messages, anywhere** – side bar, search hits,
  quotes, reactions, pushes and agents keep to `visibleChannels` / `seen`; an area viewer reads
  but neither writes nor reacts. Where: `services/sender.ts`, `routes/sender.ts`. Check: api
  `sender.test.ts`.
- **Nothing typed is lost** – sending is optimistic, a refused send stays in the list with „Erneut
  senden“ (text, files and quote kept); unread and mentions count only others' messages. Where:
  `lib/api/sender.ts`, `features/sender/components/MessageList.tsx`. Check: api `sender.test.ts`,
  e2e `15-sender.spec.ts`; stop the API, send, start it, „Erneut senden“.
- **A message shows as written** – formatting and links only rendered, never changed in the text;
  words with underscores and web addresses stay whole. Where: `MessageText.tsx`, `LinkedText.tsx`.
  Check: e2e `15-sender.spec.ts`.
- **The field shows a message as it will stand, and keeps its text** – `RichField` (Lexical) reads
  and writes the message's text (`lib/markup.ts`): what it wrote reads back the same (other
  spellings come back in its own: `* a` → `- a`, `*x*` → `_x_`), a „Bearbeiten“ left untouched is
  not saved, what it shows bold/italic/… the message shows the same; a mail's reply stays a
  textarea (plain text goes out). Where: `RichField.tsx`, `lib/rich-markup.ts`, `Composer.tsx`. Check: web
  `markup.test.ts`, e2e `15-sender.spec.ts`.

## Calls

- **A call from a conversation opens, never a black page** – `CallProvider` and everything it
  shows (dock, ringing card, tiles, „Hinzufügen“) stand around the router in `App.tsx`: no
  router hook in there (`useSearchParams`, `useLocation`, `useActiveWorkspace`, `useAgentAvatars`
  – agent pictures by `useWorkspaceAgentAvatars`), or the first call unmounts the whole app.
  Check: web-dom `features/calls/CallProvider.test.tsx`; a call between two browsers
  (docs/agent-notes.md, Calls).
- **Through LiveKit only who the hub let in, and out when the hub says so** – tickets only with
  `CallJoined` (room = call id, identity = tab, 10 min), leaving sends the tab out of the room,
  the end deletes it, a stranger in the room is sent out by the signed webhook; without LiveKit
  the mesh stays exactly as it was (8 people). Remote video through `track.attach` (adaptive
  stream). Check: api `calls.test.ts`, web-dom `features/calls/CallProvider.test.tsx`; a call
  between two browsers with and without `LIVEKIT_URL` (docs/agent-notes.md, Calls).
