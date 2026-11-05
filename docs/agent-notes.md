# Agent notes – tested facts the code does not show

Each fact was measured (LibreOffice 26.8, macOS); don't build around it without a new measurement.
Rules: [`CLAUDE.md`](../CLAUDE.md); invariants: [`do-not-break.md`](do-not-break.md).

## LibreOffice

### Pool and rendering

- Editor drawings use a pool of running LibreOffices (`LIBREOFFICE_WORKERS`, default 2); uploads
  and imports use one `soffice` each (isolation from untrusted files).
- macOS kills LibreOffice's bundled Python started alone („Launch Constraint Violation“), so
  `office-worker.py` runs _inside_ soffice as a user-profile script over a Unix socket. Docker needs
  `libreoffice-script-provider-python`. `DisableMacrosExecution=true` blocks that script too: the
  pool profile sets it false and relies on pruned drawing copies, no `MacroExecutionMode` on load,
  security level 3.
- One running LibreOffice = one profile: per-deck font replacements go into the drawing copy
  (`replaceFonts`), not the profile.
- The PDF always paints the page white: transparency needs each layer drawn on white _and_ black,
  then matted.
- `--convert-to png` drops blur, soft edge and glow; Slider renders via PDF, which has them.
- Bitmap fills (`style:repeat="stretch"`) stretch over the shape's **upright bounds on the slide**:
  not turned with a turned shape, not mirrored with a mirrored one. LibreOffice geometry: tight
  bounds (quarter pie = its quarter); PowerPoint presets (`ooxml-*`): the turned box.
- A turned shape's gradient lies over its upright bounds, not turned with it.

### Styles and text

- `style:parent-style-name` naming an **automatic** style is ignored in every family (graphic even
  draws garbage); only common styles (styles.xml) work as parents → fold them in
  (`inheritAutomaticParents`).
- Font never comes from `style:default-style`. No parent style → file's common „standard“, else
  LO's own (Liberation Sans 18 pt, padding 0.125/0.25 cm, filled). A „standard“ with only a font
  drops that padding, so blank decks' „standard“ carries padding too. Decks started blank
  2026-10-28…11-01 have none → Liberation Sans (`standardUnder` mirrors this).
- `style:font-name` in content.xml resolves only against content.xml's `font-face-decls`;
  undeclared = ignored (blank decks declare Inter in styles.xml only).
- Default text padding: 0.125/0.25 cm frames and shapes, **0 for presentation placeholders**.
- A picture frame with `presentation:placeholder="true"` is empty to LO: its `draw:image` is not
  drawn. Template picture placeholders land on slides unmarked.
- LO binds a master's presentation styles by the master's **display name**
  (`<display-name>-title`), not `style:name`. A property left out of the style takes LO's default
  (blue fill, line). LO ignores text properties of an automatic presentation style.
- Effects: `draw:shadow` + offsets, `loext:shadow-blur`, `loext:softedge-radius` (shrinks inward),
  `loext:glow-*`. An undeclared `loext:` prefix is silently ignored (`declareLoext`;
  `authoredProblems` must declare it too, else „Unknown namespace“). No backdrop blur in LO
  (Slider bakes it).
- Unfilled box: its shape shadow is cast by the letters; filled box casts it itself.
  `loext:opacity` on text = letter opacity; `0%` in default styles means „not set“ → write ≥ 1 %.
  Not drawn on letters: `loext:glow-text-*`, `fo:text-shadow`, `style:text-outline`. Gradient in
  letters only as Fontwork (not built).
- Text layout: Impress lays out on a 600 dpi device (font height in 1/100 mm → whole pixels;
  hhea ascent/descent each rounded). Chromium rounds ascent/descent to whole CSS px, half-leading
  down. Editor mirrors both (`layoutSize`, `lineBox`, `baselineShift` in `live/css.ts`).
- Kerning only where `style:letter-kerning="true"`; files saying nothing are not kerned (CSS
  `font-kerning: none`).
- Turned text in LO's PDF is ~0.9 px off across the baseline (open; ~2.4 % in parity).
- `draw:auto-grow-height="true"` → drawn `max(svg:height, text)`; `fo:min-height` is ignored.
- A shape's text wraps in the first rect of `draw:text-areas`, not its box (`textAreaInset`).
- „Sperren“ = `style:protect="position size"`; only `position` counts as locked (files carry
  `size` on self-sized frames). PPTX export loses the lock.

### Fonts

- Local LibreOffice has no Google fonts: `fontconfigEnv` points every soffice at `fonts/google`
  with a shared cache dir (`$TMPDIR/slider-fontconfig`; without it +0.7 s per run). Image runs
  `fc-cache`.
- Fonts neither side has are mapped by kind to Liberation Sans/Serif/Mono (`officeFontFor`), else
  macOS LO falls back to serif.
- LO embeds fonts in **content.xml** (all named, even Asian defaults) and draws them even when the
  replacement table names the family. PPTX `.fntdata` is ignored when drawing.
- Test font features with a real LibreOffice-made ODP (`EmbedFonts` in settings.xml).

### Gradients and colours

- PDF export draws every gradient as flat bands (≤ 128); `draw:gradient-step-count` changes
  nothing – don't try LO settings again; `deband.ts` fixes it after.
- WebP: q100 = lossless with napi-rs (3.7 MB) → stay at q90.
- See-through stops: `draw:opacity` with `loext:opacity-stop`, via `draw:opacity-name`; LO runs
  colour and opacity apart (not premultiplied) → the editor paints pixel by pixel.
- A slide background is never see-through: opacity on drawing-page properties ignored, alpha PNG
  drawn over white → composite picture.
- Theme refs (`loext:fill-complex-color` etc.) sit next to a fixed hex; LO draws the hex only, refs
  without hex use LO's default theme, `.uno:ChangeTheme` does nothing headless → Slider rewrites
  every hex itself. Open: several themes per template, theme refs in the ODP, palettes from
  uploaded templates.
- Snap lines (`SnapLinesDrawing`) are file-wide; per-layout guides live as `slider:guides` on each
  master page.

### Parity on a real deck

Decrypt the deck's blob (`EncryptedBlobStorage` + `.data/data-key`), then from `apps/web`:
`bun --tsconfig-override=tsconfig.app.json scripts/live-parity.ts <deck.odp> <out>`.

## Bun

- Bun's transpiler treats a statement starting with `declare(` as ambient and drops it – never
  name a function `declare` (seen silently skipped, Bun 1.3.14).

## AI (`ai-context.ts`, `ai-proposals.ts`)

- Ugly AI slides were a context problem: improve via the brief, the layout check or tools, not a
  longer system prompt; cost is no object. No forced extra review turn (10-min run limit,
  FakeAnthropic scripts every turn).
- Anthropic 400s many-image requests if any side > 3000 px → `fitPictures` shrinks to ≤ 2560 px
  once (same bytes every turn for the prompt cache).
- `ANTHROPIC_API_KEY` is taken over on the first AI request (`effectiveKey`): `deck.ai.available`
  is false until then.
- Speed: read the `AI <id> turn n: …` / `done in …` logs before guessing. Fast mode doubles price;
  429/refusal → standard. Per-turn effort message needs a user turn (`TURN_EFFORT_MODELS`).
- Quick path: ⌘↵ and voice go to Haiku first (`quick-requests.ts`, `quickPlan`). Haiku traps:
  answers `edits: []` when the array has `maxItems`; bad with coordinates (use `place`,
  `align_with`, `size_like`, worked out server-side); wraps `actions` twice (`readActions`); puts
  `text_color` on the slide; never ask it about several slides (`aboutSeveralSlides`). An empty
  `outline` placeholder filled by `setText` shows no bullets → `setRichText` list. Re-test prompt
  changes against the real model with a scratch script – fakes prove nothing about quality.
- A run's deck copy is _not_ refreshed between turns (stale XML would overwrite others); it is told
  what changed meanwhile (`ai-meanwhile.ts`).
- Run `progress` and creation `step` are in-process only (another API instance shows `null`).
- AI pictures never show comment marks → stickers are described by area (`markText`).

## Material board (Folie 0)

- Not in the ODP: `deck_materials`, `deck_board_items`, `material_chunks`; bytes under
  `decks/<id>/materials/`. Files only via tus (`purpose material`), client id makes retries
  idempotent. Files > 150 MB are not read.
- SheetJS 0.20.3 pinned as the CDN tarball (npm `xlsx` is stale); no formulas run.
- No `tsvector`: content is encrypted at rest, so search decrypts and ranks in the server.
- Offline board outbox (IndexedDB store `board`, DB v3); files are not queued. Server-taken
  actions stay laid over the board until a later fetch (`taken`/`forget`) – else a drop jumps back.
- React Flow (`@xyflow/react` 12.12.0): drag frames must be `flushSync`ed; grid 1 unit; never
  `zoomIn`/`zoomOut` (use `zoomBy`); give every node its size and `measured`, and measure free text
  off-screen – otherwise „ResizeObserver loop completed with undelivered notifications“. Its own
  delete/arrow keys are off (it listens page-wide). Non-interactive nodes get
  `pointer-events: none` → their cards need `pointer-events-auto`.
- Material upload completions use unique blob keys and a per-material transaction lock.
  A completed request can be retried after tus cleanup; only a losing attempt's own blob is deleted.
- Folder upload: server appends to `bound_ids` with jsonb `||` (no read-modify-write race).
- Live words arrive as word parts: join where the previous part left off, outside the state
  updater (strict mode runs it twice → „Präs entation“).
- Deck creation: limit 45 min, 3 M tokens; waits ≤ 3 min for files still being read.
- Open / later: cards opened in place (PDF, sheet on the board); drawing, arrows, groups on the
  board; material linked from OneDrive/Google Drive/Nextcloud instead of uploaded; Folie 0 in
  templates.

## Voice (`services/voice/`)

- Keys: kind `voice` separate from `speech` (falls back to it); user wants memos on self-hosted
  Whisper, live voice on Mistral – keep separate. Kind `live`: Mistral realtime
  (`voxtral-mini-transcribe-realtime-3`, `target_streaming_delay_ms` 240; 80 gives wrong words),
  token as subprotocol `['realtime', token]`.
- VAD (onnxruntime 14 MB wasm + Silero) is preloaded in idle time; the click must call
  `getUserMedia` at once. Served by the `vadAssets` Vite plugin under `/vad/`; CSP needs
  `'wasm-unsafe-eval'` and connect-src `wss://api.mistral.ai`.
- Local Whisper costs ~5–10 s per call regardless of length → pieces are merged. Speed complaints:
  check the speech key first.
- Fake mic in scratch e2e: Chrome `--use-file-for-fake-audio-capture=<wav>`; make it with
  `say -v Anna … [[slnc 2000]]` → `afconvert -f WAVE -d LEI16@48000`.

## AI usage metering

- Every AI request is a row in `ai_usage` (never content), metered in the `ai-providers.ts` funnels
  via `connection.meter`. A new AI call must go through a funnel with a workspace connection and
  set its `feature`. Mistral realtime streams from the browser → the server times it itself.
- No money anywhere (user's call): no prices, costs or budgets.
- Deck creation meters text calls and generated images as `create` (tokens/requests/images).
  Stock searches carry the previous slides' chosen photo IDs into the next slide's brief.

## Local services (dev)

- Whisper (faster-whisper large-v3-turbo) from `deploy/stt` via the uvx command in `.env.example`,
  port 7002, `WHISPER_MODELS=./models` (~1.6 GB, gitignored). Port 7001 = rembg. No Docker on the
  dev Mac. Transcripts stuck „pending“ → check 7002 listens.
- `SPEECH_URL`/`SPEECH_MODEL` are taken over once as an instance key (provider `self-hosted`);
  instance self-hosted keys may use internal addresses without `AI_ALLOW_INTERNAL_URLS`.
- Never print values from `.env`. Scratch scripts take keys from the main checkout's `.env`.
- Secret scan: `bun run security:secrets`; a new checkout needs Gitleaks and
  `git config --local core.hooksPath .githooks` (the pre-push hook blocks without Gitleaks).

## Unsplash (`services/stock-photos.ts`, `packages/odp/src/credit.ts`)

Unsplash can revoke the key; production approval needs screenshots of credits.

- Access key server-side only; all display hotlinks `images.unsplash.com`; only the photo put into
  the file is fetched (imgix crop to the frame's aspect).
- `download_location` exactly once per kept photo: editor pick → at once; AI choice → when its
  thread is done or the file leaves Slider. Never on AI pick or per click.
- Credit „Foto von X auf Unsplash“ with utm links (`stockLink`) wherever shown, also `svg:desc`.
- Non-automated: AI only on a human request, ≤ 3 searches per run, a person confirms.

## Presenting

- Completed runs (slide times plus optional recording) are stored in `show_runs`, newest five
  per deck. Recordings use `decks/<id>/runs/` in the encrypted blob store, count as deck storage
  and go with the deck. Ending before the end screen or closing the tab discards the run.
- Run thumbnails get fresh signatures on read; existing slides use their current render.
- The canvas recorder loads slide pictures with `crossOrigin = anonymous` before setting `src`;
  API pictures are on another origin in dev, otherwise `captureStream` throws on a tainted canvas.
