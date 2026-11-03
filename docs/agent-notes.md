# Agent notes – tested facts the code does not show

Read the section before touching the area. Each fact was measured; don't re-test it or build
around it differently without a new measurement. Rules and the "do not break" list are in
[`CLAUDE.md`](../CLAUDE.md).

## LibreOffice

All tested with LibreOffice 26.8 on macOS.

### Render pool (`apps/api/src/import/office-pool.ts`)

- Editor drawings (edited slides, a slide's layers for the composed editor) go to a pool
  of running LibreOffices (`LIBREOFFICE_WORKERS`, default 2). Uploads/imports still use one
  `soffice` each – isolation from untrusted files.
- macOS refuses to start LibreOffice's bundled Python on its own ("Launch Constraint
  Violation", SIGKILL). So the worker (`office-worker.py`) runs *inside* soffice as a
  user-profile script (`vnd.sun.star.script:office-worker.py$serve?language=Python&location=user`)
  and talks over a Unix socket. Docker needs `libreoffice-script-provider-python`.
- `DisableMacrosExecution=true` also blocks that script; the pool profile sets it false
  (`hardenedProfile(..., { poolScript: true })`) and relies on: drawing copies carry no
  scripts/events (pruned), `MacroExecutionMode` never on load, security level 3.
- A running LibreOffice keeps one profile, so per-deck font replacements are written into the
  drawing copy (`replaceFonts`), not the profile.
- `OdpDocument.toDrawingBytes` empties other pages and drops unused masters/styles/pictures –
  pixel-identical, 2× faster (PowerPoint decks have a master per layout).
- Layers (`toLayerBytes`): each element alone rendered on white and black and matted – the PDF
  always paints the page white, so transparency needs the pair. Cutouts (masks painted in the
  element's colours, `toCutoutBytes`/`LiveLayer`) were deleted 2026-11-02: the composed editor
  draws whitelisted elements itself (`paint`).
- Master shapes (`toLayerBytes` `compose`, `SlideLayers.masterShapes`): the slide without its
  elements, its own style's fill set to white/black (that hides the master background, keeps
  master shapes/footer flags), matted. Its fingerprint ignores the background and the elements,
  so it is drawn once per master; the browser draws the slide's own background beneath it
  (`SlideGround`). Browser gradient (`gradientBackground`) vs LibreOffice measured: mean diff
  < 1/255; `live-parity --compose` on a dark gradient background 0.002 %.
- Element gradients drawn by the browser (`paint.gradient`): every kind matches within 0.6 %. A
  turned shape's gradient is not turned with it: LibreOffice lays it over the turned shape's
  upright bounds (`TurnedGradient`, 0.02 %; turned with the shape it was 3 % off). An
  ellipsoid's middle stops lie otherwise (5 %), a turned ellipse or rounded box would need
  another cut – those stay LibreOffice's picture.

### Styles and text

- `style:parent-style-name` naming an **automatic** style is ignored in every family
  (paragraph, text, presentation; graphic even draws garbage). Only common styles (styles.xml
  `office:styles`) work as parents. `addStyles`/`addOwnStyles` fold such parents in
  (`inheritAutomaticParents`); `StyleIndex.chain` follows only common parents.
- LibreOffice never takes the font from `style:default-style` (graphic). A frame whose style
  has no parent (or no style) sits on „standard“: the file's common one, else LibreOffice's own
  (Liberation Sans 18pt, padding 0.125/0.25 cm, shapes filled). A file „standard“ with only a
  font drops that padding (ODF defaults), so `blank.ts`'s „standard“ carries padding etc. too.
  Decks started blank 2026-10-28…11-01 have no „standard“ → their text *is* Liberation Sans in
  LibreOffice; the parser says so too (`standardUnder`).
- A `style:font-name` in content.xml resolves only against content.xml's own
  `font-face-decls` (blank decks declare Inter in styles.xml only) – undeclared means ignored.
  `StyleIndex.propertiesOf` drops it; `fontFaceFor` offers only content faces (the editor writes
  `fo:font-family` otherwise).
- Text padding where no style sets it: 0.125/0.25 cm for frames and shapes (even without a
  parent style), **0 for presentation placeholders** (title, subtitle, outline).
- A picture frame marked `presentation:placeholder="true"` (any `presentation:class`, e.g.
  `graphic`) is an **empty placeholder to LibreOffice: its `draw:image` is passed by and nothing
  is drawn** (PDF and PNG, tested 2026-11-02). Template picture placeholders therefore land on
  new slides (`addSlide`) as `presentation:class="graphic"` frames holding the grey placeholder
  SVG, unmarked; `replaceImage` drops the mark on frames made before.
- Templates designed in Slider: every typable, unlocked, unturned text box of a layout is a text
  placeholder (`layoutPlaceholders` in shared – kind marked before, else the file's role, else
  largest letters = title, the rest outline; locked = fixed decoration); its typed text is the
  prompt. `addSlide` writes each placeholder's prompt onto the slide frame (`slider:asks`) and
  gives every placeholder after the first of its kind its own look (an automatic presentation
  style over `<master>-outline1`) – LibreOffice has one title/subtitle/outline style per master.
- LibreOffice binds a master's presentation styles by the master's **display name**
  (`<display-name>-title`), not `style:name` (tested 2026-11-02). Without a matching
  `style:display-name` on `Slider_N-title` etc. it ignored them: placeholders drew with 0 padding
  (the editor 0.25 cm – Bearbeiten ≠ Prüfen) and plain text (`setText`, the AI's XML) in its
  default look. `toTemplate` now writes `style:display-name="<layout>-title"` (only when no two
  layouts share a name) and the frame's whole graphic look into the style – a property left out
  takes LibreOffice's default (blue fill, line). A master taken into a deck under a new display
  name (`… (2)`) renames its styles' display names along. LibreOffice ignores text properties of
  an automatic presentation style (a second placeholder's own look): the editor reads them, and
  typed text carries its whole style, so only plain writes take the first one's size. Drawn
  slide-wide (3840) with the master's background alone (`masterGround`: a bare page of that
  master, own fill gone, `background-objects-visible="false"`, footer flags off – the same page
  for every slide of the master, so drawn once), in a PDF call of their own.
- Effects („Effekte“ under „Füllung“, `effectProperties`/`effectsOf`): `draw:shadow` +
  offsets/colour/opacity, `loext:shadow-blur`, `loext:softedge-radius` (blurs inwards, the
  shape shrinks visibly), `loext:glow-radius/-color/-transparency`; pt values are read fine.
  All drawn in the PDF path Slider renders with; `--convert-to png` drops blur, soft edge and
  glow. An undeclared `loext:` prefix (blank decks) is silently ignored – `declareLoext`. No
  background blur (frosted glass) in LibreOffice. Elements with effects get no `paint` → their
  change shows once LibreOffice's picture of them comes.
- Backdrop blur („Hintergrund-Unschärfe“, `ElementEffects.backdrop`, built 2026-11-02): no
  LibreOffice property – kept in the `slider:fills` mark as `backdrop: {radius, source}`.
  `source` hashes the fingerprint of the slide under the element (`blankElement`: it and
  everything over it gone), its box/turn/flip, the radius and the layers; `editFile` bakes every
  stale one bottom-first (`bakeBackdrops`) before committing: the slide under it from the pool
  (cached in blobs by that fingerprint, so moving/resizing only re-blurs), edges clamped,
  blurred (3 box passes ≈ Gaussian, worked out at σ ≈ 6 px on a smaller copy), layers painted
  over (`gradientPixels` from shared), JPEG as a stretched bitmap fill. `radius` 0 in the mark =
  picture still holds a blur, re-baked of the layers alone. ~1.1 s per step with a warm pool.
- A bitmap fill with `style:repeat="stretch"` is stretched over the shape's **upright bounds on
  the slide** – not turned with a turned shape, not mirrored with a mirrored one (LO 26.8,
  tested 2026-11-02) – so a turned element's backdrop is that upright part of the slide.
- Text effects (LO 26.8, PDF path, tested 2026-11-01): an **unfilled** box's shape shadow
  (`draw:shadow` + offsets/colour/opacity/`loext:shadow-blur`) is cast by its letters – the text
  tab's „Effekte“ (`letterShadow`; the typing editor draws it as CSS `text-shadow`, fainter
  under see-through letters, as LO does). A filled box casts it itself, the letters none.
  Survives PPTX. `loext:opacity` on text properties = the letters' opacity (40 % → 40 %
  opaque), per run (`LiveTextStyle.opacity`, always written so a span never takes its
  paragraph's); `0%` in default styles means „not set“, so the editor writes ≥ 1 %. Not drawn
  on letters: `loext:glow-text-*` (nothing in PDF), shape glow/soft edge on an unfilled box,
  `fo:text-shadow` (colour and blur ignored, lost in PPTX), `style:text-outline` (hollow
  white). **Gradient/picture inside letters** only as Fontwork: `draw:custom-shape` with
  `draw:type="fontwork-plain-text"` `draw:text-path="true"` `draw:text-path-mode="normal"`
  and the shape's fill (`draw:fill="gradient|bitmap"`) – font size stays, the fill spans the
  whole text block, survives PPTX (its shadow does not). Limits: no automatic wrapping (only
  `text:line-break`/paragraphs), alignment per box (`draw:textarea-horizontal-align`, paragraph
  `fo:text-align` ignored), font/weight must sit in the graphic style's `style:text-properties`
  (span props partly ignored). Not built.
- **Text layout units** (LO 26.8, measured 2026-11-03 from the PDF's text origins): Impress lays
  text out on a 600 dpi reference device – the font height in 1/100 mm, then whole device
  pixels (20 pt → 706 → 167 px = 20.04 pt; the PDF names 20.01), ascent and descent of the hhea
  table (typo with `USE_TYPO_METRICS`) each rounded to whole pixels. Letters advance at that
  rounded size: a 20 pt line is 0.2 % wider than at 20 pt sharp. The editor does the same
  (`layoutSize`, `lineBox` in `live/css.ts`): every baseline within 0.05 pt of LibreOffice's.
- **Chromium's baseline** (measured): ascent and descent (the `@font-face` overrides) each
  rounded to whole CSS px, half the leading rounded *down* – up to ~1 px higher than worked out
  unrounded, more on a turned/zoomed slide. `baselineShift` works it out in CSS the same way
  (`round()`); device pixel ratio changes nothing (headless Chromium, macOS).
- **Kerning**: LibreOffice kerns letters in pairs only where `style:letter-kerning="true"` is
  set; a file that says nothing (decks started blank before 2026-11-03) is not kerned – Inter
  40 pt bold drifted ~4 px over a line against the browser's kerning. Read as `kerning: false`
  (CSS `font-kerning: none`); blank decks now set it true in their default and „standard“
  styles, the editor writes it on every span.
- Turned text: LibreOffice's PDF puts a turned text's origin where the editor's is, yet its
  letters are drawn ~0.9 px off across the baseline (Chromium draws turned text exactly as
  upright, measured) – a 15° box with text measures 2.4 % (`live-parity --compose`, not gated
  per element). Open.
- Fonts LibreOffice and the browser lack are mapped by kind to Liberation Sans/Serif/Mono on
  both sides (`officeFontFor`, per-deck replacement table) – otherwise macOS LibreOffice falls
  back to serif.

### Fonts

- Local LibreOffice has none of the Google fonts (Docker installs `fonts/google`);
  `fontconfigEnv` points every soffice (pool and single run) at the checkout's `fonts/google`.
  A fontconfig folder per run (`FONTCONFIG_FILE`) works on macOS too. Locally there is no
  system font cache: without the shared `<cachedir>` (`$TMPDIR/slider-fontconfig`) each fresh
  soffice reads all 100 families again (+0.7 s per run, measured). The image runs `fc-cache`.
- ODP: LibreOffice writes embedded fonts (`Fonts/*.ttf`, `svg:font-face-src`) into
  **content.xml**, not styles.xml, and embeds every font the file names (even Asian/complex
  defaults like Linux Libertine G). It draws them itself, even when Slider's replacement table
  names the family.
- PPTX `.fntdata` (TTF or EOT) is **ignored** when drawing. Slider does not unpack it (focus on
  ODP; a missing font is replaced).
- Fonts an ODP brings go into the workspace fonts (`services/deck-fonts.ts`): installable
  fsType only, whole fonts, used for Latin text, never over an existing family, not Slider's own.
- For any font feature, test with a real LibreOffice-made ODP first (Tools → Options → embed
  fonts / `EmbedFonts` in settings.xml).

### Gradients

- PDF export draws every gradient style (linear/axial/radial/ellipsoid/square) as flat
  polygons, never as a native shading. Bands = largest channel change / 2, at most 128;
  `draw:gradient-step-count` changes nothing. Don't try LO settings again.
- `deband.ts` (called by `smoothGradients` in `pdf-render.ts` on every page/layer/cutout before
  encoding) finds ≥ 4 equal-width flat bands with small steady steps, redraws them as a ramp and
  adds dither that is the same for the same pixel (white/black layer pairs stay identical).
  ~25 ms on a 4K page without gradients, ~200 ms with.
- WebP q90 re-adds faint mottling, but q100 means lossless with napi-rs (3.7 MB) – stay at 90.
- See-through stops (LO 26.8 tested): a shape draws a `draw:opacity` (named, styles.xml) with
  `loext:opacity-stop svg:offset svg:stop-opacity` children, same style/angle/cx/cy as its
  `draw:gradient`, via `draw:opacity-name`. LO runs colour and opacity apart (not premultiplied
  like canvas/CSS gradients) – the editor paints such gradients pixel by pixel to match.
- A slide background is never see-through in LO: `draw:opacity` and `draw:opacity-name` on
  `style:drawing-page-properties` are ignored (drawn opaque). A PNG with alpha as the page's
  bitmap fill is drawn over white – so a see-through background goes as a composite picture
  (`nativeFill(fills, true)`).

### Colour themes

- ODP theme = `loext:theme`/`loext:theme-colors` on the master page in styles.xml; element refs
  = `loext:fill-complex-color` / `loext:char-complex-color` (`theme-type="accent1"`,
  `loext:transformation lummod…`) **next to** a fixed `draw:fill-color`/`fo:color`.
- LibreOffice draws the fixed value; changing only the palette changes nothing. Refs without hex
  resolve against LibreOffice's default theme (accent1 #18a303), not the file's. UNO
  `ThemeUnoRepresentation` sets the palette without recolouring; `.uno:ChangeTheme` does nothing
  headless. Refs survive ODP resave and PPTX export.
- So: write ref + computed hex per element; on theme switch Slider rewrites the palette and every
  referenced hex itself (XML pass in packages/odp), then re-renders.
- Built: one palette per template (`DeckTemplate.colors` → `workspace_masters.colors`),
  per-deck `decks.custom_colors` (0076), `Deck.colors {template|null, custom}`. Not yet: several
  themes, theme refs in the ODP, palettes read from uploaded PPTX/ODP templates.

### Guides (Hilfslinien)

- LibreOffice's snap lines (`SnapLinesDrawing` in settings.xml, `V…H…` in 1/100 mm) are the
  whole file's – there is no per-page or per-master snap line. Each layout of a Slider template
  has its own guides (`DeckTemplate.layoutGuides` by page id; `guides` = the old shared ones,
  fallback for layouts without own), so `toTemplate` writes them as `slider:guides` on each
  master page and only those all layouts share as snap lines. `OdpDocument.slideGuides()`: a
  slide's layout's guides, else the snap lines (old templates, foreign files).

### Picture fills of shapes (measured, `live-parity --sample --compose`, slide „fills“)

- LibreOffice lays a shape's bitmap fill (`style:repeat="stretch"`) over the **upright bounds of
  the drawn geometry** – a turned shape's picture is not turned with it, a mirrored shape's
  (`draw:mirror-*`) not mirrored. For LibreOffice's own geometry the bounds are tight (a quarter
  pie fills only its quarter's box); for PowerPoint's presets (`ooxml-*`) they are the turned box's.
- `draw:enhanced-path` as LibreOffice draws it (`shapeAreaSteps`): `drawooo:enhanced-path` wins
  (it has `G`, PowerPoint's arcTo: angles as seen in the path's own view, before it is stretched);
  `drawooo:sub-view-size` gives each `N` part its own view; `T`/`U` angles run clockwise as seen,
  their sizes are radii; `X`/`Y` controls lie halfway to the corner; parts marked `F` are lines only
  (a cloud's inner arcs) and lie over the fill.

### Parity on a real deck

Decrypt the deck's blob (EncryptedBlobStorage + `.data/data-key`), then from `apps/web`:
`bun --tsconfig-override=tsconfig.app.json scripts/live-parity.ts <deck.odp> <out>` (plain
`bun apps/web/scripts/...` fails on the `@/` alias).

## Live editor

- Edit mode composes each slide (`SlideCompositor`): LibreOffice's slide without its elements
  (or the slide's own background drawn by the browser over the master's shapes), then the
  elements – whitelisted ones (`paint`) drawn by the browser, the others as LibreOffice's picture
  of each alone with their live text left out (`toLayerBytes` `compose`, `blankText`) and drawn
  by the browser over it. Until a slide's pictures are decoded it is LibreOffice's picture alone
  and not editable (`useComposed`): measured 2026-11-02 from „Bearbeiten“ to composed – blank deck
  cold 468 ms, warm p50 89 ms; demo.odp cold 588 ms, warm p50 145 ms (p95 ≈ p50 + 15 ms).
- A drawn shape's text wraps in the first rect of `draw:text-areas` (hexagon ≈ 18.6 % in on
  each side), padding inside that – not in its box (`textAreaInset` in shared, `LiveElement.textArea`).
  A shape with only `draw:type` (Slider's inserts) uses LibreOffice's preset (table in
  `text-area.ts`, read from a soffice round-trip). `ooxml-*` shapes count in the box's 1/100 mm
  (viewBox `0 0 0 0`); `draw:path-stretchpoint-x/y` (rounded rectangle, octagon) divide that
  axis' insets by the box's aspect when it is longer that way. LO 26.8: all line breaks match.
- A box with `draw:auto-grow-height="true"` is drawn as high as `max(svg:height, its text)` –
  `fo:min-height` is ignored (LO sets the min frame height from the box on load; Slider writes
  the drawn height there on insert and never updates it). So `boxCss` takes `bbox.h` as least
  height, never `fo:min-height`. Tested LO 26.8: drawn 0.4 slide high with one line, `setBox`
  to 0.08 or 0.03 – LibreOffice draws the text's height (≈ 0.081 for Inter 24 + 2 × 0.125 cm).
- „Höhe an Text anpassen“ and the corner's double click both take the height from
  `measureTextSize` (the picked text drawn unseen, `TextSizeMeasure`): height auto, sub-pixel
  (`getBoundingClientRect`, `offsetHeight` rounds a point away), shrink-to-fit off, a shape's
  text-area share solved for the box. Matches LibreOffice within ~0.0005 of the slide.
- Picking an element under 96 px on screen glides the zoom in (max 3×) and back on deselect –
  `useAutoZoom`, switchable in Konto → Arbeiten („Kleine Elemente heranzoomen“, default on).
- „Sperren“ (`setLocked`) writes `style:protect="position size"` into the element's style –
  LibreOffice's „Position und Größe schützen“, kept by a soffice ODP round-trip. Only `position`
  counts as locked: ordinary files carry `style:protect="size"` on frames LibreOffice sizes
  itself. LO's PPTX export writes no `a:spLocks noMove` for it (PowerPoint does not see the lock).
- Undo (⌘Z/⇧⌘Z, `useOwnUndo`) runs in the browser: each own edit gets its way back worked out
  from the elements as shown when it is made (`undo-ops.ts` `inverseOf`), sent like any edit –
  instant, queued offline. Redo sends the edit again. Before either, the touched elements are
  compared with how the edit left them (`changedSince`, numbers within the file's rounding): one
  someone else changed since is left out (toast). A deleted element comes back by `copyElement`
  of its id (the server finds it in the file before its delete step, `loadSources`) under a new
  id, every later undo/redo step renamed to it, then `moveElement` to its old place in the stack.
  No way back in the browser – `deleteSlide`, `useVariant`, `replaceImage`, `setTilt`, text the
  live editor cannot read, a fill with a picture in it, slide settings while another edit of that
  slide is on its way – that step goes to the server (`revertChange`), online only, as before.
  The outbox merges a coalesced edit only into its last queued edit, so a way back sent after it
  is never overtaken.
- Working together: each new step goes to the others with its operations (`LiveStep` in the
  `slides` event; `clientEditId` tells the own tab's edits apart – those are skipped). The editor
  applies them to the elements at once (`withRemoteStep`) – before, it waited for the refetch of
  `/edit` (measured 2026-11-02 in e2e:live 14: a remote gradient shows 65–73 ms after the step was
  answered). Own edits on their way are replayed over them (`rebased`), stacking moves too
  (`restacked`, now optimistic for own `moveElement`). Undo leaves out an element someone else's
  step touched since the edit (exact, `othersMark`/`touchedByOthers`) besides the rounding check.
  Drags and picks of the others come with presence (`drag` 25 Hz at most, `picked`).
  Offline, composed layers kept by the service worker are taken even of another step (the
  browser-drawn elements come from the model), drawn anew on `online`.

## AI slide edits (`apps/api/src/services/ai-context.ts`, `ai-proposals.ts`)

- Ugly AI slides were a context problem. The first message carries a design brief (palette,
  type per role, grid columns in cm, guides, margins, masters with placeholders), an overview
  contact sheet, the commented slide with element inventory and layout check, neighbouring
  slides and their open comments.
- Tools: deck_overview, read_text, inspect_slide, zoom_slide, view_layout, list_comments; a
  layout check comes with every drawing after a write. Effort `high`; old tool results cleared
  via `clear_tool_uses_20250919` (`TurnRequest.effort` / `clearToolResults`).
- Improve quality by extending the brief, the check or the tools – the user prefers rich context
  and look-up tools over a longer system prompt; cost is no object. No forced extra "review
  turn": FakeAnthropic tests script every turn, and the 10-min run limit matters.
- Text the live editor rejects is read via `withTextLooks` (lenient style resolver).
- Pictures to the AI: Anthropic 400s a request with many images if one side is > 3000 px
  (slides are drawn 3840 wide, phone photos ~4000). `runTurn` → `fitPictures` shrinks every
  base64 image to ≤ 2560 px in place, once (same bytes every turn – prompt cache); the deck keeps
  the original.
- A fresh instance takes `ANTHROPIC_API_KEY` over only on the first AI request
  (`effectiveKey`), so `deck.ai.available` – and the AI avatar – is false until then.
- Speed (2026-11): every run logs `AI <id> turn n: model … (first token …, out, in/cached),
  tools …` and `AI <id> done in …` – read these before guessing where time goes. Levers in
  place: looks of one answer run side by side (`callGroups`); effort `high` for the design,
  `medium` after the first write via a per-message effort system message (cache kept; it needs a
  user turn with new input, so a text block rides with those tool results – models without it
  get the message stripped, `TURN_EFFORT_MODELS`); `fast: true` → Opus 5.5/5/4.8 in fast mode
  (Anthropic charges 2×), 429/refusal → standard; `change_elements` (editor ops via
  `quickOperations`, no XML) preferred over XML writes.
- Quick requests (`quick-requests.ts`): on Anthropic keys, a ⌘↵ request (not said aloud, not
  between slides, no thread pictures) first goes to Haiku (~0.9 s, forced tool `edit`); plain
  edits are applied on the run's `DeckCopy` (`applyQuick`) and settle like any run – no brief,
  overview or drawing is made (`open()` is lazy). Anything else → the full AI. A thread about
  several slides („alle Folien“, „überall“, „Folien 2 und 3“ – `aboutSeveralSlides`, whole thread
  incl. replies) never asks Haiku: it once made a reply's fill change and dropped the rest. Tested against
  real Haiku: 8/8 cases right (bold, place, recolour+bigger, dictated text → edits; „als
  Aussage“, „kürzer“, „aufräumen“, questions → none). Re-test with a scratch script on prompt
  changes; FakeAnthropic answers forced tool calls from `quick` (default no edits).
- New elements through the editor's operations, not XML (2026-11-03): `change_elements` (and the
  router's / Haiku's `edits`, one schema `quickEditSchema` + `EDIT_ITEM_SCHEMA`) take `add` (text,
  the „Form“ shapes, line, arrow) or `copy_of`, a `name` later changes of the call refer to,
  places by `box`, `next_to` (beside/below another, lined up; with `next_to`/`place` a box gives
  only the size – Haiku fills x, y with 0), `align_with`, `size_like` (none said: both), lines
  `from`/`to` an element's facing edge (straight across when side by side; < 1 cm refused – make
  room first). `quickPlan` (`voice/quick-edits.ts`) makes the editor's own `addElement` /
  `copyElement` ops one after another (id `sl…`, the slide's body text style else Inter, as
  `useInsertFrame`): the result is browser-drawn (`paint`) and typable – XML-written shapes were
  neither. The tool result names the new ids. Prompts: a new slide = `insert_slide` (layout or
  `copy_of`) + `change_elements`; XML only for tables, charts, pictures, gradients, custom
  geometry, fields. Traps found measuring: an empty list placeholder filled by `setText` shows no
  bullets (the AI then rewrote the slide as XML) – `text` on an empty `outline` placeholder is
  `setRichText` with a bullet list; Haiku answered every add with `edits: []` while the tool's
  array had `maxItems` (4/4, without 4/4 right); the editor's text styles carry `loext:opacity`,
  so a change made on a copy of a blank deck was refused by the deck itself („Unknown namespace“)
  until `authoredProblems` declares `loext`.
- Measured with the real models (Sonnet 5.5 design AI, Haiku 5.5 quick/router; scratch API with
  soffice, 3 runs each, wall time from the request until the proposal is done / the voice item
  applied; „XML“ = write_slide/edit_slide calls; „drawn by browser“ = new elements with `paint`):

  | Task (deck) | before: s (mean) / out tokens / XML | after: s / out tokens / XML |
  | --- | --- | --- |
  | „Füg zwei Kreise rechts neben den Titel ein“ (demo, slide 2) | 27.3 / 901 / 3.3 – not drawn by browser | 16.3 / 1096 / 0 – drawn by browser |
  | „Mach einen Pfeil vom Bild zu den Meilensteinen“ (demo, 4) | 24.1 / 1681 / 1.7 | 20.0 / 1385 / 0.3 |
  | „Neue Folie nach Folie 1 mit Titel ‚Agenda‘ und drei Punkten“ (demo) | 16.4 / 1006 / 0.3 | 19.1 / 930 / 0 |
  | „Drei gleich große Kästen nebeneinander mit Text Plan, Bau, Start“ (blank) | 19.7 / 1617 / 2 – text not typable | 10.1 / 709 / 0 – typable |
  | ⌘↵ „Mach hier zwei Kreise hin“ (blank, point 70 %/40 %) | 10.0 / 809 / 1 (full AI) | 1.4 / – / 0 (Haiku, made at once) |
  | Voice „Mach hier zwei Kreise hin“ (blank, pointer 70 %/40 %) | 9.4 (router → full AI) | 1.7 (router edits) |

  „Rechts neben den Titel“ stays with the full AI: the title box spans the slide, `next_to` it
  leaves the slide and is refused (before that fix Haiku's 0/0 box put the circles in the corner).
- While running, `progress` (step + small drawing of the last write, a thumbnail key deleted when
  the run ends) is in-process only – another API instance shows `null`.
- Stickers (text on the slide, `TextStroke`): one sent without a comment of its own has its text
  as body, so SQL counts it (strokes are sealed – SQL cannot look into them). The thread line
  says „a sticker … over the area x %, y %, w %, h %“ (`markText`): the AI's pictures never show
  comment marks, so without it „hier“ meant nothing. Tested with the real model 2026-11-03: „Mach
  hier mal 2 Kreise hin“ → two circles inside the sticker's area. The AI's own sticker is
  `add_comment` + `sticker` (`stickerStroke`: ≥ 4 cm wide, font 0.03 of the slide height); with
  „only when it helps more than your reply“ it never stuck one, with „what people must notice on
  the slide, a placeholder you put in“ it did, beside the placeholder. Its notes post only if
  the run's change goes through.

## Voice („Sprechen“, `services/voice/`)

- Double click on the split handle starts speaking; the stop button is „Senden“ (mic off,
  everything said still processed). The AI avatar click filters like any avatar; speaking is in
  its right-click menu. Handle ends stick out beside any bar in the handle slot (`useBarBeside`).
- Browser: Silero VAD (`@ricky0123/vad-web` + onnxruntime-web, own `Segmenter`) cuts at pauses →
  16 kHz WAV per piece + screen context → `POST /api/voice/:id/segments`. Server (in-memory
  sessions): speech key → router (`runToolCall`, `claude-haiku-5-5`) →
  new/continue/finish/add_to/drop/undo/go_to_slide/stop → ordinary comments; finished ones go to
  `createProposal`, one after another per slide.
- Keys: kind `voice` („Sprechen mit der KI“) separate from `speech` (recordings) –
  `workspaceVoiceConnection` falls back to `speech`. User wants memos on self-hosted Whisper,
  live voice on Mistral: keep them separate. Kind `live` („Live-Mitschrift“, Mistral only)
  streams VAD frames as PCM16 to `wss://api.mistral.ai/v1/audio/transcriptions/realtime`
  (`POST /api/voice/:id/live` token as subprotocol `['realtime', token]`), caption only.
  Model `voxtral-mini-transcribe-realtime-3`; `target_streaming_delay_ms` 240 → first word
  ~0.8 s (80 gives wrong words). A Mistral voice/speech key is copied once per place into `live`
  (`adoptLiveKey`). Caption = live words, each piece swapped for its accurate `voice` text
  (`lib/caption.ts`).
- Mic start must be instant: the VAD (onnxruntime's 14 MB wasm + Silero) is loaded ahead in
  idle time while speaking is possible (`prepareMicrophone`, `startOnLoad: false`); the click
  asks `getUserMedia` at once and only starts it. The session POST runs side by side – pieces
  and the live token wait for `run.ready`. Measured (Chromium, 50 Mbit): loading at the click
  3.1 s to the first frame, prepared ~50 ms.
- VAD files served by the `vadAssets` plugin in `apps/web/vite.config.ts` under `/vad/`; CSP
  needs `'wasm-unsafe-eval'` and connect-src `wss://api.mistral.ai`.
- Local Whisper costs ~5–10 s per call regardless of length (M4), so waiting pieces are merged
  into one request. Speed complaints → check the speech key first (router ~1 s).
- Plain requests are made at once (`voice/quick-edits.ts`): the router gives `edits` with a
  finished comment (place/box/align_with/size_like, fill, border, text, font size/scale, B/I/U,
  align, order, delete); `applyQuickProposal` applies them as an ordinary proposal of the comment
  (thread, „Rückgängig“, undo/redo all as the AI's) – measured with the soffice pool: applied and
  drawn 0.3–0.5 s after the router, ~2.5–3 s from the end of the sentence (full AI: 20–60 s).
  Anything the edits cannot say, or that does not fit, goes to the full AI as before.
- Haiku is unreliable with coordinates („oben links“ landed over the title, kept y, once took
  links for right): places in words are `place` and lining up is `align_with`/`size_like`, worked
  out on the server (`placed`, `clearOf` – never over others, out of the way only within the
  half asked for, else the AI; `placesAgree` checks the side against the words). It also wraps
  `actions` in another `{actions}` or a JSON string now and then: `readActions` unwraps.
  Re-test the prompt against the real model with a scratch script (`routerPrompt` + SDK, key
  from the main checkout's `.env`) – the e2e fake router proves nothing about quality.
- Requests to the full AI wait only for earlier ones about the same elements (or the whole
  slide) – `enqueue`; others run side by side and merge (`mergeSlide`). Changes made at once
  never wait for the AI. Timing per piece is logged (`Voice …: heard in …, decided in …`).
- With a `live` stream the browser sends each piece's live words (`meta.liveText`, `pieceWords`;
  it waits up to 250 ms when words were still arriving – `settlingMs`): the router decides on
  them at once; speech to text runs after only to make the record accurate (caption, raw words
  for the AI). Without live words the old order holds: heard, then decided.
- Scratch e2e with a fake mic: Chrome `--use-file-for-fake-audio-capture=<wav>` +
  `say -v Anna … [[slnc 2000]]` → `afconvert -f WAVE -d LEI16@48000`.

## AI usage („KI“ on `/instanz`, `services/ai-usage.ts`)

- Every request to an AI service is a row in `ai_usage` (workspace, instance key or own, feature,
  provider, model, tokens incl. prompt cache, audio seconds, pictures). Never content.
- Metering happens in the funnels of `ai-providers.ts` (`runTurn`, `runToolCall`, `transcribe`,
  `generateImage`) through `connection.meter`, which `connectionOf` in `integration-keys.ts`
  attaches for workspace connections. A new AI call must go through a funnel with a workspace
  connection, and say its `feature` where the default is wrong.
- Audio seconds: caller's `durationMs` (recordings), else the WAV header (voice pieces), else
  the service's `usage`. Mistral realtime (live captions) streams from the browser – the server
  must time it itself (token handed out → session ended) and report via the live connection's
  `meter` with `feature: 'live'`.
- No money anywhere (user's call, 2026-11): list prices were guesses, so no `PRICES`, no cost,
  no budgets. The dashboard shows only what is measured – requests, tokens, audio minutes,
  pictures per feature/model/workspace and over time, plus what the AI did (`work`: requests by
  how they ended from `ai_proposals.status`, comments with `author.type = 'ai'`). Groups sort by
  requests (the one unit all services share). The column `cost_usd` was dropped (`0082_ai_usage_no_cost`).

## Local services (dev)

- Speech to text: Whisper large-v3-turbo (faster-whisper) from `deploy/stt` via the uvx command
  in `.env.example`, `--port 7002`, `WHISPER_MODELS=./models` (gitignored, ~1.6 GB). Port 7001
  is rembg. No Docker on the dev Mac. Transcripts "pending" → check something listens on 7002.
- `SPEECH_URL`/`SPEECH_MODEL` are taken over once as an instance key, provider `self-hosted`
  („Selbst gehostet“), editable under Einrichtung → Integrationen; workspaces see it as „Auf dem
  Instanz-Server“. Instance self-hosted keys may use internal addresses without
  `AI_ALLOW_INTERNAL_URLS`. Recordings get `media.transcript` in the background
  (`services/transcripts.ts`), resumed on API start.
- Bun's TypeScript transpiler reads a statement starting with `declare(` as an ambient
  declaration and drops it (tested 2026-11-02, Bun 1.3.14): never name a function `declare` – the
  odp namespace fix-up silently never ran (seen in the odp `bun test` run: blank and fills
  tests).

## Unsplash (`services/stock-photos.ts`, `packages/odp/src/credit.ts`, `editing/photos/`)

Unsplash can revoke the key; production approval needs screenshots of credits.

- Access key server-side only (proxy). All display hotlinks `images.unsplash.com` (CSP
  img-src); only the photo put into the file is fetched, cropped via imgix `w/h/fit=crop` to the
  frame's aspect.
- `download_location` reported exactly once per kept photo: editor pick → at once; AI choice →
  when its thread is marked done or the file leaves Slider (download `/edit/file`, cloud save).
  Never on AI pick or per click.
- Credit „Foto von X auf Unsplash“ with utm links (`stockLink`) wherever shown, also in the
  frame's `svg:desc`.
- "Non-automated": AI only on a human request, max 3 searches per run, a person confirms or
  switches (thread shows 3 thumbs). AI photo state in `ai_proposals.changes[].stock` (jsonb).
