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
- **„Hinzufügen“ holds what is there still** – every element present when the mode began acts
  locked (editor only, never in the file); double click or its lock → Bearbeiten with it picked,
  never a `setLocked`. Where: `EditingProvider` `setAdding`/`heldStill`/`isHeld`, `ToolBar`,
  `LayersPanel`. Check: `model.test.ts`.

## AI

- **A box drawn while speaking to the AI goes to the AI** – in any mode, a small AI-look field
  beside the box takes the live words (cut from the voice session at open/close); ↵ sends a comment
  and asks the AI, Esc drops it; anything taking its place sends it first, never nudged; drawn
  again on a running request of one's own → adds to that thread („Ergänzt den laufenden
  Auftrag“). Where: `AiBoxComposer`, `useSendAiBox`, `usePlaceAiBox`, `voice/lib/ai-additions.ts`,
  `draft-reducer`. Check: `viewer-state.test.ts`.
- **A request about an open thread's subject goes on in that thread** – same element(s) or box IoU
  ≥ 0.6 on the same slide (`threadForRequest`) → reply there, a running run stopped and re-asked;
  own session thread → addition; resolved threads / whole slide / typed comments unchanged. Where:
  `shared/shapes.ts`, `voice/session.ts` `joinOpenThread`/`stopRunsIn`, `useSendAiBox`. Check:
  `voice.test.ts`, `viewer-state.test.ts`.
- **The AI makes new elements as a person does** – shapes, text, lines, copies, new slide content
  via `change_elements` / quick edits → `quickPlan` → the editor's `addElement`/`copyElement` (ids
  `sl…`, browser-drawn, typable); an empty list placeholder filled shows bullets; XML only for
  tables, charts, pictures, gradients. Where: `voice/quick-edits.ts`, `ai-proposals.ts`,
  `quick-requests.ts`, `voice/router.ts`. Check: api `ai-proposals.test.ts`, `voice.test.ts`.
- **A sticker is a comment, also for the AI** – sent alone its text is the body (counted, listed);
  ⌘↵ sends and asks the AI; „An die KI geben“ in its menu; AI reads its text + box (`markText`);
  the AI stickers only what people must notice. Where: `stage/lib/text-box.ts`, `TextBox.tsx`,
  `useMarkMenu`, `services/comments.ts`, `ai-proposals.ts`. Check: api `ai-proposals.test.ts`,
  `comments.test.ts`.

## Material board (Folie 0) and deck creation

- **Folie 0 never goes into the file** – lives in `deck_materials`/`deck_board_items` + media
  store; never in the ODP, exports, LibreOffice or slide count; laid before slide 1; rights as
  comments. Where: `services/materials.ts`, `routes/materials.ts`, `features/viewer/board/`,
  `timeline-layout.ts`. Check: api `materials.test.ts`, `timeline-layout.test.ts`,
  `board-outbox.test.ts`.
- **The AI reads material through tools** – first message only lists files (`materialsBrief`);
  content only via `list_materials`, `read_material`, `read_sheet`, `search_materials`,
  `view_material`; text extracted in background, encrypted in `material_chunks`, searched in the
  server. Where: `material-extract.ts`, `material-tools.ts`, `ai-context.ts`. Check: api
  `materials.test.ts`, `ai-proposals.test.ts`.
- **A new deck is built from the prompt on Folie 1** – „Neue Präsentation“ opens on Folie 0; while
  the deck is its blank start Folie 1 is the prompt (description kept per deck, takes live speech
  with a strict `claim`; 8 kinds; Stil = templates; 5–30 pages; material always used); „Erstellen“
  closes at once, outline shows, each slide its own AI step, Abbrechen keeps what is built; „Leer
  anfangen“ closes for good. Where: `services/deck-creation/`, `CreatePrompt`, `creation-draft.ts`,
  `useHeardWords`, `CreationProgress`, `Timeline`. Check: api `deck-creation.test.ts`,
  `creation-draft.test.ts`.

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
