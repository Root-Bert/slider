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
- Bullets: of `• – — · › » * + > -` every font in `fonts/google` has a glyph; `○ ■ ◆ → ✓ ★` are
  missing in 58–98 % of them and only Inter has all – so a picked shape names Inter on its list
  level (`listBulletFont`), else browser and LibreOffice fall back differently. `setRichText`
  names a line's bullet (`list.char` / `list.number`) unless `bullet.assumed`; one the text's
  lists don't draw is written as a copy of that list style with the level changed.

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
- Chrome blends see-through layers in the screen's colour space (Display P3 on Macs), LibreOffice
  in sRGB: a 70 % purple over a photo came out ~4–14 levels off. Headless parity (sRGB) can't see
  it; check with `--force-color-profile=display-p3-d65`. So Bearbeiten lays LibreOffice's slide
  without elements over the browser's ground once settled (`SlideCompositor` `settledGround`).
- A slide background is never see-through: opacity on drawing-page properties ignored, alpha PNG
  drawn over white → composite picture.
- Theme refs (`loext:fill-complex-color` etc.) sit next to a fixed hex; LO draws the hex only, refs
  without hex use LO's default theme, `.uno:ChangeTheme` does nothing headless → Slider rewrites
  every hex itself. Open: several themes per template, theme refs in the ODP. Uploaded templates
  bring their theme's ten colours (PowerPoint `clrScheme`, LibreOffice `loext:theme`).
- Snap lines (`SnapLinesDrawing`) are file-wide; per-layout guides live as `slider:guides` on each
  master page.

### Parity on a real deck

Decrypt the deck's blob (`EncryptedBlobStorage` + `.data/data-key`), then from `apps/web`:
`bun --tsconfig-override=tsconfig.app.json scripts/live-parity.ts <deck.odp> <out>`.

## Template library (`packages/templates`)

- Specs in `src/templates/<slug>.ts` → `bun src/build.ts [slug …]` (script `library`, on purpose not
  `build`: the root `bun run build` and CI have no LibreOffice and must not rewrite it) writes
  `library/<slug>.otp`,
  `library/index.json` and `previews/<slug>.jpg` (drawn by the real LibreOffice). Rules and every
  measured LibreOffice behaviour: `packages/templates/AUTHORING.md`. Look at the preview after
  every build – text fit is only visible there.
- The API offers that folder as Slider's own templates (`services/slider-templates.ts`,
  `GET /api/slider-templates`, „Folie einfügen“ → Slider): files only, nothing in the database,
  read again when `index.json` changes; `SLIDER_TEMPLATES_DIR` points elsewhere. An `addSlide`
  names one as `design.id` = `slider:<slug>`. The library's „Vorlagen“ lists them under the
  workspace's own (`SliderTemplateCollection`); `POST /decks/blank` takes the same id as
  `masterId` (the deck's `master_id` stays null – no row to point at). No folder → the tab says there are none.
- All templates share the nine layout names, so anything matching a deck to its template by
  layout names (`linkDeckMaster`) cannot tell them apart.

## Migrations

- Drizzle applies only migrations whose journal `when` is greater than the last applied one.
  Hand-written entries use future day steps (0130 = 1796040000000, +86400000 each); a generated
  entry gets the real clock and lands *before* them – tests (fresh DB) pass, existing databases
  silently skip it (0132/0133 did). After `drizzle-kit generate`, set `when` = previous + 86400000.
- The dev API (`bun --watch`) does not restart on `touch`; change a file's content. Check what an
  existing DB has: copy `apps/api/.data/db` to scratch, open the copy with PGlite (never the live one).

## Shared checkout

- Commit with paths: `git commit -m … -- <your files>` (or `--only`). A bare `git commit` after
  `git add` takes whatever another agent staged too (a rename slipped into a foreign commit so).
- Waiting for others' checks: `pgrep -f "vitest|tsc --noEmit|playwright"` also matches shells
  whose command quotes those words (your own wait loop, another agent's multi-line command) and
  never ends. Match only node/bun processes:
  `ps -axo comm=,args= | awk '$1 ~ /(^|\/)(node|bun)$/ && /vitest|tsc --noEmit|playwright/'`.

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
- Quick path: ⌘↵ and voice go to the key's quick model first („Schnelle Aufträge“, `quickModelOf`;
  unset: Haiku on Anthropic, else the key's model) (`quick-requests.ts`, `quickPlan`). Haiku traps:
  answers `edits: []` when the array has `maxItems`; bad with coordinates (use `place`,
  `align_with`, `size_like`, worked out server-side); wraps `actions` twice (`readActions`); puts
  `text_color` on the slide; never ask it about several slides (`aboutSeveralSlides`). An empty
  `outline` placeholder filled by `setText` shows no bullets → `setRichText` list. Re-test prompt
  changes against the real model with a scratch script – fakes prove nothing about quality.
- A run's deck copy is _not_ refreshed between turns (stale XML would overwrite others); it is told
  what changed meanwhile (`ai-meanwhile.ts`).
- Run `progress` and creation `step` are in-process only (another API instance shows `null`).
- A run's answer is the AI's last words – after the „Check the drawing“ turn, so that message must
  ask for the whole answer again, else the people read only the correction („das Bild fehlte
  noch“) or „nichts mehr geändert“; on a variant: no slide numbers (its copy counts differently).
- AI pictures never show comment marks → stickers are described by area (`markText`).
- Black Forest Labs (`generateImage`): `get_result` answers `Pending`, `Reasoning`, `Generating`
  before `Ready` (FLUX 3; enum in `api.bfl.ai/openapi.json`) – only `Error`, `Task not found`, `No
  Card Generated` and the two moderated ones end a task. Our own 502s show to the person as „X ist
  gerade überlastet“ (`failureMessage`), so the real cause is hidden: probe the poll and the
  `delivery.*.bfl.ai` fetch yourself (both free; the POST costs). Polls are pinned to the IP.

## Material page

- A page of its own beside the presentation, not in the track (`board/MaterialPage.tsx`): the
  store's `materialOpen` (`?material`, a new deck via `OPEN_ON_BOARD`); the presentation root
  slides out right (`translate`, `inert`), the page in from the left; the fullscreen target wraps
  both. The minimap's paperclip tile (left of the thumbnails, the bracket never on it) and M open
  it; „Präsentation →“ / M go back. Viewer and editor keys sleep there (`keysActive`), the board
  panel portals into `[data-material-page]` and is no longer one of the deck's side panels.
- The same board beside a text document (Writer): everything in `board/` reads its host from
  `BoardOwnerContext` (`board/board-owner.tsx`: kind `deck`/`document`, id, rights, author, AI,
  toast, the page's and its panel's open flags, wording) – never the viewer's stores. The deck's
  host is `components/DeckBoardOwner.tsx` (round `MaterialPage` and `AiChatPanel`), the document's
  `writer/editor/DocumentMaterial.tsx` (`Editor` holds `materialOpen`, moves `[data-writer-root]`
  out and makes it inert; M, the tile above the page strip, `?material`). Routes, query keys and
  the tus target by owner: `lib/api/board-owner.ts` (`boardPath`, `boardKeys` – a deck's keys are
  `queryKeys.board` etc. as ever, a document's `['document-material', id, …]`). Outbox entries
  keep the owner's id in `deckId`; a document's carry `kind: 'document'`, none means a deck. A
  document hears `{ type: 'board' }` on its live stream and refetches board and questions.
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
  board; material linked from Nextcloud (picking one copies its bytes today); material in
  templates.

## KI-Apps over MCP (`services/mcp.ts`, `services/app-connections.ts`)

- One catalogue for agents and apps – keep them level when a feature comes: apps get
  `APP_TOOLS` (`mcp-cloud.ts`: Slider's, Cloud's, Writer's, to-dos, and `PERSON_TOOLS` – Sender's
  conversations posted under the person's name, their mail as the agents' `MAIL_TOOLS` (drafts,
  nothing sent), their agents (`list_agents`, `read_agent`, `message_agent`), their settings –
  read only: `change_settings` is the agents' alone, an app never changes them).
  Cloud agents take Slider's by name (`FROM_MCP`), Cloud's file details, sharing, deleted and
  areas from `APP_TOOLS` (`FROM_APPS`, run through `runAppTool` with the agent's workspace), and
  the same settings. `ASKED_ONLY` (sharing, deleted, an area's people, settings) and mail run only
  in the person's own private agent on their message (`mailHere`), never shared or unattended.
- The Cloud panel's AI (`cloud-chat.ts`) and the start's (`home-chat.ts`) take the rest from the same catalogue: `MORE_FROM_APPS`
  (mail, to-dos, Sender, agents, documents, board, sharing, deleted, areas, `read_settings`),
  through `runAppTool` held to its workspace, imported lazily (`mcp-cloud` imports `cloud-chat`).
  Who only looks gets the reading ones. A new app tool that fits the panel goes into that list.
- `Waiting.foreign`: words sent as the person that are not theirs – a to-do's order
  (`sendAgentOnTodo`; area members write to-dos, mails bring them) and an app's `message_agent`.
  Such a run works, but without mail, connections and `ASKED_ONLY`, for the whole run. Slide
  comments (`IN_THEIR_NAME`) go under the person's name: never in a run a watch or repeat started.
- Agent titles on to-dos: only who sees the agent (`seesAgent`) reads its title, others „Agent“
  – a private agent's title comes from its private order. `todoByRef` keeps to the caller's
  workspace (an id from another is „No to-do“); a to-do's `source` is the writer's own mail
  thread, its url https only.
- Settings (`services/agent-settings.ts`): only what the server keeps – name, colour (comments
  follow), call voice, mail check interval; mailbox settings are `update_mailbox`, an area's
  `update_area`. Look, notifications, how things open live in the browser – the tool says so.
- `cloud-agents` takes `APP_TOOLS` lazily (`allTools()`), and names `ASKED_ONLY` literally:
  `todos`/`call-records` → `cloud-agents` → `mcp-cloud`/`agent-settings` is a cycle, so nothing
  of those may be read while the module loads.
- `/api/mcp`: `@modelcontextprotocol/sdk` 1.32.1 (apps/api), low-level `Server` +
  `WebStandardStreamableHTTPServerTransport`, stateless with JSON answers, a new server per request
  (no `initialize` needed before `tools/call`). A bearer token only – the session cookie is never
  read there; open CORS for it, `/api/oauth/token|register` and `/.well-known/*` (`OPEN_PATHS`),
  `sameOriginWrites` skips them; on the desktop `desktopGuard` lets a bearer through on that path.
- OAuth 2.1, PKCE S256 only, dynamic registration and https client ids (metadata document,
  fetched via `safeFetch`); loopback redirects match on any port. Codes 5 min, single use – a
  wrong verifier spends the code too. Access `slider_at_` 1 h, refresh `slider_rt_` rotates (old
  one dead) and dies after 180 days unused, tokens from /konto `slider_pat_` never expire. Only
  SHA-256 hashes are stored; „Entfernen“ ends access at once.
- The connector's icon: before connecting, the app only has the site (`/api/mcp` is 401 without a
  token) – `/favicon.ico` (light mark, PNG inside, made from `favicon.svg`; renderers outside
  browsers ignore its `<style>`) is what such fetchers find; once connected, `serverInfo.icons`
  (`favicon.svg`, `icon-192.png`, absolute on `webOrigin`). Since 2026-11-22 `index.html` names
  Cloud's icons (the start page's app), no longer the `.ico` – a fetcher reading the page's links
  finds Cloud's SVG, one asking for `/favicon.ico` still Slider's.
- Discovery lives at the origin's root (`/.well-known/oauth-protected-resource/api/mcp`,
  `oauth-authorization-server`, `openid-configuration`); issuer = `webOrigin`. Vite proxies
  `/.well-known` in dev; a reverse proxy in front of the API must pass it too. Desktop: no OAuth
  (404) – nothing outside can sign in to the local server; tokens only.
- A connection held to a workspace: `accessOf` drops the other roles, `findDeck` checks the deck's
  workspace – every tool goes through them.
- `search` + `fetch` exist for ChatGPT (deep research / company knowledge need exactly that pair):
  JSON in a text block, ids `presentation:` / `file:` / `note:`. Slide and comment text via
  `searchDecks` for the phrase and each word apart (it matches phrases only).
- `edit_slides` = a comment on the slide + `createProposal`, as ⌘↵ in a thread; `editTarget` is
  checked first so a refusal (not ODP, no LibreOffice, still being read) leaves no comment. Waits
  ≤ 2 min. `create_presentation` waits ≤ 30 s for the blank deck to be read, build/edit ≤ 90 s.
- Managing over MCP goes through the page's own services: `resolve_comment` = `updateComment`
  status (on the thread's root), `undo_edit` = `revertProposal`/`reapplyProposal` (ids as
  `edit …` in `list_comments`), `update_presentation` = `updateDeck` (title, archived – no folder:
  `deck_folders` are shown nowhere), `set_access` = `updateDeckAccess` (people by name, address or id),
  `download_presentation` = `exportedFile` (ODP decks only, as on the page; attached as an MCP
  `resource` ≤ 10 MB plus the `/api/…/edit/…` link; PDFs share `aiLimits().pdfs` with the page).
  Templates being designed are refused by the manage tools.
- Files over MCP (`mcp-cloud.ts`, what the route serves: `APP_TOOLS`/`runAppTool`): the Cloud
  chat's own tools (`cloud-chat.ts` `runTool`, same refusals) under app names (`move_files` =
  `move`, `rename_file`, `delete_files`) plus `write_file` (text only, `keepBoth`); `workspace`
  picks one. `mcp.ts` must not import `cloud-chat.ts` (cycle) – `MCP_TOOLS` stays presentations
  only, for the chats that pick from it. A presentation is moved by its own id everywhere
  (`deck-places.ts` `fileIdsToMove`: its file, placed in its owner's own files first when it
  has none).
- Areas, sharing, „Gelöscht“, versions and Writer over MCP (`mcp-cloud.ts` `MORE_TOOLS` /
  `runMore`): these call the services straight (`createArea`, `createShare`, `restoreNodes`,
  `restoreVersion`, `documents.ts`), so the route's follow-ups are theirs to do too –
  `followArea`, `followShares`, `followMoved`, or a presentation's access stays as it was. Ids
  come from the app: every tool checks the thing's workspace against the connection's (`within`)
  before it acts. `edit_document` goes the AI's way (`planChanges` → `editDocument` `apart`) and
  needs the one `DocumentLive` of `app.ts`, handed to both `documentsRoutes` and
  `appConnectionsRoutes` – a second instance writes, but open editors hear nothing. Not there on
  purpose: links for people outside, deleting an area, emptying „Gelöscht“, comments in a
  document, tables and pictures in one, importing Word files.
- Sticker size for notes: measured 20 px lines, ~40 characters a line (36 in lists) at width 360.
- Tried with a real Claude loop (scratch e2e, key from `.env`): it finds decks by title, uses
  search → fetch → `add_note` with `attach_to`, and relays refusals in plain words.

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
- Mistral `context_bias` takes single words only (a space or comma → 400 for the whole request):
  `transcribe` splits terms into words.
- A new value in `.env` (e.g. `MISTRAL_API_KEY`) replaces the instance key the environment named
  before, active where it was; the `live` key taken over from it follows (`importEnvKeys`).
- Fake mic in scratch e2e: Chrome `--use-file-for-fake-audio-capture=<wav>`; make it with
  `say -v Anna … [[slnc 2000]]` → `afconvert -f WAVE -d LEI16@48000`.
- Media with sound plays in e2e only with `--disable-audio-output` (null sink): on the speakers a
  locked Mac's CoreAudio output stalls after a while – `play()` resolves, `currentTime` stays 0
  (`afplay` of 1 s silence hangs too), video without sound runs on.

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
- Secret scan: `bun run security:secrets`; a new checkout needs Gitleaks, and `bun install`
  (`prepare`) sets `core.hooksPath .githooks` – without it the pre-push hook never ran here and a
  test's fake TURN secret reached GitHub before the Secrets workflow flagged it (blocks without Gitleaks).

## Unsplash (`services/stock-photos.ts`, `packages/odp/src/credit.ts`)

Unsplash can revoke the key; production approval needs screenshots of credits.

- Access key server-side only; all display hotlinks `images.unsplash.com`; only the photo put into
  the file is fetched (imgix crop to the frame's aspect).
- `download_location` exactly once per kept photo: editor pick → at once; AI choice → when its
  thread is done or the file leaves Slider. Never on AI pick or per click.
- Credit „Foto von X auf Unsplash“ with utm links (`stockLink`) wherever shown, also `svg:desc`.
- Non-automated: AI only on a human request, ≤ 3 searches per run, a person confirms.
- Writer: a picked photo's credit rides on `WriterPicture.credit` into the .odt's frame
  (`svg:desc`, odp's `writeCredit` / `readCredit`) and shows in the picked picture's panel.

## Presenting

- Completed runs (slide times plus optional recording) are stored in `show_runs`, newest five
  per deck. Recordings use `decks/<id>/runs/` in the encrypted blob store, count as deck storage
  and go with the deck. Ending before the end screen or closing the tab discards the run.
- Run thumbnails get fresh signatures on read; existing slides use their current render.
- The canvas recorder loads slide pictures with `crossOrigin = anonymous` before setting `src`;
  API pictures are on another origin in dev, otherwise `captureStream` throws on a tainted canvas.

## Comments

- The reaction picker in a scrolling panel (`ReactionPicker floating`) is a `popover="manual"` in
  the top layer, tied to its line by CSS anchor positioning – a scroller cuts off anything else.
  In the top layer `:hover` / `:focus-within` on it do **not** count for its DOM ancestors
  (`group-hover/message` goes off under the pointer): it holds itself open with its own
  `hover:` / `focus-within:`.
- Reactions to the AI's answers live in `ai_proposal_reactions` (`services/proposal-reactions.ts`),
  attached in the route, not in `toDto` – other proposal answers come without `reactions`.
- The mention field and text (`MentionTextarea`, `useMentions`, `CommentBody`) read their people
  from `useMentionPeople()`: a `MentionPeopleContext` if one is given (Writer's `Editor`: workspace
  people + thread authors), else the deck's `ViewerDataContext`. Writer imports them, the reply
  drafts and `PhotoGrid` / `ImagePrompt` only via `@/features/viewer` (lint rule).

## Spelling (`features/viewer/spelling/`)

- The browser's spell check (`spellCheck` on a field) marks only the field being typed in and tells
  the page nothing → the guides view has its own: Hunspell as WebAssembly (`hunspell-asm`) with
  `dictionary-de` + `dictionary-en`, a word right when either knows it. Loaded when the view is
  first shown (88 ms in Chrome, dev).
- `nspell` (plain JS) does not know German compounds („Tippfehler“, „Hilfslinie“ wrong) – measured.
- `hunspell-asm`'s ES build cannot be bundled („runtimeModule is not a function“: namespace
  imports called as functions) → its `dist/cjs` entry is loaded. The same pattern left in
  `emscripten-wasm-loader`'s `mountBuffer` only runs without a file name: always pass one.
- `dictionary-de` is GPL-2.0/3.0: served unchanged as its own files under `/spell/` with its
  licence beside it (`spellAssets` in `vite.config.ts`), never bundled into the code.
- The slide is a picture: a misspelt word is underlined where it stands only when the deck's live
  texts are there (`editing.available`) – laid out unseen as Bearbeiten draws them, the words'
  ranges measured (`MisspeltWords`). Else (no ODP, turned text) its box is marked and the words
  named. Right click on a word: three of Hunspell's suggestions (both dictionaries, nearest first) –
  a pick is a `setRichText` (`fixWord`, the word found again by its occurrence in the text) – and
  the word itself („…“) to keep it (`accepted-words.ts`): into the account's dictionary
  (`/me/words`) and the deck's workspace's (`/workspaces/:id/words`; reviewers add, members
  delete) – both under „Wörter“ in the Bibliothek, picked at the toolbar's right („Workspace-Wörter“,
  „Eigene Wörter“, `?filter=eigene-woerter`); the account menu has no entry of its own (the
  user's call 2026-11-18). It waits in
  `localStorage` (`slider.spelling.accepted`) until the server has it – offline, signed out; plain
  strings there are words from before and go to the account only.

## Cloud – the workspace's files (`services/cloud/`, `features/cloud/`)

- The name (the user, 2026-11-17): the files app is „Cloud“ everywhere – app, API, desktop, docs.
  „Office“ is the family's name over all the apps – on the website (`apps/site`, `/office/`) and,
  since 2026-11-22 (the user), in the app wherever the software, the instance or the account is
  meant: „Office einrichten“, „diese Office-Instanz“, „wer Office betreibt“, „bei Office
  anmelden“, „dein Konto“ (never „Slider-Konto“), the privacy template, the passkey's RP name,
  Nextcloud's app password (`DEVICE_NAME`), the OAuth client name towards foreign MCP servers.
  „Slider“ stays for presentations, the deck app's own pages and titles, its desktop app and the
  MCP connector with its tools; code identifiers, env vars, packages, docker and the self-hosting
  docs keep „Slider“ as the project's name. System mails (`inviteMail`, `mail/mailer.ts`): without
  `app` the head is the word „Office“ alone (no picture) and the text ends „– Office“; with `app`
  (a presentation's mails – shared deck, sent export, unused deck – are `slider`) the app's mark
  travels inline (`cid:<app>-logo`, PNGs 72 px wide in `mail/logo.ts`, the Cloud/Writer/Reader/
  Sender ones drawn by Chrome from `features/cloud/assets/<app>-mark.svg`) beside its name. The
  From display name is the operator's `MAIL_FROM` (code sets one only for a sent export, „Name
  (über Slider)“). In code „office“ otherwise means LibreOffice or an office file (`officePreviewable`,
  `office-fonts`). Left from before: `/office` still leads to `/cloud` (`router.tsx`, `OLD_START`),
  the usage feature is still `office` (rows in the database).
- Cut shadows and focus rings: every Cloud page's content scrolls in `CloudPage`'s scroll box, and
  a scroll box cuts what reaches past its padding – `shadow-float` (`glass-elevated`, the agents'
  order field, tooltips) reaches 24 px up, 32 px sideways, 40 px down; a focus ring 4 px. The box
  therefore bleeds to the title above (`-mt-5`), the side bar and the layouts' right padding. In a
  smaller scroll or `truncate` box give the ring 4 px (`-m-1 p-1`) or draw it inside
  (`focus-visible:-outline-offset-2`, the side bar's rows); a tooltip at the left edge takes
  `align="start"`. Measured with a scratch e2e that compares each shadow's/outline's reach with
  its clipping ancestors on every page (2026-11-18); the minimap's frame glow and pictures on a
  tile's mat are cut on purpose.
- Areas under areas (`cloud_areas.parent_id`, „Unterbereich“): only where an area is listed –
  its people, visibility and files stay its own, nothing is inherited. Set at creation
  (`cloudAreaCreateSchema`), never changed after (so no cycles); the parent's manager makes them,
  `CLOUD_AREA_MAX_DEPTH` levels at most; an area with areas under it is not deleted („Lösche zuerst
  die Unterbereiche“). `toAreaDtos` answers `parentId: null` when the parent is not the caller's to
  see, so the tree (`areaTree`, `features/cloud/lib/areas.ts` – the side bar, „Bereiche“ and the
  move dialog list by it; `canHaveAreasUnder` says whether „Neuer Unterbereich“ shows) has it at
  the top.
- A list row starts the selection box from anywhere but its picture and name (`data-grip`,
  `lib/marquee-select.ts`): the name's link is stretched over the row, so the grip is told by
  position, not by the event's target. A picked row (`data-selected`) drags as a whole. A row may
  have several grips (a presentation's list row: its picture and its title).
- Views of a place (`CLOUD_VIEWS`, one choice kept for all lists): list – folders are rows too;
  tiles – folders as cards above; columns (`ColumnBrowser`, only on `FilesPage`) – a click on a
  folder shows its content beside (`trail`, lists via `cloudListQuery` + `useQueries`), a double
  click goes there. Lists across folders show „columns“ as the list.
- Toasts (`ui/Toast`, `CloudToast`) lie in the browser's top layer (`useTopLayer`: a manual
  popover, raised anew with every message) – a native `<dialog>` is modal there, and a toast on a
  z layer shows dimmed under its backdrop. A confirm dialog shows its own failure (`error`).
- A move takes the rows out of the folder lists at once (`useMoveCloudNodes`, only keys of scope
  `folder` – „Zuletzt“ keeps its rows); the side bar's „Meine Dateien“, „Gelöscht“, pins and
  areas take drops through one hook (`useRowDrop`).
- Looking at the app from an agent: the desktop app's window stops `requestAnimationFrame` when
  hidden (the selection box then never draws) and is one app only (Präsentationen redirect to
  Cloud). A headless Chrome with the session cookie copied over CDP sees both apps.
- The presentations list changes at once too (`changeLists` in `lib/api/decks.ts`: name, archive,
  delete, bring back). The calls for several (`eachDeck`) never reject – a dialog reads
  `data.failed` and stays open when nothing went through.
- The desktop's file link of a presentation ends when the presentation is deleted
  (`services/local-files.ts` leaves out `deletedAt` ones) – also when it is brought back later.
- The second app of the account, under `/w/:id/dateien…` below the same `WorkspaceLayout` and
  `AppHeader` as Slider (the header's chevron switches – at an app's start the whole logo does; in Cloud the logo is Cloud's).
  Figma: file „Cloud“ (`30AIOgC5Q3JZo8pEBYQLra`), page „Prototyp“ C01–C21. Built of it: Zuletzt,
  Bereich, Details, Teilen, Suche, App-Wechsler, Aktivität, Geteilt, Gelöscht, Speicher,
  Bereiche. Not built (kept in mind): Umzug from another cloud, mobile, notifications („Für dich“). Cloud is the
  workspace's, rights come from role and area alone: `viewer`/`reviewer` look everywhere and have
  no own files (`looksOnly`, `home.ownFiles`), sharing by hand is off unless `CLOUD_SHARING=true`
  (`cloudSharing`, `home.sharing`; the share rows stay as the mirror of a presentation's chosen
  people, „Geteilt“ shows only where some exist, `home.shared`). No guests, and links for people
  outside are off unless `CLOUD_PUBLIC_LINKS=true`
  (`cloudPublicLinks`; `home.links` tells the web, which then shows the link part of „Teilen“).
  A presentation has one file: its Cloud node's version points at Slider's key (`decks/…`,
  `isDeckKey`), follows edits (`followDeckFile`), stands alone when the two part (`standAlone`,
  only when the file is moved into someone else's own files).
  One trash for both apps: `trashDeck`/`restoreDeck`/`deleteDeck` (`services/decks.ts`) carry the
  Cloud node, `trashNodes`/`restoreNodes`/`purgeRow` (`cloud/nodes.ts`) carry the presentation –
  deleted in either it lies in „Gelöscht“ and in Slider's „Papierkorb“, back or gone in both.
- The AI in Cloud works on presentations through Slider's own tools (`mcp.ts` `runMcpTool`, as
  the person, held to the workspace) – never by writing a presentation's file. The chat
  (`cloud-chat.ts` `SLIDER_NAMES`): reading for everyone, `add_comment`/`resolve_comment` from
  `reviewer`, making and changing (`edit_slides`, `build_presentation`, …) from `member`, done at
  once. Agents: the same tools, on the presentations themselves. A listing names a file's
  presentation („presentation ID“). Such a step is told with `app: 'slider'` on the `reading`
  event (`doingIn` on an agent) and shown with Slider's mark (`ChatAnswer`).
- The AI in Cloud: ✨ in the header (`CloudChatButton`, only under `/dateien`) opens `CloudChat`,
  the same `ChatPanel` as the material chat (`features/viewer/board/ChatPanel.tsx`, exported by
  the viewer). Server: `services/cloud-chat.ts` + `routes/cloud-chat.ts` (`POST
/workspaces/:id/cloud/chat`, SSE as the material chat, usage feature `office`). Its tools
  (`list_folder`, `search_files`, `read_file`, `rename`, `create_folder`, `move`, `delete`) call
  the same `services/cloud` functions as the buttons with the person's id – so rights are those
  functions' – and refuse ids of another workspace. Stateless: the page sends the talk so far
  (`history`), kept in a module store per workspace; no table, earlier chats are not kept. The
  lists refetch on each `changed` event. Search is by name only; „find by content“ is the model
  reading candidates. Tested with a scripted model inside the access test of `cloud.test.ts`.
- A big new order in Cloud is two calls, not forty turns (`cloud-chat.ts`): `list_tree` names
  everything below a folder or an area in one answer (`descendantsOf` under a listing that has
  the rights; cut level by level at `MAX_TREE`, `files: false` = folders with counts), and
  `apply_plan` takes the whole order – folders with keys of the model's choosing, `new: <key>`
  puts a later folder or a move into one, then renames – and runs each step through `runTool`
  itself, so every refusal is the single tool's. Checked whole before anything is done; a step
  refused is left out and named, the rest is done (not atomic, as moves by hand are not). Apps
  have both (`list_tree`, `reorganize_files`); agents only the tree – their changes go by the
  desk's own tools. No undo of a whole plan yet. Tested with scripted calls (`cloud.test.ts`,
  `materials.test.ts`), no run with a real model.
- An agent stands in an area (`cloud_agents.area_id`, migration 0121 written by hand) or in none,
  and is its owner's alone or shared (`cloud_agents.shared`): shared in an area means that
  area's people, in none the workspace. `PATCH /cloud/agents/:id` `{shared, areaId?}`, owner
  only, into an area only with `edit` there; `POST …/cloud/agents` takes `areaId` (the new one
  is its owner's). `seesAgent`/`agentFor`: owner always, a shared one by who sees its area (in
  none: the workspace) – 404 to everyone else, admins too. `deleteArea` sets its agents'
  `shared` false first (the FK only nulls `area_id`; left `shared` they would be the
  workspace's). One list from the server (`CloudAgentSummary.areaId`), split in the pages, each
  with the same line – whose (`SegmentedControl`), the order field, tiles or rows: „Agenten“
  shows „Meine“ (all one's own, those in an area named by its dot and name – `showArea` on
  `AgentList`) and „Workspace“; an area's are its second view beside its files under the same
  title – „TestBereich Agenten“, as Slider's „Präsentationen Bibliothek“ (`AreaViews` →
  `ViewTitles` from `WorkspaceViews`, the same morph; `/dateien/bereich/:id/agenten`,
  `AreaAgentsPage` with `AreaAgents`: „Meine“ and „Bereich“; not for the workspace's own or folders).
  `AgentShare` is the menu that picks who sees it: „Nur ich“ (it stays where it stands),
  „Workspace“, the areas one may change – „…“ on a tile, a named button on the agent's page; a
  toast says where it went. An agent out of an area and its owner's alone: no way in the menu
  yet. An area's agent is told its area in its prompt (`home` in `system`) and its crumbs lead
  back to the area's agents. Each has its own picture: our own DiceBear style „Glaze
  Flowers“ (CC0), seeded by its id (`AgentAvatar`, `generatedAgentAvatar`).
- An agent is a shared space with up to 8 chats (`cloud_agent_chats`, migration 0117; the first
  chat's id is the agent's id, its title the agent's). Messages carry `chat_id`, the writer
  (`user_id`) and `from_chat_id` (a note from another chat, `tell_chat`); the AI also has
  `list_chats` and `read_chat`. Each chat runs by itself (`runs` keyed by chat id) with the
  **writer's** rights; members and admins who see the agent write (`canWrite`), others read;
  taking the desk over stays the owner's. Who is there (`here`) and who types (`typing` per chat)
  is in memory only: reading the agent counts as being there (12 s), `POST …/typing` lasts 5 s.
- **No copies, nothing waits** (since 2026-11-18, the user's call): an agent works in the files
  and presentations themselves, at once, beside people and other agents. Its desk
  („Schreibtisch“, `cloud_agent_files`) lists what it did – rows are made `taken` with `undo`
  (jsonb, migration 0120 by hand): `{}` for a new file/folder/presentation or a delete, `{from,to}`
  version ids of a changed file, `{parentId,areaId}` where a moved thing lay, `{proposals}` the
  changes Slider's AI made (`edit_slides`; found as the ids new after the call); a rename's old
  name is the row's `content`. `undo: null` = no way back (`add_note`, `build_presentation`, …).
  `runDeskTool` stages the row and carries it out in one go (`done`); a refusal deletes the row
  and goes to the agent as the tool's error. „Zurücknehmen“ = `PATCH …/files/:id {aside:true}`
  (`takeBack`, owner only), then `discarded`: trash / restore / rename / move back /
  `restoreVersion` – refused when someone wrote a later version (theirs is not thrown away) –
  / `revertProposal` for each still applied, latest first. No redo. Rows `open` are from before
  and keep „Übernehmen“/„Verwerfen“ (`carryOut`); `copy_presentation` is gone (an old agent
  asking is told so). `deleteCloudAgent` never deletes a presentation the agent changed itself
  – only a work copy from before (`original_deck_id` set, no `undo`).
- A file an agent **works on right now** carries `agents: {id,title}[]` on its node (`agentsAt`
  in `services/cloud/nodes.ts`): the agent runs (`runs`/`runsOf`, `services/cloud-agent-runs.ts`
  – in memory, apart from `cloud-agents.ts` so the files can ask) and touched it since that work
  began (`Run.since` against the desk row's `updated_at`; a presentation through `deck_id` →
  `decks.cloud_node_id`). Once it stops the mark is gone (lists ask again every 30 s). Tiles: a
  bar along the picture's lower edge (`AgentsBar`: faces, „Agent arbeitet“ → the agent); rows
  and columns: the face (`AgentsAt`). People are not shown on files.
- The Cloud app's tabs go by place (`tabOf` in `desktop/cloud/main.mjs`): a page that is no
  place closes its tab and loads in the home tab. A second view of a place needs its address in
  that pattern – an area's agents (`…/bereich/<id>/agenten`) are the area's tab; left out, every
  switch between the two closed the tab and drew the page anew (seen as flicker). The installed
  app carries its own `main.mjs` (app.asar): a fix there needs it built and put in again –
  `CLOUD_OUT=<scratch> sh desktop/cloud/pack.sh` (ad hoc, as the installed one), quit the app,
  keep the old one (zip in `desktop/dist`), `ditto` the new to `/Applications`, `open` it; done
  so on 2026-11-18, the drive stayed registered. That the tab now stays no agent has seen (no
  way to look into the app's window); the pattern is checked by hand.
- The agent page has one panel beside the chat: „Schreibtisch“ (icon `desk`) – what it did,
  latest first (`DeskItem`, its name opens the thing itself), then what its answers named and
  is not there already (`FoundItem`, „Gefunden“). Tiles or rows. Both open in a new tab
  (`target="_blank"`, the chat stays; a file where Cloud opens it – `fileHref` in
  `lib/named.ts`: a PDF in Reader, an .odt in Writer, else its details over the files' start).
  The desk is `components/AgentDesk.tsx` (props, no `useCloud`): Sender's `AgentChatPage` shows
  it beside the chat from xl on, its answers' links (`WithNamed` without `onOpen`) go the same
  way (the user's call 2026-11-19); in the desktop apps `setWindowOpenHandler` in `desktop/tabs.mjs` makes that a tab of
  the app where the page has one (`deckIdOf`); in Cloud's app (`app.newTab`) every other page
  gets a free tab as „+“ makes them (`openFree`) – never a window. A `popup` (presenting) and
  `/api/…` stay a window.
- Cloud's app is the whole suite; Slider and Writer as apps of their own are an extra. Who has
  them says per app where its pages open („Apps“ under `/einstellungen`, `AppsSection`, only in
  Cloud's app – `canPlaceApps`; the user's call, 2026-11-19): `tab` (in Cloud, the default, the
  whole app in a tab) or `own` (in the app of its own). Cloud's main keeps it in
  `userData/apps.json` (`cloudDesktop.apps` / `setApp`, `cloud:apps` / `cloud:set-app`, each
  `{ where, installed }`); `installed` asks the system who takes the app's links
  (`getApplicationNameForProtocol`) – without the app its pages open in Cloud whatever was said
  and the row offers no choice. `guest` names only pages of apps that open here; `byItself`
  (`elsewhere` of `createTabWindow`) hands the others over as `<scheme>://open?url=…` (Slider's
  `followLink`, Writer's `takeLink`: shown if it is that app's server, else browser or start
  page). Only Cloud's app sends these links; Slider's and Writer's apps still send foreign pages
  to the browser. Open tabs of an app just set to `own` go there at once (`sortOut`). The arrow
  beside „+“ in Cloud's tab bar (`app.newTabs`, `tabs:newMenu`, a native menu) and „Neuer Tab
  mit …“ in the menu bar start a tab on an app as a whole (`openAt`); they list only apps that
  open here. The browser has no such setting (one moves between the apps there as ever). Seen:
  the section with a stubbed bridge in a scratch e2e, the bar's arrow in the bar page alone; the
  Electron side (menu, `apps.json`, the hand-over, Writer taking the link) only `node --check` –
  not run, and the installed apps (Cloud, Writer) need a repack to have it.
- Cloud's app shows Slider and Writer in its tabs (the user's call, 2026-11-19, over „each app
  by itself“ for this app; Slider's and Writer's own apps still hand foreign pages to the
  browser): `guest` in `desktop/cloud/main.mjs` names their pages, `tabOf` gives a presentation
  (`d:<id>`) and a document (`t:<id>`) a tab. Home gives a guest page a tab and steps back; a tab
  goes there itself and is `free` from then on. The preload says so (`cloudDesktop.tabs`), which
  makes `installedApp` `null` there: the app switcher shows, `windowForApp` opens nothing. Such a
  tab has Cloud's preload, not Slider's – no `sliderDesktop`, the page keeps its own buttons.
  Checked with a scratch Electron main around `createTabWindow` and a local server (await
  nothing before `app.whenReady().then` – at top level it never resolves); not seen in the
  signed-in app.
- Agents' cards are all one height (`CARD_HEIGHT` in `AgentList.tsx`): beside the face, under the
  title, the sheets of what it made – or, with none, how its last answer begins
  (`CloudAgentSummary.summary`, `summaryOf`: links by their names, no Markdown marks, one line).
- An agent's card shows what lies open on its desk as sheets peeking out, like a folder's files:
  `desk` on `CloudAgentSummary` (the first 3, `summaries`), the rest as „+N“. A presentation's
  picture (`thumbnailUrl`, `coversOf`: its first shown slide, a signed link) goes to the agent's
  person only – on the card and on the desk. „Agenten“ and the desk each have tiles and rows
  (`slider.cloud.agents-view`, `slider.cloud.desk-view`); the desk's things are drawn as files
  are (`DeskItem`, `components/DeskPicture.tsx`), taking over and putting aside are icon buttons.
- A desk thing's picture is named by the server (`thumbnailUrl` on the desk and on a card's
  `desk`): a presentation's first slide (`coversOf`, its person's), else the small picture of
  the file it is about once drawn (`picturesOf`: `cloud_nodes.thumbnail` `ready`, pictures and
  PDFs on asking) – a file the agent made too. The page asks for nothing else (`DeskPicture`),
  so a text file without LibreOffice shows its symbol and no 404 – but what an answer only
  names („Gefunden“, `FoundItem`) has no such word from the server: the page asks for its
  picture itself. A person's message has the copy button an answer has (`ChatMessage` in
  `ChatPanel`, in every chat). A chat's `[[file:…|Name]]`
  also ends as `]}` (`NAMED` in `AgentPage`): the model slipped there and the id showed bare.
- An agent works by itself as its order describes – nobody fills in a form
  (`services/cloud-agent-auto.ts`): it has the tools `repeat_order`/`stop_repeating` (the same
  `cloud_agents.repeat` as below) and `watch`/`stop_watching` (`cloud_agents.watches` jsonb, at
  most 8: an area, a folder with all below it, one file, an area's people; migration 0122 written
  by hand, with `watched_at` and `paused`), only in its owner's chat; the prompt lists what is
  set (`autoWords`) and tells it to set things up right away from „jeden Montag“, „immer wenn …“.
  Seen with a real model (2026-11-18): asked to watch an area and write into a new area, it
  stopped at „I cannot make an area“, asked back and set no watch while saying it would keep
  an eye on it – so the prompt now has it set the watch first, whatever else is open, and
  never promise one it did not call; and it has `create_area` (`createArea`, a free colour).
  A time in the order is meant on the writer's clock: the page sends `zone` with an order and a
  message. `runWatchingCloudAgents` (its own clock in `server.ts`, every 5 s, one look at a
  time) reads `cloud_events` per watch after the watch's `since` (and `watched_at`): nothing
  while the agent runs, then once the newest fitting event is `quiet` seconds old (set by the
  agent from the order, `wait_seconds`; left out 20, `CLOUD_AGENT_WATCH_QUIET`) one message of
  the owner in the first chat – what happened by name, then the watch's order. A watch with
  `until` (the tool's `until`, „YYYY-MM-DD HH:MM“ on the writer's clock) collects instead: one
  run at that time with all of it („nichts geändert“ too), then the watch is gone. All of that
  lives in the `watches` jsonb – no migration. What the agent does itself is no news because
  its run is an `AsyncLocalStorage` scope (`asAgent` in `cloud/events.ts`): `recordEvent`
  writes `groupKey` `agent:<id>|…` there, `ownEvent` leaves those out – so `watched_at` no
  longer moves when a run ends, and what others do meanwhile is worked on after it (it was
  lost before). Uploads on their way are known in memory (`cloud/uploading.ts`: `storeUpload`
  from first byte to last, tus with every part; not an agent's own writes) and hold a watch
  back until they are there. Its owner reads all that on the agent (`watching` on
  `CloudAgentDetail`, `watchingOf`; nobody else gets it) as the last thing in the first chat
  (`AgentWatching`: seen, „… wird hochgeladen“, the wait counted down, „Jetzt loslegen“ /
  „Jetzt berichten“ = `PATCH …/auto {startNow}`); the page asks every 1.5 s while there is
  something. The server cannot know of a file before its upload's first request – what the
  Mac has not begun to send is not shown. Asking back: the prompt (`ASKING`, appended to
  `autoWords`) has it end a question with `[[choice:…]]` lines (`CLOUD_AGENT_CHOICE`); the
  page takes them out of the text and shows buttons under its last answer (`AgentChoices`),
  a click sends one as a message. Seen in a browser with a made-up agent; the tools tested
  with a scripted model in `cloud.test.ts`, no run with a real model yet. `paused` (`PATCH /cloud/agents/:id/auto`
  `{paused?, removeWatch?}`, owner only) stops both without losing them; what happened
  meanwhile is not made up for. People: `setAreaMembers` records `area_people` (who came, who
  went) – the workspace's own members joining is no event yet. The page: „Arbeitet von selbst“
  (`AgentAuto`) over the desk – each rule as a line with its ✕, the repeated order's pencil
  (`AgentRepeat edit`, no clock button in the header any more), pause for all; cards show
  replay/eye/pause (`autoWords` in `lib/kinds.ts`); no examples under the order's
  field (taken out again: the line was in the way). Seen in a browser with made-up agents; no run with a real model.
- An agent repeats an order by itself („Wiederholen“, `AgentRepeat`, `PUT /cloud/agents/:id/repeat`,
  owner only): `cloud_agents.repeat` (rhythm `day`/`weekdays`/`week`, `at` HH:MM, `zone`),
  `repeat_text`, `next_run_at` (migration 0119, written by hand). The server looks twice a minute
  (`runDueCloudAgents`, started in `server.ts`): a due one gets its order as its owner's message in
  the first chat, the next time (`nextRun`, the zone's clock, so 08:00 stays over summer time) is
  set before the work starts. Still working: that time is left out; refused: said in the chat; an
  owner who may no longer give work (403) loses the repetition. A time missed while the server
  was off runs once. No rate limit beyond `MAX_RUNNING_PER_USER`; shortest rhythm is a day.
- Agents are happy flowers: `generatedAgentAvatar` renders „Glaze Flowers“
  (`lib/glaze-flowers.json`, every mouth in it smiles) with the style's own grounds and scenes. The
  file is generated in github.com/Root-Bert/glaze-flowers (`npm run build` there) and copied over –
  never edited here. Its brush and glaze look are SVG filters; they render in `<img>` data URIs.
  Admins pick the style in the workspace's settings („Agenten“: „Blumen“ = Glaze Flowers, „Köpfe“
  = DiceBear's „Cameo“, CC0, from the bundled `@dicebear/styles`; `workspaces.agent_avatars`,
  `PUT /workspaces/:id/agent-avatars`). Every agent picture goes through `useAgentAvatars`
  (`AgentAvatar`, calls, menus) – never `generatedAgentAvatar` alone, or it ignores the choice.
- „Bereiche“ › „Personen“ fills the page (`CloudPage fill`), so the page does not scroll, and has
  a full window button (Esc leaves). Folded, the side bar shows storage as a ring (`StorageRing`).
- `SidePanel` lives in `@/ui` (`side="left"` for a menu); the viewer's file re-exports it. Cloud's
  file details and, below lg, its places („Orte zeigen“, ✕/Esc close) are that panel.
  `ListToolbar` drops the filter's labels before the row wraps (measured like `ViewToolbar`).
- The Cloud app hands a presentation to the Slider app when one is registered for `slider://`
  (`slider://open?url=…`, `followLink`): shown there if it is that app's server and it is online,
  else the Slider app opens the browser – except signed in nowhere (`cloudOrigin` null,
  `live.log`: „start: here (server none)“, the usual reason it „opens in the browser“): then it
  asks „Slider an <host> anmelden?“ (`offerSignIn`), starts the sign-in at that server and
  shows the page after (`pageWaiting`). The question seen (2026-11-18, a second instance:
  `open -n -g …/.slider-dev/Slider.app --env SLIDER_USER_DATA=<scratch> --args "slider://open?url=…"`
  – the lock goes by the data folder); its answers and the page after signing in not run.
- What a click did is said at the click where there is room, not in a toast elsewhere – unless
  the thing leaves the place of the click (`AgentShare`: the agent goes to another list).
- An agent is written to while it works (`work(…, 'wait')` in `services/cloud-agents.ts`): the
  message is kept in the chat at once (everyone sees it) and waits on the run (`Run.waiting`,
  in memory, ≤ 20). The writer of the running answer is heard between the AI's turns
  (`ToolChat.more` in `tool-chat.ts`: with the tools' results, or instead of ending); anyone
  else's waits until that answer ended and is answered as them (`goOn`) – tools run as who wrote.
  Stopped or failed, what waited stays unanswered in the chat and the next message tells it.
  What the agent does by itself (repeat, watches) is still left out while it works. The field
  (`AgentComposer`) shows „Stoppen“ beside „Senden“ (`working`); `busy` only while an order is
  being placed. The route's 10 asks a minute per person (`aiLimits.materialQuestions`) count.
- „Agenten“ (`/w/:id/dateien/agenten[/:agentId]`, side bar row under „Zuletzt“): an order to the AI
  that runs in the server (`runInBackground`), not in a request – the page only polls (1.5 s
  while `running`, `lib/api/cloud-agents.ts`). Server: `services/cloud-agents.ts` +
  `routes/cloud-agents.ts`, tables `cloud_agents`, `cloud_agent_messages`, `cloud_agent_files`
  (migration 0114). There are no guests, only the workspace's roles: who looks or comments (`viewer`, `reviewer`) uses the AI to find and read only: Cloud's chat
  offers them no changing tool (`runTool` refuses too), agents take work from members and admins,
  slides change by AI with the edit right as ever. Everyone in the workspace reads every agent (chat and desk); only who gave
  the order writes on, stops and takes over; deleting: they or an admin. Rights: every tool runs
  as `cloud_agents.user_id` – the Cloud chat's tools (`runTool`, exported), Slider's from
  `mcp.ts` (`runMcpTool` with that person's viewer, held to the workspace) – so an agent can do
  what its person can, nothing more; taking over checks again with their rights as they are
  then. **As it was until 2026-11-18** (rows `open` still work so – now see „No copies, nothing
  waits“): the desk („Desktop“, `cloud_agent_files`, columns for it in migration 0115): the agent
  changes nothing itself – it only has the Cloud chat's reading tools; `write_file`,
  `change_file`, `create_folder`, `move`, `rename`, `delete` write rows (kinds `new`, `change`,
  `folder`, `move`, `rename`, `delete`), rights checked at once and again when taken. Text files
  (`TEXT_EXTENSIONS`) as text, sheets (xlsx, ods) as CSV turned into the file by SheetJS when
  taken; no other kinds. `desk_folder` = the desk id of a staged folder (`desk_parent_id`):
  taking a thing takes its folder first. Presentations: `create_presentation` is made at once
  but kept to the person (`setDeckAccess` restricted, kind `deck`; taken = opened to the
  workspace); `copy_presentation` makes a restricted work copy (`editedFile` →
  `createDeckFromFile`, kind `deck-change`; taken = `sync.importUpload` into the original, copy
  deleted); `edit_slides`, `build_presentation`, `add_note`, `add_link`, `update_presentation`
  only take a deck id that lies open on the desk. No `add_comment`. „Übernehmen“ is `carryOut`;
  „Alle übernehmen“ (`POST /cloud/agents/:id/take`) goes through all, in order, and names what
  failed. Deleting an agent trashes its untaken new presentation and deletes its work copy.
  A desk file's original is shown only to who may see that file. Which agents run is in memory
  (`runs`): a server restart ends a run without an answer – the chat then ends with the
  person's message (`interrupted`, shown as „Unterbrochen“), sending again goes on. The agent names
  its chat itself (`name_chat`; until then the order's first line) – until its owner renames it
  („Umbenennen“ in its menu and on its page, `PATCH /cloud/agents/:id/title`, `cloud_agents.named`;
  the title is also its @-name in conversations) – and links what it names as
  `[[file|folder|area|presentation:<id>|Name]]` – `AgentPage` draws those as links and lists them
  beside the chat („Gefunden“); nothing is kept for that, the list is read from the answers. To look at it without a key: a stand-in for the
  model on `ANTHROPIC_BASE_URL` (the SDK reads it). Tested inside the access test of
  `cloud.test.ts`.
- The AI on Slider's start: ✨ in the header (`HomeChatButton`, only at `/w/:id`) opens `HomeChat`
  in `ReviewsPage`. Server: `services/home-chat.ts` + `routes/home-chat.ts` (`POST
/workspaces/:id/chat`). Its tools are a list of names out of `MCP_TOOLS` (`FROM_MCP`), run by
  `runMcpTool` with the person as caller held to the workspace – a new thing it should do is a
  name in that list, not new code – plus `show_in_list`, which only tells the page (`filter`
  event → the list's search field). Both chats share the loop (`services/tool-chat.ts`) and the
  page's hook (`useAgentChat`, `features/viewer/board/agent-chat.ts`). Main and header step
  aside for any `[data-cloud-panel]`. Tested inside the same `it` as Cloud's chat; the changing
  tools were not run against real presentations in a browser.
- Side panels in Cloud (details, AI) take the whole height and carry `data-cloud-panel`; the
  header's right end steps aside by `body:has([data-cloud-panel])` (`AppHeader`). The path
  (`CloudPage` crumbs) sits absolutely in the gap under the header, so every title is at 104 px.
- „Agenten“ are Cloud's alone. Slider had them as a third view (`/w/:id/agenten`, beside
  „Präsentationen“ and „Bibliothek“) for a day; taken out on the user's call (2026-11-19): the
  list is the workspace's agents, whatever they work on, so file orders stood among the
  presentations – a summary does not say which app an agent works in (`doingIn` is per chat,
  while it runs). To bring them back, filter by that first.
- The „Bibliothek“ is one set of pages in both apps: Slider's `/w/:id/material…` and Cloud's
  `/w/:id/dateien/bibliothek…` render the same `MaterialPage`, `NewMaterialPage`, `MasterPage`
  (fonts, colours, icons, words serve every app; templates are Slider's, seen in both). Links
  inside come from `useLibrary` (`lib/apps`), never from `routes.workspaceMaterial` directly;
  what opens the editor goes through `useSliderDoor` (from Cloud: Slider's window). The card
  grids (`collectionGridClass`) count columns by container width – a page showing them needs
  `@container` on its `<main>`, or they stay one column.
- A presentation lies in a folder in Cloud (the user, 2026-11-17: no place of presentations'
  own, one works in projects and folders). `decks.cloudNodeId` is the file that stands for it
  (`services/deck-places.ts`); where that file lies says who sees the deck, through „Zugriff
  einschränken“: own files = the owner alone, an area for its people = those, an area of the
  workspace = everyone. `POST /cloud/nodes/:id/present` gives the same deck every time and
  links only a deck it made just then; `PUT /decks/:id/place` („Verschieben …“ in Slider, the
  dialog is Cloud's `DestinationDialog`) moves the file or makes one of the deck as it is;
  `POST /cloud/nodes/move` calls `followMoved`. Decks without a place stay as open as they were
  – nothing was moved for them. Slider's start page lists every deck one may see, last opened
  first, with pins; it has no folders (`deck_folders`, `decks.folderId` and their routes are
  still there, unused by the web). Not built: the file's bytes do not follow edits in Slider,
  renaming/trashing the file does not rename/trash the deck, and moves by the sync client or
  the Finder don't call `followMoved`.
- No „Entwürfe“ (the user, 2026-11-19: „es soll doch kein entwürfe geben. datein landen erstmal
  in Meine datein. außer natürlich die werden direkt aus einem Bereich/Ordner heraus
  erstellt“). The area `cloud_areas.home` went with migration 0129 (its files, events, agents
  and channel moved to the workspace's own area; its area channel became a channel „Entwürfe“
  there when that had one). A new presentation, document or PDF lies in its maker's own files,
  so only they see it (`placeNew` after `createDeckFromFile` in `routes/decks.ts` and the MCP's
  `create_presentation`; `documents.ts` / `pdfs.ts` `store`/`importPdf`; not template drafts,
  not sync) – made from a folder or an area it lies there: Cloud's „Neu › Neue Präsentation“
  sends `ui.place` as `/neu?ordner=` / `?bereich=` and `NewReview`'s `openDeck` places it
  (`usePlaceDecks`); the AI's `create_presentation` / `create_document` take `folder`/`area`
  (the chat's `move` still refuses own files → an area, so the AI makes it where it is to go).
  Access and place say the same in both directions: „Zugriff einschränken“ by the owner
  (`setDeckAccess`) moves the file – everyone: the workspace's own area unless it lies in an
  area of the workspace; only oneself or chosen
  people: one's own files, shared with those (`cloud_shares`, role view), so they find it under
  „Geteilt“ – unless it lies in an area for exactly those people. Sharing or unsharing that
  file in Cloud sets the deck's people (`followShares`). An admin changing someone else's deck
  changes the access only. The dialog offers „In den Bereich legen“ when everyone chosen is in
  one area for its people. Decks from before have no place and were not moved.
- The workspace itself is an area (`cloud_areas.root`, migration 0123 written by hand; one per
  workspace, made by `cloudContext` when missing, position -2 so every list has it first – the
  sync drive's top folders too). The user, 2026-11-18: „wie so n Art home“. Its name is the
  workspace's, read with the areas in `cloudContext` (the stored name is only what it was when
  made – nothing to do on rename); its people are all of the workspace (`toAreaDtos`,
  `setAreaMembers` refuses); not deleted, not renamed, always for the workspace; `parentId` of
  it means the top (`createArea`). Web: `isWorkspaceOwn` (`lib/areas.ts`) = it –
  no agents view, no „Personen …“, no „Löschen“, the dialog asks only „Wofür“. The side bar has
  no „Bereiche“ row any more: the workspace's row (its mark, `AreaMark`; „+“ = „Neuer Bereich“;
  it does not fold – workspaces are switched in the header) with the areas standing in under
  it. The page „Bereiche“ (its top tile is this area) is this area's third tab, where the others
  have „Agenten“: „<Workspace>  Chat  Bereiche“ (`AreaViews`; the user, 2026-11-19). Every
  area's crumbs start at the workspace, never at „Bereiche“ (`areaTrail` in `lib/areas.ts`); the
  workspace's own pages have none.
- Cloud's pages do not scroll the window: `CloudPage` is as high as the window leaves, header
  and tabs stay, the content scrolls in its own box (the selection box's `scroller`). `fill`
  (the start page) gives the content that height, so its list and „Aktivität“ scroll each in
  itself from `2xl` on. A deck and the file standing for it are one thing: the start page
  drops the file from „Weiterarbeiten“ (`deck.cloudNodeId`). Below lg nothing floats: „Orte
  zeigen“ is Sender's `MenuButton` at the start of the page's head (`SenderMenuContext` from
  `CloudLayout`, label `Orte zeigen`; `CloudPage` sets it `null` for what it shows inside, so an
  area's chat or a mail beside the list brings no second one). An agent's page
  drops `fill` there: its chat keeps a fixed height (`100svh-20rem`)
  and the cards follow when the page scrolls – squeezed, its first line lay in `roll-away`.
- Opening a file (`ui.open`): a presentation becomes a deck in Slider, everything else is handed
  to the computer as a download – there is no big in-page view any more. `?datei=<id>` is only the
  „Details“ panel beside the list (facts, activity, versions). An area's colour is an accent or
  any `#rrggbb` (`cloudAreaColorSchema`) – paint it with `areaColor()`, never a class per colour.
- Which app a page belongs to: `lib/apps.ts` (`/cloud`, `/w/:id/dateien…` = Cloud; settings,
  usage, instance pages keep the app one came from – `back="app"` on `SettingsLayout`, `AppTabs`
  switch Gesamt / Cloud / Slider via `?app=`). Pages between the apps (`NEUTRAL`: `/`, login,
  mail links, legal, account…) wear the app they lead to – the login `returnTo`'s (`appOfTarget`),
  else the one last open, else Cloud (`appBetween`): logo (`AppLogo` in `LogoHeader`), tab title
  (`appTitle` turns a page's „| Slider“ into the app's name), icon and manifest. `index.html`
  names Cloud's; the router (`App.tsx`) and `AppHeader` put the page's app's in (`APP_FILES`, one
  table: manifest, tab, tile). The same file swaps manifest and tab icon per app
  (`showAppManifest`): two manifests on one scope `/` with their own `id`/`start_url`, so each
  app installs by itself; installed, the other app opens in a window of its own
  (`windowForApp`) – the web has no way to launch another installed app. Cloud the app wears the
  cloud (Figma „Cloud Mark“ / „Cloud App Icon“, the user's call 2026-11-17); the two boxes are
  the family's mark, for the website. One vector file in four places (`assets/cloud-mark.svg`,
  `public/cloud-favicon.svg`, `desktop/cloud/mark.svg`, the sidebar symbol `drive/cloud.svg`);
  the tile (`cloud-icon-*.png`, `desktop/cloud/icon.png` at 824 px in 1024) is a picture, made
  as Slider's is: `scripts/app-icons.ts` writes the guide's frames as layers into an Icon
  Composer document (`brand/logo/icon/Cloud.icon`, `Writer.icon`; the angular gradient drawn in a
  page as a conic one) and `ictool` exports it with the glass – drawn flat beside Slider's glass
  the frames looked different (the user's call 2026-11-18). The comment box is the same picture
  in all three (white edge 4, colour ring 4 – measure a new one against Slider's layer). The
  three app icons share one size (the user's call
  2026-11-18): the comment box 58 % of the tile, the guide's mark at 93 % about the middle;
  Slider's through its Icon Composer source (`brand/logo/README.md`). After new pictures bump
  `?v=` (manifests, `lib/apps.ts`, `index.html`) and delete `desktop/node_modules/.<app>-dev`.
- One look: pages share the side padding `md:px-8`; Cloud's details panel wears `glass-floating`
  at the width of Slider's `SidePanel`; colours are mixed in `ui/ColorMixer` (no native dialog).
- A click on a file shows its details, „Öffnen“ or a double click hands it to the computer.
  Folders: round, white/black by mode, a colour of their own (`cloud_nodes.color`, „Farbe …“);
  pinned to the side bar per person (`cloud_pins`, „Anpinnen“ / „Lösen“, `CloudHome.pins`).
- Trash across the apps: „Löschen“ of a presentation sets `decks.deleted_at` (`trashDeck`) –
  `deckAccess` answers 404 for it and `openToViewer` keeps it out of every list; `…/restore`
  and `DELETE …/trash` take `'trash'` as the gate. `sweepDeckTrash` clears after
  `DECK_TRASH_DAYS`. Slider's tab „Papierkorb“ lists only presentations (`TrashedDecks`); Cloud's
  „Gelöscht“ shows them above the files. „Papierkorb leeren“ in Cloud clears files only. A
  template being designed and the other `deleteDeck` callers still delete for good.
- Meant to end as a drive on the computer like Nextcloud or Box (open in the matching program,
  save back), natively: File Provider on macOS, Cloud Files on Windows, no WebDAV. Keep node ids
  and versions stable; do not add in-page editors that such a client would bypass.
- For that client: `GET /workspaces/:id/cloud/changes?cursor=` (`services/cloud/sync.ts`) tells
  what changed since the cursor – `nodes` as they are now, `removed` ids, `reset` to start over
  (who sees what changed, or away longer than `CLOUD_REMOVED_DAYS / 2`). `cloud_nodes.changed_at`
  and the rows of `cloud_removed` are written by triggers (migration 0110), never by code, so a
  new way to change files needs nothing; a new column a copy must hear of goes into the trigger's
  `UPDATE OF` list. The cursor trails the database clock by 10 s (stamped at the change, seen at
  commit), so late changes come twice – answers must stay safe to apply twice. In it: own files,
  areas, and under the root `shared` („Geteilt“, only when there is something) what others
  shared from where one does not see. Shares stamp no file: they are part of the view's hash, so
  a share given, changed, taken or run out resets; a folder moved into or out of a shared one
  brings what is in it along (`moved` in `syncChanges`). Uploads take `ifVersion` (the version
  the change was made on, `none` for a new file) and answer 409 `cloud_conflict` otherwise.
  A client signs in like the desktop app (session token as the cookie, no `Origin`).
- macOS drive: `desktop/drive/` (Swift, File Provider replicated extension + `cloud-drive`
  helper), built by `build.sh` with the command line tools alone (no Xcode project);
  `--dev-app` wraps both in an app of its own to try it. One domain for the account (`cloud`,
  no display name), at its top a folder per workspace (the user, 2026-11-17: one is in several
  and switches) – the extension asks `GET /api/workspaces` itself – in each one's own files and
  the areas; deleting goes to Cloud's „Gelöscht“. Ids: `ws:<workspace>`, `root:<workspace>:<id>`,
  a node's own id (its workspace is looked up in the kept lists). Server and session reach the
  extension in the drive's `userInfo` (`cloud-drive set <server>`, token on stdin; it removes
  drives of the old kind with `.preserveDirtyUserData`, which leaves unsent changes in a dated
  folder beside it in `~/Library/CloudStorage`). No app group, on purpose: macOS grants one only with a provisioning profile
  (`taskgated-helper: Disallowing … no eligible provisioning profiles`) and an unsandboxed helper
  cannot write the group's folder. Signing asks the keychain on the user's screen: say so before
  running `build.sh`, and pass the identity by hash – `security find-identity -v` lists a revoked
  certificate too, and what that signs is blocked as malware. A test app outside /Applications
  needs `lsregister -f <app>` and `pluginkit -a <appex>`; then the drive shows under
  `~/Library/CloudStorage`, but answers FP -2011 („Sync is not enabled“) until the user switches
  the provider on in System Settings (Login Items & Extensions → File Providers). Tried by
  hand against a scratch server (dev login, own port): list, open, create, rename, move, change,
  delete, the server's changes after `signal`, and a change on both sides (the server's stays,
  the Mac's goes up as „… (Konflikt)“). No automated test. In zsh `log` is a builtin: read the system log with `/usr/bin/log`.
- Cloud desktop: `desktop/cloud/` – an app of its own beside Slider (`dev.bertro.cloud`), a
  window on the server's `/cloud` in Slider's tab window (`tabs.mjs` with `app`: home is the files, a
  folder a tab of its own, the tab follows into folders and closes on leaving them) plus the drive; no local API, nothing kept but the session
  (safeStorage). Signs in like Slider through `/desktop-anmelden`, with `app=cloud` so the code
  comes back on its own scheme (`slider-cloud://`, `DESKTOP_SCHEMES`). From the repo:
  `bun run --cwd desktop cloud` (`CLOUD_SERVER`, `CLOUD_USER_DATA`; `CLOUD_NO_BROWSER=1`
  prints the sign-in link instead of opening it). Packed: `cloud:app` (`cloud/builder.json`);
  its `after-pack.cjs` takes the drive from `desktop/build/drive` when built with
  `DRIVE_BUNDLE_ID=dev.bertro.cloud` – electron-builder signing over the extension's own
  entitlements (sandbox, network) is untried. The app calls `cloud-drive` only when it lies beside its binary.
- In the Finder the place is called „The Office Cloud“ (the user's call, 2026-11-17): the app's
  and the drive extension's `CFBundleDisplayName` (`cloud/builder.json` → `mac.extendInfo`,
  `drive/Extension-Info.plist`) – and, because the Finder names a provider by its app's name,
  the product name: the packed app is „The Office Cloud.app“ (folder
  `~/Library/CloudStorage/TheOfficeCloud`). `CFBundleName` alone must not be changed: Electron
  finds its helper apps by it („Unable to find helper app“). `app.setName('Cloud')` stays – the
  data folder (`Application Support/Cloud`) and safeStorage's keychain key go by it, another
  name signs the user out. Built that way on 2026-11-17 (`drive/build.sh` with
  `DRIVE_BUNDLE_ID=dev.bertro.cloud`, `cloud:app`, `cloud/sign-dev.sh`, started with
  `open --env CLOUD_SERVER=… "The Office Cloud.app"`); the Finder itself no agent has looked
  at. An app built under an older name keeps its place in the Finder until its drive is removed
  (its own helper's `signout`), `pluginkit -r <appex>`, `lsregister -u <app>` and the build is deleted.
- The drive's icon in the Finder's sidebar is a symbol, not a picture: `CFBundleSymbolName` in the
  extension's Info.plist names `officecloud` in its `Assets.car` (`drive/cloud.svg`, one weight).
  Its shape is the user's own drawing in Figma (Brand Guide → „Cloud Icon Varianten“ → „Boden
  als eigene Linie“, frame „Symbol“, 2026-11-17): the cloud's circles as one line, its floor as a
  line of its own in front, the box filled. Take changes from that frame (its vectors are filled
  paths already, scaled into the template's `Regular-M` box) – do not redraw it. A symbol takes
  filled paths only.
  Only Xcode's `actool` compiles it (command in `drive/build.sh`), so the compiled
  file is checked in. The Finder shows a new one after `killall Finder`.
- Two desktop apps, each by itself (the user's call, 2026-11-17: handing pages from app to app
  did not hold up; since 2026-11-19 Cloud's app shows the others' pages in its own tabs, see
  „Cloud's app shows Slider and Writer“): no way across in a desktop app – `installedApp`
  (apps/web `lib/apps.ts`, also true in Electron) with Electron's user agent takes the app
  switcher's menu away. An installed web app has the menu (the user's call, 2026-11-21): the
  other app opens in a window of its own (`windowForApp`, manifests' scope `/`). A page of the other app reached anyway (a presentation
  opened from the files) goes to the browser: `inBrowser` as `elsewhere` in both mains, which
  page is whose in `SLIDER_PAGE` / `CLOUD_PAGE` there (as `appOfPath`). No `…://open` links, no
  menu setting. macOS starts a link's app (the sign-in's `…://auth`) without arguments, so the
  repo clones carry `Resources/app` leading to the repo's main (`scripts/dev-name.mjs`; `--make`
  makes the clone only). Slider's clone needs `bun run start` once (the staged API).
- Cloud's folder tabs (`openFromHome` in `tabs.mjs`): home shows the folder at once (its
  router's step) while the tab loads the same page behind it and takes over when its title is
  the same – a tab picked right away showed a blank page and the list jumping back.
- The drive never refuses a change to a fixed place (`root:…`, „Meine Dateien“): the Finder
  writes on it by itself (last opened, view attributes); an error from `modifyItem` leaves the
  place „not uploaded“ – a cloud with „!“ beside its name – and the system asking again. It
  answers with the place as it is. Check: `fileproviderctl evaluate <place>` → `isUploaded = 1`.
- The drive's top folders (areas, „Meine Dateien“) carry no cursor: `enumerateChanges` tells all
  of them every time and those that went (`Store.left`, kept). Compared with the store's own
  list they never changed – any other call (`refresh`) had taken the new name in before the
  Finder asked, so an area renamed in Cloud kept its old folder name (seen 2026-11-18, „Writer“
  for „TestBereich“; right after the new build).
- The drive's folders lie as the areas do (the user, 2026-11-19: „wenn ich im Workspace drin
  bin, dann ist das der Bereich“): the workspace's own area is no folder – `changes` tells it
  as a root of kind `workspace`, the extension keeps it as `Store.home` and lays what is in it
  into the workspace's folder (`ws:…`, which then takes new things: `Account.place`); an area
  under another (`CloudDriveRoot.parentId`) is a folder in that one's (`folderOf`, `Items.swift`),
  names free per folder. A Mac that knew the flat way begins anew (`Anchor.layout`) and is told
  the old folder went (`Store.left`). Not kept apart: a folder in the workspace's own area
  called like an area beside it. Put on this Mac on 2026-11-19 (the recipe under „The Cloud
  app's tabs“): the drive stayed on, began anew (FP -1002 once), and `find` in
  `~/Library/CloudStorage/TheOfficeCloud` showed the old folder gone and „Website“ in „EC“.
- Installing „The Office Cloud“ (measured 2026-11-18, macOS 27, the ad hoc `cloud:dmg` in
  /Applications): the first start after sign-in registers the extension and adds the drive by
  itself. Without more, macOS writes a new drive as off (`fileproviderctl dump` → `enabled: no`,
  FP -2011) until the user switches it on, and no call does that (Apple's forum). What turns
  it on from the start is the extension's own word, `NSExtensionFileProviderEnabledByDefault`
  in `Extension-Info.plist` (found in fileproviderd's `FPDProviderDescriptor`, in no SDK header;
  Nextcloud's client does not set it): measured with throwaway apps of fresh bundle ids, ad hoc
  signed, outside /Applications – without the key `set` exits 2, with it 0 and `enabled: yes`
  at the first add. Not seen: a first install of the real app on a Mac that never had it (this
  one was switched on by hand before the key). Never by force (no `pluginkit -e`, no writing
  fileproviderd's lists). Two test drives of one name collide (`CloudStorage/<name>` is one
  provider's, Cocoa 516) – remove the first with its helper's `signout`. For a drive that is
  off all the same (the user's switch, a system not taking the key) the app leads there:
  `cloud-drive set` exits with 2 when off, `askForDrive` asks once and opens
  `x-apple.systempreferences:com.apple.ExtensionsPreferences?extensionPointIdentifier=com.apple.fileprovider-nonui`
  (the sheet „File Providers“ with the app's switch – seen; `…LoginItems-Settings.extension`
  shows the login items only), looks every 2 s and opens the folder once it is on; the 30 s
  timer asks again for a drive that was not there, so no new start is needed; Konto › „Im Finder
  zeigen“ is the way back. Switched on once it stays on over a new build put in the same place
  (new signature, new extension UUID). Started outside „Programme“ (the disk image) the app
  asks to move itself (`moveToApplications`, a no is kept in `userData/stays`; quitting with the
  question open counts as a no). Not clicked through by an agent – the terminal has no
  assistive access: the question's two answers, the way from off to the open folder, the menu
  item. A terminal listing `~/Library/CloudStorage/TheOfficeCloud` hangs („Operation timed
  out“) until the user allows it that drive (TCC) – ask the helper or `fileproviderctl`
  instead. One window's picture without bringing it to the front: its number from
  `CGWindowListCopyWindowInfo`, then `screencapture -l <number>`.
- „Öffnen“ in Cloud's app opens a file where it lies in the Finder (`window.cloudDesktop`,
  `features/cloud/lib/computer.ts` ↔ `desktop/cloud/start-preload.cjs`, `cloud:open` /
  `cloud:local` in `main.mjs`): `cloud-drive path <workspace> <node>` asks the system for the
  place (item ids are node ids), `shell.openPath` hands it to its program – the system fetches
  it first, what is saved comes back as a version. `cloud-drive local <workspace>` lists what
  the system has materialised; those files carry „Auf diesem Computer“ (asked every 15 s). No
  drive or no place: the browser's download, as on the web.
- Cloud's window shows two tabs side by side (`app.split` in `desktop/tabs.mjs`, the button
  top right in the bar once there are two tabs): `beside` is the tab in the other half, `active`
  the half with the keys – a pick in the bar changes that one, a click into the other half
  swaps them. Files dragged in a page carry their ids (`features/cloud/lib/drag.ts`,
  `application/x-cloud-nodes`), since the other page shares no memory with this one: a folder
  or the page beside takes them, a tab in the bar takes them into its folder (`tabs:drop` →
  `cloud:drop` in its page) and comes to the front when something is held over it. Slider's
  window has none of this.
- Cloud's tabs: a folder and an area each have one (`tabOf` in `cloud/main.mjs` – an area is a
  folder too, for side by side), and „+“ in the bar (`app.newTab`) opens one at the start
  („Zuletzt“) that is `free`: it shows wherever one goes in it instead of closing when it leaves
  a folder. Only tabs on a folder or area are kept for the next start.
- `desktop/scripts/stage.mjs` copies every workspace's `package.json` the lockfile names (a new
  package missing there → „lockfile had changes, but lockfile is frozen“) and what the API reads
  beside its sources (`packages/templates/library`, the icon sets). It clears `build/app` and
  `build/bin` only: `build/drive` is Cloud's.
- Tables `cloud_*` (migration 0106). A node is a file or a folder; `area_id` set = in an area,
  `null` = its owner's own files. Names are sealed like deck titles → listing, sorting, searching
  and „is that name taken“ happen in the server (`tree.ts`, `searchNodes`), never in SQL; only
  `extension` is plain (filters and sums by kind). Recursion (what lies in a folder) is a walk
  level by level (`descendantsOf`, `folderStats`), no raw recursive SQL – it runs alike on PGlite
  and postgres-js.
- Rights in one place (`context.ts`): area by workspace role (admin manage, member edit – manage
  for the area's founder –, reviewer/viewer view; a `members` area only for its people and
  admins), one's own files nobody else's (not the admins' either), shares add for the shared node
  and what is in it. Someone reaching a folder through a share never sees the folders above it
  (`sharedRoot` cuts the path).
- Bytes: `workspaces/<id>/cloud/<nodeId>/<versionId>` in the blob store (sealed as everything).
  `BlobStorage.putStream` writes and seals as the bytes come in – files are never held whole
  (`putBlobStream` falls back to `put` for stores without it). An upload of a name that is there
  becomes its next version; its bytes were stored before that was known, under a key of their
  own – so a file's bytes are deleted by its versions' keys, not only its prefix (`blobs.ts`).
  A restored version points at the bytes it came from; storage counts a key once (`cloudBytes`).
- Uploads: whole (`POST …/cloud/files?name=…`, the bytes as the body, XHR for progress) below
  32 MB, else tus at `/cloud/tus` with a store of its own (`cloud-tus.ts`, 200 open uploads per
  account – a dropped folder is hundreds of files; deck tus keeps 3). A dropped folder's
  structure rides along as `path`.
- Shown as pages: a PDF, or an office file LibreOffice drew as one (`materialPdf` /
  `documentPdf`), page by page as JPEGs from the server (`pictures.ts`), kept beside the version.
  No PDF in an iframe: the app's CSP forbids frames, and the look stays ours. Uploaded HTML/SVG
  is sent as text or with a sandbox CSP, everything unknown as a download.
- Deleted = `deleted_at` on the node and everything in it, `deleted_root_id` naming what was
  deleted; restoring brings back exactly that. The hourly sweep (`sweepCloud`) clears „Gelöscht“
  after 30 days, unnamed earlier versions after 180, and own files of accounts that are gone.
- Files count against the workspace's plan (`StorageBreakdown.files`) and show on `/instanz`
  (tile and column) and in the admins' `…/dateien/uebersicht`.
- Scratch look at it: copy `e2e/playwright.config.ts` with own ports and data dir and the real
  `soffice`; the dev login is the workspace's admin. Open: a member removed from a workspace
  leaves their own files behind unreachable (cleared only with the account); content search;
  realtime (lists refetch every 30 s).

„Verbindungen“ (Cloud's side bar, `services/cloud-connections.ts`) is the other direction of MCP:
Slider as the client of services outside. A connection is one person's in one workspace, its
sign-in sealed in the row; agents get three constant tools (`list_connections`,
`connection_tools`, `use_connection`) instead of every service's tool list, and use the
connections of whoever wrote. Adding one is the person's alone, on the page – no agent tool
connects an address (prompt injection would make it reach a server of an attacker's choosing).
Every request goes through `safeFetch`; tools without
`readOnlyHint: true` run only with the person's switch (`may_change`), which no agent tool sets.
Tests reach a made-up service through the injected `fetch` (`outside` in `cloud.test.ts`) – never
a real one. Figma's server reportedly registers only clients on its own list, so there the
sign-in may be refused; the row then says why.

A connection may also be a plain HTTP API (`kind: 'api'`, migration 0147): a base address, how it
signs in (`api.auth`: none, bearer, a header of its own, basic – the secret sealed in `auth`, put
on by the server only, cut out of every answer as „[Schlüssel]“) and optionally an OpenAPI JSON
read once into `tools` (`operationsOf`; YAML only where `Bun.YAML` exists – not under vitest).
Agents call it with `call_api` (method, path, query, body): `apiTarget` keeps the path below the
base (no `..`, `//`, encoded dots/slashes, `?`/`#`), GET/HEAD read, anything else needs the switch,
redirects are reported and never followed (the key would go along), 1 MB / 30 s, 60 calls a minute
(`aiLimits.apiCalls`); adding and checking 20 a minute. An agent may `propose_connection`: a row
in `state: 'proposed'` that reaches nothing until the person connects it on the page (the same
address and kind, its key typed there). A new address that does not answer is not kept: 422
`connection_failed` – the page then offers the API fields (`looksLikeApi`) or opens an agent under
the field (`?agent=`, `AgentChat` from `components/AgentChat.tsx`) with the person's words as order.

„Zuletzt“'s „Ungelesen“ (user 2026-11-20: unread mails and chats belong on Cloud's start): the
same server list and rows as Sender's „Aktuell“ – `useUnreadNow` (`/sender/unread`, asked anew by
the side bar's counts + mail threads' stamp, so a read one goes) and `UnreadRow`, links through
Cloud's `SenderProvider` paths. At most 5, newest first, no „all“ link (the side bar has the rest);
hidden while pending and when nothing is unread. Slider's own start is „Präsentationen“, not
„Zuletzt“ – nothing there. A colleagues-only mail shows the group mark as in the side bar.

## Writer – text documents (`packages/odt`, `services/documents.ts`, `features/writer/`)

- A document is a Cloud file (`.odt`): its id is the node's, rights are Cloud's (`canEdit` from
  the node's access, `canComment` from the workspace role). The text has no rows of its own: the
  file is the truth. Other text files (`.docx`, `.rtf` …)
  are turned into `.odt` on import (LibreOffice), never edited in place.
- `packages/odt` reads the file into blocks (paragraphs with runs, tables, lone pictures) and
  writes single operations back into the XML (`OdtDocument.apply`); what it does not know stays
  in the file untouched and comes to the editor as a `locked` paragraph. New paragraphs and cells
  are written in the file's text format (`Text_20_body`), as the editor draws them – with
  `Standard` the page looked different after a reload.
- Editing: `editor/engine.ts` (no React) owns the model, one `contentEditable` root and the
  selection. Typing goes through `beforeinput` on the model, never through the DOM (composition
  is read back from the DOM once it ends). Sent 600 ms after the last change as the steps between
  the state sent and the state now (`stepsBetween`, at most `MAX_WRITER_OPERATIONS` a request,
  `clientEditId` + `baseSeq`); others' steps come over SSE (`document` event) and are applied
  around what is being typed. A refusal or a gap in `seq` reloads the document (`resync`).
- Pages are drawn, not real: one flow of text laid over white sheets; `lib/paginate.ts` pushes a
  block that would cross a sheet's end to the next sheet (`--push`). The thumbnails on the left
  are copies of the flow's children. Printing uses the same flow with the gap between sheets 0
  (`@page` takes the document's size).
- Comments hang on a paragraph id and a range of its text (`WriterAnchor`); typing moves them
  (`movedRange`). They show left or right of the sheet, on the side their words are on; below
  980 px of stage there is no room, the one in use lies over the page.
- `--selection` is not a global token: `selectionStyle(me.color)` sets it on the editor's root.
  Without it marks, the picked thumbnail and picture outlines draw nothing.
- Looking at it: the dev servers need a real login; a scratch API + Vite on own ports with
  `AUTH_DEV_LOGIN=true` and an own `DATA_DIR` signs in by itself. In Playwright the text is
  `.writer-stack .writer-flow [data-p]` (the thumbnails hold `.writer-flow` too).
- Desktop: `desktop/writer` is Writer's own app (scheme `slider-writer`), tabs from
  `desktop/tabs.mjs` with its own bar (`app.bar`); menu and bar speak to the page through the
  `writer:desktop` event (`hooks/useWriterDesktop.ts`).
- Bibliothek (`/w/:id/dokumente/bibliothek`): Slider's library pages (`useLibrary().app ===
'writer'`). „Vorlagen“ there shows only what a text document starts from (`DocumentTemplates`,
  the four of `lib/templates.ts` = „Neues Dokument“; a click makes a document) – no presentation
  designs, no upload of one (the user's call 2026-11-18). Open: own templates from a file.
- Tables: a row holds only its real cells (`colSpan`/`rowSpan`, covered cells are not in the
  model); `writerTableGrid` (shared) says which column a cell stands in – never count a row's
  cells. Merging, splitting and rows through a merged cell go up as one `setCells` (the whole
  layout: which paragraphs stand in which cell), a dragged column border as `setColumns`; plain
  tables keep `insertRow`/`removeRow`. `lib/model.ts` `shapeCells` is what both the sender and
  `applySteps` run, so they cannot drift apart. A column come or gone (`insertColumn`,
  `removeColumn`) is the same `setCells` with `columns` – the only step that may change how many
  columns a table has; without `columns` a layout of another width is refused. The new column is
  as wide as the one the caret stood in, then all are scaled: the table keeps its width.
- A format's own look for the whole document is the step `setFormatLook` (`engine.restyle`,
  `restyleToSelection`): the server writes it into the file's NAMED style (font declared in
  styles.xml – `Styles.fontName(family, 'styles')`; content.xml's names do not count there), the
  client does the same through `setFormatLook` in `model.ts`. `formats` is state like the page:
  in the undo snapshot, `sentFormats` beside `sentBlocks`, `formatSteps` go out BEFORE the
  paragraphs' steps, `applySteps` hands back `formats`. A paragraph follows only where its `look`
  said what the format said (a size of its own in the file's automatic style stays).
- Line spacing of a paragraph's own is `lineHeight` on the paragraph (not in `look`, which stays
  the format's): `fo:line-height` in percent in its automatic style, `engine.lineHeight(n | null)`,
  read with `engine.lineHeightNow()`. Spacing in points or „at least“ in a file is not read as
  the paragraph's own; it stays in `look`.
- Font and size by hand are run marks like colour (`setFont`/`setSize`, `engine.font`/`size`,
  read with `fontAt`/`sizeAt`: the one value, `null` when several). A mark is only what differs
  from the paragraph's look – the reader sets it so, the model drops it when it equals the look,
  the writer compares `run.font ?? the paragraph's` with what the stretch's style says and
  writes `style:font-name` (+ `-asian`, `-complex`) / `fo:font-size` only then. A family the
  file has not named gets a `style:font-face` in content.xml (`Styles.fontName`).
- Pictures: one standing alone is a locked paragraph of its own (`isPicture`, step
  `insertPicture`; „Bild einfügen“ with the caret in an empty paragraph). One in a line of text is
  a run of the one character `WRITER_PICTURE_CHAR` (U+FFFC) with `picture` – every offset
  (comment anchors, find, `stepsBetween`) counts it as one, and it goes up in its paragraph's
  `setParagraph`. `normalize` never joins such a run with a neighbour; `marksAt` reads the words
  around it. The file: a `draw:frame text:anchor-type="as-char"` – read as that run only when the
  picture can be shown (else the paragraph stays locked); a paragraph of nothing but such frames
  reads as one standing alone. Written, a frame the file brought is kept as a node (name, style,
  title) and only its size set (`frameFor`; `spareFrames` hands it on when the paragraph was
  parted or joined in the same batch). The view draws it as `img[data-inline]`; `pointAt`,
  `textOf`, `domOf`, `read` count it as one character – a new walker over the text must too.
  Clicking picks it (selected as its character; `pickedOffset`), the corners (`.writer-handles`,
  both kinds) size it in its shape; one standing alone is sized as remove + `insertPicture` (a
  new id). Pasting takes a picture only from this document (`fromHtml` compares its `src`).
- AI (`services/document-ai.ts`, `writer-ai.ts` in shared): a comment handed to it (✨ in the
  field, ⌘↵, „An die KI geben“ in a comment's menu; only who may write). It gets the whole text as
  `<p id>` lines with `**bold**`, `*italic*`, `<u>`, `[link](…)` and answers with one
  `edit_document` call (replace, insert, delete by paragraph id) – written as one step with
  `editDocument(…, { apart: true })`, a version of its own, never merged into someone's typing.
  The steps that take it back are kept with it (`undo`/`redo` on `document_ai_proposals`): the
  card under the comment takes it back and applies it again. Words without a call are its answer
  (`answered`). The run is not a queue job: it lives in the server's process (`running`), a row
  left `running` past the limit reads as failed. Told live with the `comments` event. Where the
  document's board has something, the first message lists it (`materialsBrief`) and the material
  tools stand beside `edit_document` for up to 8 reading turns before the 4 writing ones; without
  material nothing changes. Open: it does not make tables or pictures.
- The document's pill, top right, is a presentation's with „Drucken“ where that has
  „Präsentieren“: Drucken (⌘P), Exportieren (⇧⌘E, the file's download), ✕ – in the desktop app
  the tab bar has them (`documentItems` in `desktop/tabbar/tabbar.js`). No tracked changes:
  decided against (2026-11-19), like presenting it is not Writer's.
  Then the page counter „1 / 6“ (`PageCounter`, a presentation's `SlideCounter`; alone in the
  pill in the desktop app); the word count stands quiet beside the saved state.
- The pages lie left as a presentation's minimap (`PageStrip`): no name, no numbers, a bracket
  over what is in the window (written straight to the DOM on scroll), dragged it scrolls the
  document, a click leads to the page. Strip heights map per page, the gaps between pages count
  as nothing (`toStrip`/`toDocument`). The name is renamed in the list, not in the document.
- The tools stand at the right edge in two parts, top and bottom (`WriterToolbar`, buttons
  `sm` as a presentation's tool bar). No search button: ⌘F.
- The format bar (`FormatBar`): `FormatPicker` writes each format as the document does (font,
  weight, size scaled to 14–26 px) with its keys (⌥⌘0 text, ⌥⌘1–6 headings, by `event.code`);
  font and size are a presentation's `FontField`/`SizeField` (through `@/features/viewer`),
  hovering a list tries the value on the text (`engine.font/size(…, false)` is one undo step),
  mixed values are not put back after a try. Alignment, lists and indent stand behind „Absatz“.
  The bar speaks of the paragraph the selection STARTS in – a word picked by double click at a
  line's end reaches to offset 0 of the next paragraph.
- Comments copy a slide's from `@/features/viewer` through pure parts, not hooks: reactions
  (`document_comment_reactions`, migration 0131, `PUT /document-comments/:id/reaction`) render
  with `reactionState` + `ReactionChipsOf`/`ReactionPickerOf`; @mentions read
  `MentionPeopleContext`; reply drafts `useReplyDraftBody`. Several picked with ⌘/⇧-click:
  `CommentSelection.tsx` (the slides' `useBulkCommentActions`, on `DocumentComments`).
- A picture standing alone is aligned like a resize: a new paragraph in its place
  (`alignPicture`), `insertPicture` carries `align` → the paragraph style's `fo:text-align`;
  the view sets the block image's margins (`text-align` does not move a block).
- Others' carets: `POST /documents/:id/presence` `{sel}` publishes `{type:'cursor'}` on the
  document's live stream (no storage); `presence.ts` sends at most every 200 ms and again when
  someone joins, `RemoteCursors.tsx` draws via `engine.caretOf`/`rectsOf`. The hook's timer ref
  must be reset in its cleanup – StrictMode's fake unmount otherwise blocks every later send. In
  the rendered Markdown view the ids/offsets are the view's, so carets across views are approximate.
- Lock (⇧⌘L, „Ebenen“ rows): `protect` on a top-level paragraph/table, op `protectBlock`; the file
  gets a `text:section text:protected="true"` of its own („Gesperrt N“), a file's protected section
  reads as locked too. Refused centrally: `applyOne` (server) and `commit` via
  `touchesProtected` (client, toast) – not via `locked`, which stays „not the editor's text“.
- Desktop „Darstellung“ zoom items tell an open document's page (`zoomIn`/`zoomOut`/`zoomReset`
  over `writer:desktop`), other pages zoom the window – the roles zoomed the whole window.
- Open: a picture is never moved between „alone“ and „in a line“ by hand, and a paragraph
  parted down to one picture reads as one standing alone after a reload; the website
  still calls Writer „coming soon“ (`apps/site/src/lib/apps.ts` `LIVE`).
- A document has a board „Material“ as a presentation has (migration 0128): the five board tables
  carry `deck_id` or `document_id` (a `cloud_nodes` id, cascade), exactly one set (check
  `num_nonnulls`). One owner type for all of it – `BoardOwner` in `services/board-owner.ts`
  (`ownedBy`, `ownerColumns`, `ownerOf`), rights through `requireBoardAccess` alone: a deck's as
  `deckAccess`, a document's as its comments (who opens it reads, Prüfende and up put down, cloud
  access `manage` deletes anyone's; signed-in members only, no share links). Routes are the
  deck's under `/documents/:documentId/…` (one router, `BOARD_OWNER_PATH`), tus with
  `documentId` instead of `deckId`. Files lie in the media store under
  `documents/{id}/materials/` – no row points there once the document is purged, so
  `fileBlobs`/`workspaceBoardBlobs` (`cloud/blobs.ts`) name the prefix before the rows go.
  Changes are told on the document's stream as `{ type: 'board' }` (`deps.documentLive`).
  MCP, voice and deck creation know decks' boards only.
- Markdown (`.md`/`.markdown`, `WRITER_OPENS`): the server's `MarkdownDocument`
  (`packages/odt/src/markdown.ts`) is a line a paragraph, one plain run; bytes kept (EOL, BOM,
  trailing EOL). Line ids lie beside the version as `${storageKey}.ids.json` (written after the
  bytes, deleted with the last version of that key in `removeVersions`); without it ids are
  positional `L1…` – a file edited outside Writer can move comments by a line. Pictures refused,
  the AI sees and writes raw lines (`MARKDOWN_NOTE`). Two views, remembered
  (`writer.markdown.view`), switched in „Ansicht“ (flush → wait saved → refetch → remount with
  key `id:view`): „Markdown“ = `normalize: plainEdit`, CSS `.writer-code`; „Formatiert“ =
  `MarkdownCodec` (`lib/markdown.ts`) between engine and server – the engine works on view blocks
  read by `readMarkdown`, `send` writes them back with `writeMarkdown` (unchanged units verbatim,
  changed ones get the block id as first line id) and sends `stepsBetween` of the lines; remote
  steps are re-read and passed as view steps; empty paragraphs exist only in the view.
  Comments stay raw: `anchorToView` for display, `anchorToRaw` on add, `onText` diffs lines.
  Check: web `lib/markdown.test.ts`, api `documents.test.ts`.
- „Seitenfarbe“ (Ansicht: Hell / Wie Darstellung / Dunkel, `writer.pages`, `data-pages` on
  `.writer-editor`, all CSS in `writer.css`): a dark .odt sheet is `--writer-paper` with
  `.writer-flow` under `invert(1) hue-rotate(180deg)` and pictures turned back – the file's own
  colours are never rewritten, marks/cursors/guides lie outside the filter. Markdown surfaces use
  the theme's tokens (the formats' inline inks `#37352f`/`#787774` are overruled with
  `!important`), the forced choice resets those tokens on `.writer-stack`. Print undoes both.

## Reader – PDFs (`services/pdfs.ts`, `pdf-bake.ts`, `pdf-ai.ts`, `features/reader/`)

- A PDF is a Cloud file (`.pdf`); Reader never writes it. Fields, text, ticks and signatures are
  marks over it (`pdf_marks`, rects as fractions 0..1 of the page as shown, pages 0-based);
  export and print bake them in with `@cantoo/pdf-lib` (`pdf-bake.ts`, saved with
  `updateFieldAppearances: false`: a field written there draws its own appearance).
- Layout follows the pages (`flowOf` in `viewer/Viewer.tsx`): mostly landscape → Slider's way
  (side by side, scrolled across, film strip above the bottom bar, comments in a row under the
  pages, ←/→ page to page, fit to the height); otherwise Writer's (one under the other, strip on
  the left, comments beside). Positions come from `layoutOf(...).origins`, offsets from the
  pages' block (`block` ref) – never assume a vertical stack.
- Pages are drawn in the browser with `pdfjs-dist` (worker via `?url`). The form is not pdf.js's:
  our own inputs stand over the widgets (`formWidgets`, `PdfPageView` `Field`). In pdf.js 6
  `PageViewport` has no `convertToViewportRectangle`, `PDFDocumentProxy` no `destroy` – use
  `doc.loadingTask.destroy()` (`closePdf`). `TextLayer` needs `--total-scale-factor` on the page.
- Print renders the baked export to images in a part only the printer sees (`lib/print.ts`):
  the page's policy allows no frame.
- AI: a comment handed to the AI reads the text and page pictures; it fills fields only for
  someone who may edit (`fill_fields`), each fill taken back from its comment.
- Looking at it: scratch API + Vite on own ports (see Writer). While another agent's router
  points at files not there yet, a scratch Vite config with a plugin that stubs them keeps the
  page loading (never commit it). `sips -s format png file.pdf` shows an exported page.
- `drawPage`: `forms: false` (the pages in the viewer) leaves the fields out of the canvas
  (`ENABLE_FORMS`) – our own stand there with what the file holds; `forms: true` (thumbnails,
  print) draws them (`ENABLE`). The other way round a re-opened export showed each value twice.
- Figma: file „Reader“ (`oAuoXtg6ty7WQSSABWvBS5`), pages as every product file has them: cover
  7:12, „Komponenten“ (the mark, 7:9), „Prototyp“ (was „Reader v1“: screens of the app as
  pictures, one note each).
- Brand guide: file „Brand“ (`jQ3zukYpHoXENoX5tneZ99`), page „Brand Guide“, table „02 Produkte“
  (24:96) – one row per product. Sender's and Reader's rows (67:96, 67:169) hold the app icon as
  layers one can change (the shapes of `scripts/app-icons.ts`), the mark as a component on white
  and black, and the word marks; their grey versions and Dock tiles are not drawn. The guide is
  where the icons are changed first – `app-icons.ts` follows by hand.
- Website (`apps/site`): Reader's page `/reader/` (de, fr), live; its screens are taken from a
  scratch instance (a form made with pdf-lib, filled through the page, signature and comments via
  the API), 1440 × 900 at 2×, dark.

## Sender – messages (`services/sender.ts`, `routes/sender.ts`, `features/sender/`)

- Conversations are `sender_channels` (migration 0127): `area` (one per Cloud area, made lazily
  by `senderHome` → `ensureAreaChannels`), `channel` (more inside an area), `group`, `direct`
  (`directKey` = the two user ids sorted). Who sees an area's channels comes from Cloud's area
  roles (`cloudContext`), groups and direct ones from `sender_members`. Agents are not channels:
  the side bar lists the user's Cloud agents and `AgentChatPage` talks to them over the Cloud
  agent API (`useCloudAgent`), reading marks them read (`readAgent`).
- Live: one SSE stream per workspace (`senderLive`, events in `packages/shared/src/sender.ts`).
  The web side patches the TanStack caches (`lib/api/sender.ts`); sending is optimistic with
  `pending:` ids, the stream's copy and the POST's answer are merged by id. Agents in both side
  bars come from `SenderHome.agents`: creating puts the new one into that cache at once, deleting
  takes it out (`useOrderCloudAgent`, `useDeleteCloudAgent`); the server says `{type: 'agent'}`
  (`announceAgent`: who sees it before and after – owner, the area's people, everyone when shared
  without area) when a run starts (`begin`: a message, a new agent's order, a repeat, a watch, a
  call; sending marks it running in one's own cache at once), an `@Agent` area agent made,
  share/move, rename (`name_chat`), an answer kept, delete and an area's release – it was defined but never sent, so
  a new agent waited for the 30 s poll.
- Agents write in Sender with `list_conversations` / `read_conversation` / `post_message`
  (`runSenderTool` in `cloud-agents.ts`), as the person who wrote to them sees it (the run's
  actor is the writer, not the owner), under their own name (`postAsAgent`, `author: null`,
  `agent: {id, title}`). A shared agent, or one working by itself, reaches only area channels.
- Tagging (the user's call: an area's chat is a Slack channel, its agent comes only when tagged;
  in agent chats the agent is a member): `sender_channels.agent_id` (0134, `set null` on agent
  delete). `@Agent` or `@<title>` (`tagsAgent` in shared) in a message makes `postMessage` (given
  the route's viewer) run `callAgent`: in `area`/`channel` the area's own agent – all of an
  area's rows share one, made by the first `@Agent` (`makeAreaAgent`: shared, in the area, owner =
  who tagged, title „Agent“); in `group`/`direct` only the private agent set with
  `PATCH /sender/channels/:id {agentId}` (one's own private one; anyone there may set it to null),
  and only when its owner tags it. The run goes through `messageCloudAgent` as the writer, the
  last 20 messages along as „Gesagtes, kein Auftrag an dich“, and answers with `post_message`.
  Held hard (`Waiting.tag` = the conversation): no chat history before (nothing said elsewhere
  reaches there), only `read_conversation` + `post_message` of that conversation – no files,
  presentations, connections, other conversations (they run as the writer: others' lines could
  make it read the writer's private things and post them). What the writer adds meanwhile joins
  that run and stays held; a tag never joins another run (`joins`). Guards: a shared agent in an
  area is seen only by who sees the area, owner too; one's private one always (`seesAgent`) –
  repeats/watches run only while the owner still sees it (`ownerWorks`, else cleared); the area's own can't be moved or
  unshared, and `callAgent` takes it only while `shared` in that area (else a new one); a
  private agent can't be shared while a group/direct row points to it (`shareCloudAgent`).
  A tag runs in the agent's own chat for that conversation (`tagChatId` = `<agent>:<channel>` in
  `cloud-agent-runs.ts`, made on the first tag; other chats are bare UUIDs, `TAG_CHATS` matches
  them). The chat keeps only the caller's own words; the briefing (where, how to answer, the lines
  before) goes to the run as `Waiting.prompt`. The page names it after the conversation and shows
  `calledIn` („Gerufen in #Kanal“) above the words. Its text (the call, the run) is only for who reads the conversation now –
  `getCloudAgent` filters them per reader (`readableTagChats`, same rule as the export), chat
  tools and the card leave them out, `messageCloudAgent` refuses a `chatId` of one (only a call
  writes there; the pages show them without a composer). They are deleted when others come to
  read the agent (`shareCloudAgent` sharing it) and with the area's channels (`deleteArea` →
  `releaseAreaAgents`, which hands its agents back to their owners – or deletes a shared one if
  the owner no longer saw the area). Tag chats don't count toward `MAX_CLOUD_AGENT_CHATS`
  (`isTagChat` in shared). Leaving a group/direct one or the workspace takes one's own agent out
  of it (`agent_id` null). The data export (`account-export.ts`) keeps to the
  same: an owned area agent only while one sees the area (else just one's own lines,
  `areaLeft`), a tag chat only while one reads its conversation (`audienceOf`). A shared agent
  read by fewer (unshared, moved to another area, its area deleted) loses others' work
  (`forgetOthers`): chats someone else opened or wrote in go (the first chat only empties –
  answers aren't tied to whose run they were), desk rows the owner can't open go; refused
  (409) while someone else's run or message is under way. Tag chats stay out of the card's
  `running`/`interrupted` and the side bar's unread. Deleting an
  account deletes its agents (cascade), an area's own too – `agent_id` goes null and the next
  `@Agent` there makes a new one.
  Web: `Composer` `agent` prop (first in the @ list), `ChannelPage` `AddAgent` menu and „Agent
  entfernen“.
- UI: route `/w/:id/nachrichten` (`SenderLayout` = side bar + outlet). The side bar knows two
  sorts (the user's call 2026-11-19): channels under their area – from Cloud's side like a folder
  in it – and „Direkt“, one list of people, groups and agents, the latest first. „Neu“ has one
  form for it (`NewDirect`: one person opens the direct conversation, more make a group;
  `?neu=gruppe` still opens it). Forms open in the page (`NewConversation`), not in a dialog. On narrow screens
  the side bar toggles from the page header (`SenderMenuContext` → `MenuButton`). Tokens: unread
  pill and „Neu“ line `bg-logo`/`text-logo`, day lines `bg-hairline-strong`. React compiler lint:
  no refs read in render – reset per conversation with the `shown !== id` state pattern
  (`Composer`, `ChannelPage`), caret moves after `setBody` in a `useLayoutEffect`.
- In Cloud (the user's call 2026-11-19, Sender to live in Cloud): `CloudLayout` wraps
  `SenderProvider` with `pathOf` (area/channel → `cloudAreaChat`, group/direct → `cloudChat`),
  `agentPath`, `homePath` and `newBase` – every link, notification click and „Neu“ form stays in
  Cloud (`?neu=` renders `NewConversation` in the page). An area's views are its name · „Chat“
  · „Agenten“ (`AreaChatPage`: own channel as „Allgemein“, others as pills, „+“ for a new one; the
  workspace's own area has files · Chat). The chats outside the areas (people, groups, agents)
  stand under the areas behind a line (`ChatRow`, folded: avatars). `CloudPage`'s selection box
  would block picking text: the chat stops `mousedown`. Sender's own bar: no headings, lines
  between areas and „Direkt“ as Cloud.
- „Neu“ (the user's call 2026-11-19): Sender's bar button opens no menu – it goes to the page
  (`?neu=`, `NewConversation`) where what is new is picked: ✨ Agent | # Kanal | 👥 Gruppe
  (`newKinds`: agents for `canCreateDecks`, channels where an area allows, groups always; agent
  first), the pick's form under it (`replace` on switching). Agent (`NewAgent`) = Cloud's „Agenten“:
  the order's field, one's own agents as `AgentList` tiles (`hrefOf`: `agentPath`), no whose filter,
  no tiles/rows toggle; in Sender wrapped in a `CloudProvider` for the cards' menu (`inCloud` where
  Cloud's own is around). No agent row of its own above the chats in either bar. Cloud's „Neu“ menu
  keeps its Kanal/Gruppe entries, opening the same page.
- Sender's page heads (`lib/title.ts`): the title as Cloud's (`text-display leading-tight`, a 36px
  row – the button's) on the line of the bar's „Neu“; no line under the title (the user's call 2026-11-19 – the
  channel's topic shows only while being changed).
- Sender's header has Cloud's ✨ too: `WorkspaceChat` (`CloudChat.tsx`) is the same chat
  (`cloud:<workspace>`) about the whole workspace, with starters of its own.
- Search, not a form, starts a direct message (the user's call 2026-11-19): each bar has one
  `BarSearchField` under „Neu“, its hits replace the bar's list in place. Sender: chats and
  people (`ConversationHits`, ⌘F). Cloud: one field for everything, its query in the address
  (`useBarSearch`: `?suche=…&ort=…&von=…`, first letter pushes, „Zurück“ ends it, going anywhere
  ends it). Small searches names only – the bar (`BarHits`: files/folders, areas,
  `ConversationHitRows`) and ⌘F –; the page (`SearchResults`, in the page's place) always names
  and what files say (`in=all`: names first, then text hits, their place a line under the name –
  `FileBrowser` `notes`), „Suche nach: „…““ where the path stands, „Ort“ (all, Meine Dateien, Mit mir geteilt, an area: API `area=own|shared|<id>`)
  and „Von“ (API `owner=<user id>`) as `Select`s – narrowed, areas and chats step aside (the user's
  call 2026-11-19). The bar folded, its search moves into that path row (`CrumbSearch`,
  `lib/crumb-search.ts`: `BarFolded` from `CloudLayout`, ⌘F/the magnifier `askCrumbSearch`): one
  types after „Suche nach:“ in the page, and the search page's path is the field again. An area found as such hides its own
  chat from the chat hits; ⌘F (`SearchPalette`) goes to a visible
  page field first (Gelöscht), else the bar's (`data-cloud-search="bar"`), else the
  path row (bar folded), else the palette (narrow). Chat order (`lib/search.ts`): named conversations, people
  without a chat (click = `useOpenSenderDirect`, straight in), groups found only by a member.
  ↑↓ step across all `[data-bar-hit]`. „Neu“: „Neuer Kanal“ · „Neue Gruppe“, no „Direktnachricht“.
- Looking at it: scratch API + Vite on own ports (see Writer), seed people/areas through the
  normal routes as dev-login users. Other people need no login: with the scratch API stopped, a
  bun script in `apps/api` (so `@electric-sql/pglite` resolves) inserts `users` +
  `workspace_members` rows into `<DATA_DIR>/db`; then direct/groups through the routes. In
  Playwright, wait for the new conversation's header before typing – a fill right after a click
  lands as a draft in the previous one.
- Figma: file `tlERLeHU3vecdI3gsNNalR`, pages as every product file has them (Cover · Konzept ·
  Foundations · Komponenten · Prototyp): cover 14:133 (1920 × 1080, built like Cloud's 36:2 – logo,
  family pill, title, text, chips left; a glimpse of the product right; the pages in the foot),
  components 3:2, screen „S01 Kanal“ 4:12. The MCP cannot set a file's thumbnail
  (`setFileThumbnailNodeAsync` is refused) – the first page's frame shows, or set it by hand.
- Website (`apps/site`): Sender's page `/sender/` (de, fr), live, „Conversations that matter.“
  (translated like Slider's tagline); its mark on the site is `features/cloud/assets/sender-mark.svg`
  (the front bubble is its comment box, `--m-face` colours the reactions on a white mark). Screens
  from a scratch instance (dev login renamed to a persona, agents and „Aktuell“ by the real AI, mail
  by `page.route` fixtures), 1440 × 900 at 2×, dark. No download link: Sender's desktop app is not
  built by ci.yml yet.
- Telling (`features/sender/lib/notify.ts`, wired in `useSender`): a message from the stream is
  a notification when it is to oneself, in a group, or names one (`mentionsIn`, shared) – not
  when that conversation is open and the window focused. One per conversation (`tag`), a click
  opens it. Permission is asked only at a click (`NotifyOffer`: a one-line pill in
  `AppHeader` beside the AI, in every app – the user's call 2026-11-19; „Später“ in localStorage `sender:notify-later`). The icon's count (`badgeCount`: direct +
  groups + mentioned channels + agents) goes to `window.senderDesktop.setBadge` and
  `navigator.setAppBadge` (installed web app). Nothing arrives while no Sender page is open –
  no Web Push yet (would need VAPID keys, a subscription table and `sw.js` handlers).
- Desktop app `desktop/sender` (scheme `slider-sender`, `bun run --cwd desktop sender` /
  `sender:app` / `sender:dmg`; `SENDER_SERVER`, `SENDER_USER_DATA`, `SENDER_NO_BROWSER=1`): the
  family's tab window with home only (`tabOf: () => null`). Closing hides – the page and its
  stream stay, notifications keep coming (`prependListener('close')` + `preventDefault`;
  `tabs.mjs` skips its `closing` when the close was called off); the Dock / second start / tray
  (outside macOS) bring it back, only quitting closes. Preload gives the page `senderDesktop`
  (`sender:badge` → `app.setBadgeCount`, `sender:show`), answered only for the signed-in
  server's pages. The menu's „Neuer Kanal …“ (⌘N) / „Neue Gruppe …“ / „Direktnachricht …“
  arrive as the page's `sender:desktop` event (`useDesktopMenu` in `SenderLayout`). macOS shows
  the Dock count only once the app may send notifications – the unsigned dev clone may show
  none although `app.getBadgeCount()` is right. Icon from `scripts/app-icons.ts Sender`.
  Checked: sign-in by `SENDER_NO_BROWSER` + Playwright on the link + the `slider-sender://` URL
  as a second start; CDP via `--remote-debugging-port` (passed through `dev-name.mjs`); menu
  clicks by System Events on the process (named „Electron“), windows counted with
  `CGWindowListCopyWindowInfo` (System Events' count is wrong for these windows).
- Drafts (`lib/drafts.ts`, the user's calls 2026-11-20: „alles gebündelt in einem“, „über
  Geräte verteilt“): one store for every field one writes to, kept for the account on the server
  (`sender_drafts`, migration 0148, `services/drafts.ts`, `routes/drafts.ts`: text and target
  sealed, unique per user+workspace+key, only one's own – a member's GET is `[]`, a stranger's
  404; 100k chars, 300 per workspace, 1200 writes/10 min; in the export as `entwuerfe.json`,
  cascades with the account). This browser's copy (`slider.sender.drafts:<user>`, dropped by
  `forgetOffline`) is what fields show and the outbox: an entry without `synced` waits to go up
  (PUT ~0.8 s after the last key, DELETE `?at=` for one thrown away – kept empty until then), so
  old local drafts migrate by themselves. `useDraftSync` (mounted in `SenderProvider`, both apps)
  lists on start/focus/30 s and merges: the newer `at` wins (server too: `setWhere` on
  `updated_at`, a future `at` clamps to now), a synced one the server lost is gone (sent or
  deleted elsewhere). Fields follow a change from elsewhere when not typed on (`useDraftText`).
  Keys: a conversation's id (`target.kind` 'conversation'; legacy untargeted ones get it when
  they are one of the workspace's channels), `mail:<thread>`, `agent:<agent>:<chat>`,
  `agent-new:<workspace>` (Neu › Agent, „Agenten“, Cloud's start), `agent-new:<ws>:<area>` (an
  area's „Agenten“ field, listed „Neuer Agent · <area>“), `mail-new:<workspace>` (to/subject in
  the target, kept even with no words; `dropDraft` clears them). „Entwürfe“
  (`useWorkspaceDrafts` → `DraftList`, both apps, the side bars' count) lists them all; an
  agent's other chat opens by `?chat=` (`AgentChatPage`, Cloud's `AgentPage`).
- New mail (`MailCompose`): the `:threadId` `neu` (`NEW_MAIL`) of the mail route – the form
  stands in the reader pane (split/expand/close like a thread), the page on a phone. „Neue Mail“
  in the folders' row left of Posteingang (`MailToolbar`, both apps; on a phone that row is icons
  only) and Cloud's Neu menu. Von (picker only with several mailboxes, default
  the list's tab), An (comma/space separated, checked client-side; server: `mailSendSchema`
  refuses CR/LF and non-addresses), Betreff, text; ⌘↵ / „Senden“ closes at once with „Mail
  gesendet“, a refusal puts the draft back, toasts and reopens the form if still on the list.
- Mail (`services/mail*.ts`, `features/sender/components/mail/`, `lib/api/mail.ts`): one's
  IMAP/SMTP mailboxes per workspace. A colleague's mail with no one from outside on it is a chat
  message (`message.mail`, subject shown above its text); a conversation with colleagues only
  (`people[].userId` on all – e.g. one's own mail to colleagues) is `mailThreadKind` 'group': it
  stands among the chats in both side bars (`withMailChats`) and shows as a read-only
  `MessageList`; anyone from outside on it, colleagues with them or not: „Post“ (the place is „Post“ in both side bars, page titles and settings; one message stays „Mail“ – „Neue Mail“, „Mail gelöscht“, „KI zur Mail“; the addresses stay `/mail`) (`?postfach=<id>&ordner=<key>`, see below; „Ungelesen“ in the page head beside „Postfächer“ is one switch for every mailbox and folder, `slider.mail.unread`, not in the address – it keeps a mail read while it is on in the list until filter, folder or mailbox change), each mail a card. The AI's
  column (`MailAside`, „KI zur Mail“) is switched, see below. Same
  components in Sender and Cloud (paths from `SenderProvider`: `mailPath`, `mailThreadPath`,
  `mailAccountsPath`). Looking at it: mail rows are encrypted, so seed nothing – a scratch API +
  Vite (dev login) and Playwright `page.route(/\/api\/(workspaces\/[^/]+\/)?mail\//)` with
  fixtures shows every page.
- Mail folders (`mail/servers.ts` `foldersToRead`, migration 0141): every selectable folder is
  read, Posteingang first, one round's budget (`PER_ROUND`, `BYTES_PER_ROUND`) shared by its
  folders – a cut-off one goes on from its own state next round. Skipped: `\Noselect`,
  `\NonExistent`, `\All`, `\Flagged`, `\Important` (copies) and `\Drafts` (an autosave would be
  a sent mail; a read-only sync never sees it deleted); where anything is subscribed, only
  subscribed own folders. Keys: a special folder by its role (`inbox`, `sent`, `archive`, `spam`,
  `trash` – so old rows, old sync state and Gmail's localized paths stay valid), an own folder by
  its path; names German, own ones „Eltern / Kind“ (`mailFolderList`, shared). A mail keeps every
  folder it lies in (`mail_messages.folders`; `folder` = where it came first) – a Sent copy of a
  mail sent from here is the same Message-ID (unique per mailbox), so it only adds `sent`. Only
  what arrives in inbox/spam is unread, AI-read and posted to a colleague's chat (`ARRIVES`); what
  is first seen elsewhere comes in quietly. Thread list `?account=&folder=`: inbox = not spam and a
  mail arrived in inbox/spam or was written here; spam = `thread.spam`; others = not spam and a mail
  lies there; none = the side bar's list. Nothing is moved on the server – only the read state
  is written there.
- Mail as it looks (HTML, migration 0151, `services/mail-html.ts`, `MailHtml.tsx`): a mail's
  HTML part is sanitized with `sanitize-html` (pinned 2.18.1; allowlist – no script, handlers,
  form/input, iframe/object/embed, svg, base, meta, link; links only http(s)/mailto/tel, made
  `target=_blank rel="noopener noreferrer"`; `<style>` kept but `@import`, `@font-face`,
  `expression`, `javascript:` stripped and every `url()` mapped; ≤2×2/hidden images dropped as
  pixels) before it is kept (`mail_messages.html`, sealed like `text`, ≤ 1 MB, else text only) and
  again when served. `text` stays what AI, search, export and replies read. Its `cid:` pictures
  are kept like attachments (`inline_images`, blob store, not in `attachments`, counted in
  `attachment_bytes`) and served by the attachments route. The page is
  `GET /mail/threads/:t/messages/:m/html[?bilder=1]` with its own CSP (`MAIL_HTML_CSP`: no
  script, img only self/data, inline style) and shown by `src` (not `srcdoc` – it would inherit
  the app's `style-src 'self'`) in `<iframe sandbox="allow-same-origin allow-popups
  allow-popups-to-escape-sandbox">`: no scripts ever run; same origin only so the parent can fit
  its height, zoom a too-wide mail to fit (phone) and forward keydown (dispatched on the iframe,
  so app shortcuts see it). White sheet in both themes; the mail's body colour reaches its
  edges; no `roll-away-list` fade over it. Pictures from outside: left out (count in
  `<meta name="slider-remote-images">`) until „Bilder laden“ (per mail, remembered per tab) –
  then each goes through `…/messages/:m/image?src=` which fetches only a URL the mail itself
  names (404 otherwise, so no open proxy), upgrades http to https, `safeFetch` (public IPs, DNS
  pinned, no cookies/referrer), ≤ 5 MB, type sniffed from the bytes (png/jpeg/gif/webp/avif),
  1500/h per person; nothing is stored server side. Backfill: one round per mailbox
  (`mail_accounts.html_read`, only right after a good round within the hour) re-reads the inbox's
  latest 30 without its state; known mails get their HTML filled in, nothing else changes.
  Older mails stay text. Playwright logs „Blocked script execution … sandboxed“ for its own probes
  into such a frame (seen with no app code) – allow it in `allowConsoleErrors`.
- Mail read state (`mail_messages.seen` / `seen_pending`, migration 0149; the user's call
  2026-11-20: „eine vernünftige Widerspiegelung“): unread = not `seen`, not outgoing, first seen in
  inbox/spam – thread list `unread` and Sender's start („Aktuell“) count that;
  `mail_threads.read_at` only says when it was last read here. Imported as on the server (`\Seen`
  with the mail; what is first seen in another folder or written here is read). Each round asks
  the inbox's and spam's mails read before again (`readFolder`, `FLAGS_WINDOW`): with CONDSTORE
  (Gmail) only what changed since `sync[folder].modseq` (skipped when HIGHESTMODSEQ is the same),
  without it (Outlook, most others) the latest 300 by place – older ones changed elsewhere stay as
  they were. Read here (opening it, answering): `seen` at once, `seen_pending` where it has a UID;
  `pushSeen` sets `\Seen` in the background (`MailServers.mark`, SELECT + `UID STORE +FLAGS.SILENT`
  in its first folder by UID), never a spinner; what fails waits for the next round, and the
  server's word never overwrites a pending one. A copy seen read in another folder makes it read,
  never unread. UIDVALIDITY changed in inbox/spam: their old UIDs are dropped (`uid` null, which
  there changes no list), re-linked when a mail is read again. A mail moved out of the inbox
  elsewhere keeps its last state here (its old UID). The AI reading by itself marks nothing read;
  there is no „als ungelesen markieren“ yet (`mark` and `seen_pending` carry `seen: false` too).
- Mail page (`components/mail/MailView.tsx`, `hooks/useMailView.ts`): the mailboxes are the title
  (`mailboxLabels`: its own name `mail_accounts.label` (migration 0146, encrypted, ≤ 60, trimmed,
  empty = default) else Google / Microsoft by sign-in, else the preset's name, else the domain; the
  same default twice → addresses). Renamed in place (`MailboxNameInput`, like Cloud's
  `NodeNameInput`): double-click the open tab or right-click a tab „Umbenennen“, or „Umbenennen“ in
  a row's menu under „Postfächer“; PATCH `{label}` optimistic (`useRenameMailAccount`), owner only
  (others 404). `mailAccountPatchSchema` has no defaults – zod 4 fills a `.default()` in even under
  `.partial()`, so a rename once set the name empty and the ports to 993/465. „Neues Postfach“ is
  a page of its own (`…/nachrichten|dateien/mail/postfaecher/neu`, `routes.*NewMailbox`,
  `ui.newMailboxPath`; `NewMailbox` in `MailAccounts.tsx`, Sender's page wraps it in a
  `CloudProvider` for the chat): only the add form; old `#hinzufuegen` links redirect there, OAuth
  returns (`?anmeldung=`) land there or on the new mailbox. Beside it `MailboxHelper` (as
  `ConnectHelper`): a line orders a private agent, `?agent=` keeps its chat in the page. No filter
  on what is typed into a chat (a password in the chat or in a picture is the person's mistake –
  a text filter had too many holes, so it went). Agents' mailbox tools (`services/mail-agent.ts` definitions + prompt,
  `mail-agent-run.ts` runs them – apart because `mail.ts` → `sender` → `call-records` →
  `cloud-agents` would cycle: `MAIL_TOOLS` was undefined when spread into `TOOLS`):
  `list_mailboxes`, `check_mailbox` (`checkMailAccount`, not under the route's 20/h limiter – it
  only reaches the kept servers), `update_mailbox` (label/name/aiReads) and `prepare_mailbox`
  (everything but the password → `MailPrepared`, in memory 30 min per person+workspace, lost on
  restart; `GET /workspaces/:id/mail/prepared`, cleared on add; the form takes each one once by
  `at`, focuses the password; a known provider's hosts always its own, the model's ignored; other
  hosts not of the address's domain (`mailServersToCheck`, shared; none for a known provider or
  OAuth) turn the form's agent notice into
  „Server prüfen“ above the password). No tool has a password field (asserted in `sender.test.ts`); only
  in the person's own private agent, like connections; no delete tool (no confirm pattern for
  agents). Switching
  mailbox: the tabs morph like `ViewTitles` (`startViewSwitch` / `useViewSwitchTop` in
  `workspaces/components/viewSwitch.ts`, names `mailbox-title-N`) and the first 12 rows flip like
  a split-flap board (`[data-mail-list] > li`, `mail-row-N` + `--flap` stagger in `index.css`, only
  while `data-transition='workspace-view'`; reduced motion: crossfade only); the other mailboxes'
  inbox is prefetched and the list scrolled to its top before the snapshot. Folders: the special
  ones a `SegmentedControl` md in a `GlassPanel` (Cloud's filter look), own ones behind „Weitere“
  (an md chip); Tab with nothing focused steps folders (`tabStep`). `mail` is a layout route with
  `:threadId` as its child: from 1280px the opened mail stands beside the same list, narrower, a
  `BarHandle` (`before`) between them (`slider.mail.listWidth`, 280 … container − 480, double-click
  396) (`MailInbox` has one row; the open one `surface-2`, `aria-current`); `Outlet` context
  `MailOutlet` (`useMailSplit`, `useMailPane`): „Vergrößern“ hides the list (remembered in
  `slider.mail.expanded`), ✕ and Esc close (`MailThreadView`, also where it is the page). ↑/↓ and
  j/k step and open; below 1280px the thread takes the page. In the pane the composer does not take
  the focus (`focusOnOpen`), or ↑/↓ would stop. Mail text is plain text: `[overflow-wrap:anywhere]`
  (`break-words` leaves a long link as wide as it is – the card scrolled sideways).
- „KI zur Mail“ (`services/mail-insights.ts`, `MailAside`, GET `/mail/threads/:id/insights`,
  POST `…/insights/summary`): switched with the sparkle at the end of the folders' row (thread as
  the page: in its head), open state `slider.mail.aside`; beside the mail with `useAgentAside`
  (own key `slider.mail.asideWidth`) when the mail's body is ≥ 700px, else over the mail (Esc
  closes it first). Worked out per request, never stored: „Beteiligte“ (`mailParties` – firms by
  `orgDomain` of the address, not `isCompanyMailDomain`-false ones nor the workspace's own:
  mailbox, members' firms, `join_domain`; links only from the last 15 lines of a sender's own
  words, own-domain pages and LinkedIn/XING, none for spam/phishing; the server never fetches
  them; each row a `MailAvatar` – glyph by domain, logo only where `MailParty.logo`: a mail from
  the firm with `auth` pass or the person wrote to it; a firm with any `auth` fail mail here gets
  no logo, no site, no signature links), firms the mails only write about („In der Mail
  erwähnt“: the summary call's `organisations[].website`, from the mail or the model's knowledge,
  kept as a domain only if `firmSite` passes – https, no login/port/IP/`xn--`, no shortener,
  `isCompanyMailDomain`, not own, and the label is the name, a run of its words or their
  initials (`nttdata` – NTT DATA, `telekom` – Deutsche Telekom, `bcg`); link = `https://<org>`
  start page, never fetched; logo via the logos route; none of it for spam/phishing; ≤ 6 parties
  in all), „Passende Dokumente“ (`searchNodes` per `searchWords` word, most hits first, the AI
  context's picks before), „Anhänge ablegen“ (where earlier attachments of the same sender/firm
  went – `nodeId` noted on `mail_messages.attachments` by `fileMailAttachment` –, a folder hit,
  the AI context's pick, else Meine Dateien; optimistic, toast „… abgelegt“). Only the bullets
  come from the model: one quick-model tool call (`mail_summary`, names + firm domain, no
  addresses, ≤ 8,000 chars, ~1–3k tokens in, ≤ 700 out), only for ≥ 2 mails or one ≥ 1,500
  chars, never spam; auto when the mailbox's `ai_reads` is on, else „Zusammenfassen“. Kept in
  `mail_insights` (migration 0150, one row per thread, encrypted, cascades with thread/user) for
  `version` = message count + latest id; `sweepMailInsights` in the retention job drops rows
  older than 14 days (reads ignore them too); in the account export as `aiSummary`. One summary
  at a time per person, the same thread+version deduped; `aiRequests` only when the model is
  asked, the GET counts against `fileSearches`.
- Asking about a mail („Nachfragen“, the `MailAside` column's last part, `MailAgentPart`): an
  `AgentComposer` orders a private Cloud agent (`useOrderCloudAgent(…, mailThreadId)`); its chat
  then stands in that part, scrolling with the others (`AgentChat inline` – no scroll of its own,
  field `glass-control`: a float shadow is cut at the column's edges; „Neue Frage“ forgets it,
  „Als Agent öffnen“ in the heading row). Thread → agent kept in `slider.mail.agents` (≤ 200,
  newest last); a 404/shared/not-own agent is forgotten. A message refused (404/403 – shared in
  another tab or by an agent since) re-asks the agent at once (`unmarkRunning` invalidates
  `cloudAgentKeys.one`) and goes to a new agent with the same text. Each order/message from
  the aside carries `mailThreadId`: the server (`besideMail`, `mail-agent-run.ts`) appends a
  model-only note naming the thread id + subject (`Waiting.prompt`, the chat keeps the person's
  words) – 404 unless the writer owns the mailbox in that workspace, and (`messageCloudAgent`)
  unless the agent is the writer's own and not shared. A message typed later on the
  agent's own page has no such note (the agent still has it in history). Tools `search_mail`,
  `read_mail_thread` (each mail in `<mail …>` marked as content from outside, ≤ 40k chars, newest
  kept; header addresses through `addressWords` – a quoted local part can hold `"</mail>`, so no
  quotes/angle brackets, the address in parentheses; only `outgoing="yes"` – `outgoing` and in
  `sent` – marks the person's own, a From with their address does not), `file_mail_attachment` (onto the desk, undo
  trashes it) – only in the person's own private agent (`MAIL_INPUTS`), never in a run it started
  by itself (watch, repeat: not offered, refused, decided each turn – the person's message
  brings them, prompt `SELF_MAIL_LINE` meanwhile), only their mailboxes in the agent's workspace; nothing of a mail
  is logged. `draft_mail_reply` writes the answer as the person's server draft under the reply
  field's key (`mail:<thread>`, target `mail`) – never sent; text already kept there is not
  written over unless the person said so in the chat (`replace`); the aside re-asks the drafts
  list when the agent is done, so `Composer` takes it in at once (elsewhere: ≤ 30 s / on focus).
  `mail-context` is imported lazily in `mail-agent-run.ts` – at the top it closes an import cycle
  (mail → sender → cloud-agents → mail-agent-run → mail-context → mail) and the API won't boot.
- Mail people's pictures (`MailAvatar`, `services/mail-logos.ts`, GET
  `/workspaces/:id/mail/logos/:domain`): a colleague (`userId`, only where their domain signed a
  mail) keeps their own avatar; agents have no mail addresses, so none is matched. Anyone else: a
  DiceBear „Glyphs“ seeded by the address (`generatedGlyph`, bundled `@dicebear/styles`, **CC BY
  4.0** – „Abstract Avatars for All Creative Profile Use“ by Matt Houser; credited in `LegalLinks`
  beside Impressum/Datenschutz – keep it there while the style is used), and over it, once loaded (no spinner, no shift; per tab
  remembered in `MailAvatar`'s `logos`), the firm's logo – only where the mail was vouched for
  (`MailPerson.vouched` on `people`, `message.auth === 'pass'`): a spoofed `paypal.com` never
  wears PayPal's logo. The server looks up by the org domain alone (`logoDomain`: no mail
  provider's, not the workspace's own – members', `join_domain`, the person's mailboxes): BIMI
  (`default._bimi.<domain>` TXT, `l=` https SVG ≤ 64 KB), else the start page's
  apple-touch-icon / largest `rel=icon`, `/apple-touch-icon.png`, `/favicon.ico` (≥ 32 px). Every
  hop through `safeFetch`, 10 s per lookup; an SVG with scripts, handlers, entities, `<image>`,
  outside `href`/`url()` is refused (`safeSvg`); everything is drawn anew as a 128 px PNG on white
  (inset where its corners are clear) – no foreign SVG ever reaches the page. Kept in the blob store
  `mail-logos/<domain>.png` (8-byte look-up time + PNG, empty = none): 7 days found, 1 day none;
  one lookup per domain at a time; 400 new lookups per person an hour. Answers 204 for none,
  `Cache-Control: private`. Tests: `ctx.deps.senderLogos` (offline by default in `helpers.ts`;
  swap fakes in with `Object.assign` – the app holds the same object).
- Mail sign-in (`mail/servers.ts` `mailFailure`, presets `MAIL_PROVIDERS` in shared `mail.ts`):
  Microsoft takes no password at all – `outlook.office365.com:993` advertises only
  `AUTH=XOAUTH2 LOGINDISABLED` (imapflow then throws „Login is disabled“ before sending
  anything); its SMTP still offers `AUTH LOGIN` but answers `535 5.7.3` (probed 2026-11-20 with a
  made-up account; Microsoft's own settings page lists OAuth2 only). Outlook.com, Hotmail, Live
  therefore need OAuth – „Mit Microsoft anmelden“ (below); an Outlook address in the form leads
  to that button instead of a password field. A refused check answers 400 with
  `error.mailCheck` (`step`, `serverSays` – the server's reply without tag, password, username,
  IPs, Microsoft's trace); only sign-in replies are passed on, never banners. Probe with a made-up
  account (`openssl s_client -connect host:993` + `a1 CAPABILITY`), never a real one.
- Mail through Microsoft/Google (`mail/oauth.ts` provider table + token store,
  `services/mail-oauth.ts` flow): the login's app and registered redirect URIs
  (`/api/auth/{microsoft,google}/callback`); a state starting `mail.` sends the callback to
  `finishMailOAuth`. The flow lives in memory 10 min, bound to user + workspace + a signed cookie
  `slider_mail_oauth`, used once (a replay gets an error outcome, the token endpoint is not asked
  again); the page reads the end at `GET /mail/oauth/:id` after `?anmeldung=<id>`. PKCE + client
  secret; Microsoft authority = the configured tenant (`common`: work and personal accounts),
  scopes `openid email offline_access https://outlook.office.com/IMAP.AccessAsUser.All
  https://outlook.office.com/SMTP.Send`, IMAP `outlook.office365.com:993`, SMTP
  `smtp-mail.outlook.com:587` STARTTLS for the personal tenant (`tid` 9188040d-…), else
  `smtp.office365.com:587`. Google: `openid email https://mail.google.com/`, `access_type=offline`,
  `prompt=consent select_account` (else no refresh token on a second sign-in), `imap.gmail.com:993`,
  `smtp.gmail.com:465`. Address = the ID token's `email` (Google: only `email_verified`). Refresh
  token sealed in `mail_accounts.refresh_token` (`auth` = provider, `password` empty); access token
  in memory only, renewed 5 min before expiry, one refresh per mailbox at a time, a rotated refresh
  token kept. `invalid_grant`/`interaction_required`/`consent_required`/`login_required` → state
  `signin`, token dropped, sync skips it until „Neu anmelden“ (same address only, `login_hint`).
  imapflow `auth: {user, accessToken}` (XOAUTH2/OAUTHBEARER), nodemailer `type: 'OAuth2'`.
  Export: `signIn` only; deletion cascades. Live check 2026-11-20: Microsoft's authorize page
  with the mail scopes shows the sign-in (only `sErrorCode 16000` = pick an account), Google's
  goes to its identifier page – no AADSTS/redirect error before signing in.
- Google's `https://mail.google.com/` is a **restricted** scope: production needs the OAuth
  consent screen verified by Google plus a yearly CASA security assessment. While the app is in
  „Testing“ only listed test users get in and their refresh tokens end after 7 days (then the
  mailbox asks for „Neu anmelden“). Console: APIs & Services → OAuth consent screen → Data
  access: add `https://mail.google.com/`; Audience: add test users (or publish + verify); the
  Gmail API need not be enabled for IMAP/SMTP. Gmail's app password stays the other way.
  „Mit Google anmelden“ for mailboxes (and their calendars, Calendar API enabled) shows only with
  `GOOGLE_MAILBOXES=true` (`mailOAuthConfigured`, `AuthProviders.mailOAuth`): Google's client alone
  is the login. Google asks not to put unverified scopes before production traffic – off on the
  hosted instance until verified; on locally to record the verification's demo video.
  Off with Google's login set up, the button shows greyed with a tooltip (`GoogleMailPending`):
  Gmail's scope is restricted – its verification needs a yearly CASA audit; app password till then.
- Calls: see „Calls“ below (also calling an agent and the agent that writes along).

## To-dos – „Aufgaben“ in the UI (`services/todos.ts`, `routes/todos.ts`, `features/cloud/components/todos/`)

- Called „Aufgaben“ everywhere a person reads it (side bar, tab, mail button, agents' words,
  `/dateien/aufgaben`); `todo` in code and tool names.
- Linear's issues at their simplest: title, description, status (backlog · todo · in_progress ·
  done · canceled), priority (0 none, 1 urgent … 4 low – 0 sorts last), one person, one agent,
  due date. Numbered per workspace (`#12`, unique index, max+1 with a retry).
- Own (`area_id` null, `owner_id` the person: only they see it, only they can be its person) or
  an area's (`owner_id` null: whoever sees the area; viewers read). Moving drops a person or agent
  who would not see it there. Title, description, source sealed (`encryptedText/Json`).
- Sending an agent (`assigneeAgentId`) starts it at once with the to-do as order (`todoOrder`).
  Own to-do → only one's own private agent; area's → also one shared in that very area (shared
  chats are read by others). Cannot start (no AI, busy) → the assignment is taken back (409).
  Agents never send agents (`NO_SENDING`).
- Tools: cloud agents `list_todos/read_todo/create_todo/update_todo` (`runTodoTool`, shared or
  unattended agents only areas'); MCP apps the same in `mcp-cloud.ts` (person by name/mail/id).
  One line per to-do: `todoLine`; by id or number: `todoByRef`.
- Live: `senderLive` event `{type:'todos'}` to the owner or the area audience → web invalidates
  `todoKeys.all`. Web: overview in Cloud's side bar (`/dateien/aufgaben`, by place, finished folded),
  a tab per area (`/dateien/bereich/:id/aufgaben`, by status in Linear's order). Mail aside „Zu tun“ →
  „Als Aufgabe anlegen“ (own, with the mail as `source`).
- A to-do opens in the side panel beside the page (`TodoPanel` in `CloudLayout`, `?aufgabe=<id>`,
  `CLOUD_TODO_PARAM`), as a file's details (`?datei=`): one panel at a time, each opening clears
  the other's param. Rows (list, area tab, „Deine Aufgaben“ on „Zuletzt“) toggle it; Esc or ✕
  closes, Esc in a field keeps what was typed. It reads the to-do from the overview list.
- Dates: `components/calendar/` – `days.ts` (local `YYYY-MM-DD`, noon dates, Monday weeks),
  `MonthGrid` (the small month: due picker, the header's `DateButton`, the calendar's side).
  The header shows today in Cloud and Sender; the calendar has no side-bar row – a click on the
  date opens it, the pointer resting there shows the small month (a mouse only, no button in it).
- Calendars (`services/calendars.ts`, `/dateien/kalender`): an area's own calendar and one's
  private one are made lazily on the first list (partial unique indexes keep it to one each);
  sub-calendars carry their parent's area/owner, depth ≤ 3. All-day events are stored as UTC
  midnights (end exclusive), sent as `YYYY-MM-DD`. The page (`?ansicht=tag|woche|monat|jahr|
  agenda`, `?tag=` anchor, keys D W M J A, T, ← →): `entries.ts` turns events + due to-dos into
  entries, `CalendarViews.tsx` draws them, `CalendarList` hides calendars/„Aufgaben“ per browser
  (`slider.calendar.hidden:<ws>`); under the head, on the right, „KI zum Kalender“ as „KI zur
  Mail“ (`CalendarAside`, the shared `AsidePart`/`AsideAgent` in `cloud/components/AsidePart.tsx`):
  small month, the AI's „Überblick“ of 7 days and „Vorschläge“ (a click orders an agent with it;
  `POST /workspaces/:id/calendar-overview`, `services/calendar/overview.ts` – kept in memory by a
  hash of what it read, never stored), the calendars, „Nachfragen“ pinned at the foot
  (`slider.calendar.agents`). Folded from the head's last button (`slider.calendar.aside`); below
  lg it lies over the days, not remembered. An event opens in the side panel (`?termin=<id>`, `neu` with
  `neu-tag`/`neu-um`) – one panel with `?aufgabe=`/`?datei=`. Mail accounts' calendars:
  `services/calendar/remote.ts` (CalDAV through `fetchHop`, Google, Graph). Their list
  is kept as calendars of kind `mail` (`calendar/mail-calendars.ts`, `remote_id` sealed: a CalDAV
  URL holds the address), compared every 15 min (a first look waits ≤ 5 s); events are never
  stored, only held in memory 5 min per range. Sign-in asks for calendars beside mail
  (`calendarScopes`: Google `calendar.events` + `calendar.calendars` + `calendar.calendarlist`,
  Graph `Calendars.ReadWrite` – another resource, so `calendarAccessToken` refreshes for it apart,
  falls back to `Calendars.Read` on `AADSTS70000` and never marks the mailbox `signin`). Mailboxes
  signed in before have no consent (`AADSTS70000`, Google 403): no calendars, retried after 12 h,
  until signed in anew („Kalender › Konten“ shows „Neu anmelden“ – the refusal is remembered in
  memory with a hash of the sign-in, so a new token retries at once). Tests:
  `createTestContext({ mailCalendars })`.
- Writing to mail calendars (events and calendars, as one's own – same panel, menu, confirms):
  event ids are `mail:<calendar row>:<provider's id>` (encode them in paths – CalDAV/Graph ids
  hold `/`, `=`); `services/calendars.ts` checks the calendar is the caller's before
  `mail-calendars.ts` asks the provider, and a write drops the held range (5 min) of that
  calendar. What may be done is `calendars.remote_rights` (migration 0163), set at each compare:
  the provider's word (Google `accessRole` + `primary`, Graph `canEdit`/`canShare`/
  `isDefaultCalendar`, CalDAV `current-user-privilege-set`) AND the sign-in's grant – the scopes
  of the last token, held in memory only (`calendarGrant` in `mail/oauth.ts`; Google: one token
  for all scopes, `calendar.readonly`/old `calendarlist.readonly` = read only). Unknown (no token
  yet, password accounts): everything may be tried, the provider refuses. `regrant` shows „Zum
  Ändern neu anmelden“. Someone else's calendar is only taken off one's list (Google
  `calendarList.delete`, Graph DELETE does that for a shared one): „Entfernen“; Google's primary
  and Graph's default can't go. Conflicts: the etag seen (held, `If-Match`; CalDAV `getetag`,
  Google `etag`, Graph `@odata.etag`) → 412 → „Der Termin wurde inzwischen woanders geändert.“,
  the range read anew. Occurrences of a series: Google/Graph instance ids change that one alone;
  CalDAV refuses (RRULE/RECURRENCE-ID or an id `uid/<start>`) – overrides are not written.
  Moving between a mail calendar and another is make-there + delete-here (new id; the panel
  follows it). Graph reads whole days as UTC – rounded to the nearest midnight; written at
  midnight `Europe/Berlin`. Graph colours are names: recolouring refused.
- An account's uses come and go apart (Anmeldung, Post, Kalender): one `mail_accounts` row per
  address per workspace, `calendar_only` = no mailbox, `with_calendars` (migration 0164) = its
  calendars stand in the calendar; the login is `user_identities`, matched only by provider +
  address. „Microsoft/Google Kalender verbinden“ on „Konten“ (`calendarOnly`, offered where the
  provider's login client is set up – `calendarOAuth`, no `GOOGLE_MAILBOXES`): only `openid email`
  (+ Microsoft `offline_access`) + the calendar scopes, so Microsoft's code is traded for Graph's
  token straight away (held under `<id>#calendar`, `holdCalendarToken`); refused at finish
  without calendar rights. Google always asks `include_granted_scopes`, so adding one use keeps
  the other. Removing calendars (`DELETE /mail/accounts/:id/calendars`): `with_calendars` off,
  calendar rows dropped, never read or written (`mailEvents`, `writing()` → 404); calendars
  alone → the row goes. Removing the mailbox (`DELETE /mail/accounts/:id`) with calendar rows:
  the row turns `calendar_only`, mails/threads/uploads and folders dropped, hosts and password
  kept (CalDAV); without calendars the row goes. On again: `POST …/calendars` turns them on if
  the sign-in reads them (Google `calendarGrant().events`, Microsoft a Graph token) else
  `{signIn:true}` → the client starts `calendarOnly` + `accountId`; `POST …/mailbox` for password
  calendars alone (servers checked again), OAuth ones start the mail sign-in with `accountId`
  (mail + calendar scopes). Signing in for one use with an address that has the other joins that
  row; a password mailbox added for the address of password calendars alone joins it too. Every
  mail path still skips `calendar_only` (`listMailAccounts`, `ownAccount` – only delete takes it –,
  sync, `sendQueued`, address book, logos); `GET /workspaces/:id/calendar-connections` lists it
  (`signIn` google/microsoft/password); renamed by `PATCH /mail/accounts/:id` with `label` alone.
  `GET /me/mail-accounts` lists every workspace's rows with their uses for „Verknüpfte Konten“.
- „Konten“ (`/dateien/kalender/konten`, „Konten“ at the calendar's top right as „Postfächer“ in Post;
  `CalendarAccounts.tsx`): every account with calendars – mailboxes with calendars or a refusal,
  calendars alone – state, „Auch Postfach“/„Auch Anmeldung“ in its line, „Neu anmelden“,
  „Umbenennen“ (the mailbox's `label`, shared with Post), „Postfach hinzufügen“ (calendars alone),
  „In Post verwalten“, „Entfernen“ (its calendars; the mailbox stays). Below, dimmed, mailboxes
  whose calendars are off with „Verbinden“. Post › Postfächer mirrors it: „Auch Kalender“/„Auch
  Anmeldung“, „Kalender verwalten“, „Entfernen“ (the mailbox; calendars stay), calendars alone
  dimmed with „Verbinden“. „Entfernen“ everywhere here: the link goes, the account at the
  provider stays. `/konto` „Verknüpfte Konten“ (`LinkedAccountsSection.tsx`, only once a mail
  account exists): one row per provider + address with its uses, the menu leads to Post/Kalender
  of each workspace and „Anmeldung entfernen“ (not the last login). Sign-ins return to the page
  they started on (`useCalendarOAuthOutcome` toasts). The side list only groups: an account's
  calendars under its `label` or address (`useCalendarAccounts` – no group until mail accounts and
  connections loaded, never a made-up name), a quiet key to „Konten“ when signed out or read-only.
- AI tools `list_calendars/list_events/create_event/update_event/delete_event`: definitions in
  `calendar/agent-tool-defs.ts` (kept free of service imports – `APP_TOOLS` is built at load and
  `calendars.ts` → `sender` → agents is a cycle), run by `calendar/agent-tools.ts` for apps/the
  chat (`mcp-cloud`) and agents (`areasOnly`: shared/unattended agents see areas' calendars only).
  Times in and out are Europe/Berlin; a whole-day `end` is the last day, inclusive.

## Calls – audio, video, screen (`services/calls.ts`, `routes/calls.ts`, `features/calls/`)

- Written down: with a `live` key each tab streams its mic to Mistral realtime; without one (or the
  service away) `CallListener` cuts turns at pauses and posts each as WAV to
  `POST /calls/:id/heard?peer=` (multipart `audio`), transcribed by the workspace's voice/speech key
  (Whisper works) – so agents and notes hear without Mistral. No key: one toast per call.
- Every conversation can call: the header of `ChannelPage` (Sender and Cloud's chats alike)
  has „Anrufen“ / „Videoanruf“ (`CallButtons`), „Beitreten“ with the faces while one runs there,
  „Im Anruf“ while one is in it. Direct and group conversations ring their people (45 s,
  `CALL_RING_MS`); an area's or `#channel`'s call is a meeting – it rings nobody, whoever sees the
  conversation may join. One person is in one call at a time (joining elsewhere leaves the
  other, also another tab's). A direct call ends when one hangs up; every call ends empty,
  declined or unanswered („Anruf beendet“ / „Anruf abgelehnt“ / „Niemand hat abgenommen“).
- From everywhere: `CallProvider` sits in `App.tsx` around the router (not in a route), so it
  rings and the call goes on on every page of every app (d/, t/, r/ too) while one navigates in
  the page. It reads `/me` only from the cache (`skipToken`) – it never asks itself and never
  sends a signed-out page to the login; popups (`window.opener`) skip it. The incoming card and
  the dock stand bottom right, 72 px up (Sender's composer stays free); „Vergrößern“ fills the
  window, a shared screen shows large first. Ring and ringback are made by WebAudio
  (`lib/sounds.ts`), a system notification when the window has no focus and may.
- On the called agent's own page in Cloud (one's own call with it) the call is no dock but the
  first card beside its chat, its orders the next one (`CallBoxes`, the same `CallDock` /
  `CallOrders` with `place="box"`); the page `host`s the call so the corner's dock stands back,
  and the cards column scrolls as a whole (the desk then as long as it is). On a phone those two
  cards go above the chat. „Vergrößern“ still opens the window-wide dock (the card then plays no
  audio – the dock does).
- Media: WebRTC mesh (`lib/mesh.ts`), one `RTCPeerConnection` per other tab, at most 8 people
  (`MAX_CALL_PEERS`; a bigger meeting would need an SFU). Each connection has three fixed
  transceivers – audio, camera, screen – so turning one on or off is only `replaceTrack`, never
  a new offer. Only the newcomer offers (to the server's `connectTo`); the offerer restarts ICE
  on `failed`. Who speaks: an `AnalyserNode` per voice (`lib/levels.ts`), the tile rings green.
- Signalling: a stream per tab (`GET /api/calls/live?peer=<id>`, the id is new per page load)
  says the calls one sees (`hello`, `call`, `ended`) and the signals for this tab alone;
  `POST /calls/:id/signal` relays offer/answer/candidates only between tabs of that call (from
  must be one's own tab). The hub is in memory – a restart of the API ends all calls; several
  API processes would need a shared hub.
- Leaving without hanging up: Bun notices a closed stream only when it writes to it – the
  stream pings every 10 s and a gone tab leaves 12 s after (`GONE_AFTER_MS`). A tab closed or
  loaded anew hangs up itself on `pagehide` (`keepalive` request). Vite's dev proxy does not
  close the API's stream when the browser goes: in dev only `pagehide` and the ping catch it, a
  hard-killed browser (Playwright's `browser.close()`) leaves its tab in the call until then.
- Networks: `CALL_ICE_SERVERS` (JSON list of `RTCIceServer`, `stun:`/`turn:` URLs, checked at
  start). Default none: calls work on the same network and localhost only; across NATs a TURN
  server (coturn) is needed. The stream's `hello` (every open page) carries only the `stun:`
  entries; TURN credentials come only with `CallJoined`. With `CALL_TURN_SECRET` (coturn
  `use-auth-secret` / `static-auth-secret`) each joiner gets their own: username
  `<expiry s>:<userId>` (12 h), credential base64 HMAC-SHA1 – the list's static ones are only
  the fallback without it.
- No recording (no audio or video is kept). Written along only where notes are on
  (`callNotes` and live/AI keys, below): then every turn is transcribed and the agent writes
  notes from it – the call shows „Wird mitgeschrieben“.
- Desktop: `tabs.mjs` answers `getDisplayMedia` with the system's picker where there is one
  (macOS 15+, `useSystemPicker`), else the first screen; the packaged mac apps carry the
  microphone/camera entitlements and `NSMicrophoneUsageDescription`/`NSCameraUsageDescription`
  (without them macOS never asks and the tracks stay silent).
- Looking at it: scratch API + Vite on own ports (see Sender); Chrome with
  `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream` and context permissions
  `camera`, `microphone` gives each browser a moving test picture; `--auto-select-desktop-capture-source=Entire screen`
  answers screen sharing. Two browser contexts (the second with a seeded session cookie) call
  each other; check `video.videoWidth` > 0 on both sides.
- Agents in calls (the user's call 2026-11-19): every tab writes down only its own person –
  `lib/listener.ts` takes the call's mic track to 16 kHz into `LiveTranscript` (Mistral realtime,
  token from `POST /calls/:id/live`) and posts each turn to `POST /calls/:id/transcript`. Loaded
  only while the call has `notes` or `agent`. Turn end (2026-11-20): the call's `LiveTranscript`
  asks for Voxtral's `turn_detection` (aggressive preset; only when an `onSignal` is given –
  Viewer/Writer voice unchanged). At `turn.end` the listener flushes and cuts once the text since
  the last turn ends in `.?!…` or at `transcription.done`, at most 1.2 s; without turn events it
  falls back to 0.5 s quiet + flush. Traps, measured with a probe: `turn.end` comes 420–860 ms
  after speech end, but its last words can come after it (0–60 ms in the probe, more in the
  browser) – cutting on „no new words for 200–350 ms“ split „Hauptstadt von | Australien?“. A
  flush ends the realtime session (`session.created` follows); `transcription.done` ~450 ms after
  it. Without turn detection words lag 0.7–1.2 s behind speech.
- Notes („Notizen in Anrufen“, KI tab, `workspaces.call_notes`, default on): a call has `notes`
  when the setting is on and the workspace has a `live` and an `ai` key (`notesIn`, decided at
  the call's start). When it ends with ≥ 25 words, `afterCall` → `services/call-notes.ts`
  creates a Cloud agent as the starter (else the next member), unshared, in the conversation's
  area; its order holds the transcript and tells it to `post_message` notes/tasks (@Vorname)
  into the conversation. Measured with Claude: ~10 s, clean notes with an @mention.
- Calling an agent: `POST /cloud/agents/:id/call` (who may write to it, needs `live`, else 409)
  – a call of one's own (`place` `agent:<agent>:<user>`, `channelId` empty, nobody rings). An own
  agent call is the one with an empty `channelId` – check that, not `call.agent`, for title,
  link, camera and screen buttons. Where the `live` key is Mistral, each turn is answered by the
  fast voice path (`services/call-voice.ts`, below); else it goes into the agent's chat
  (`messageCloudAgent`) and the hub polls `getCloudAgent` for the finished reply (seconds).
- The fast voice path (2026-11-20, `speak` in `calls.ts`): `mistral-small-latest` streamed
  (`streamChat`, metered `live`) with a short German prompt (`voiceSystem`: per du with first
  names, one or two sentences, digits – it said „360 Tage“ and „Herr Hofmann“ before), its last
  16 turns, who is there, the agent chat's summary and the call's orders. Work goes through the
  tool `auftrag_vorschlagen` → `call.orders` (`proposed`, confirm first as before); no text but an
  order → „Soll ich „X“ losschicken?“. The answer is cut into parts as it streams (`speechCut`:
  after `.!?…` + space, not after digits or abbreviations; the first part also at `, ; : –`
  after 60 chars) and each part becomes a `say` at once. Each turn is kept in the agent's first
  chat afterwards (`noteCallTurn`, not while the agent runs). `warm` (on call/bring-in/first
  turn) loads the live key, the voice list and the chat summary ahead – the first answer was
  ~0.8 s slower cold. Not a word after 700 ms (about one turn in ten): a cached „Moment.“ is said
  meanwhile (`ACK`, made once per call, not in the history).
- Bringing an agent into a conversation's call: ✨ „Agent dazuholen“ in the dock (agents one may
  write to) → `POST /calls/:id/agent` (same rights and `live` 409 as calling it; `invitedBy`;
  it works with the inviter's rights), ✕ on its tile → `POST /calls/:id/agent/leave` (anyone in
  the call). It answers only turns matching `CALL_AGENT_ADDRESS` (`\bagent(in)?\b`, not
  „Agentur“); the message carries who is there plus the lines since it was last asked
  (`heardFrom`, at most 40 lines / 8000 chars), ending „<Name> zu dir: …“. Measured with Claude:
  „Agent, wann ist laut uns der Launch?“ after „Launch ist am dritten März“ → right answer in
  ~2 s. The live token always carries „Agent“ as a key term.
- Its voice: where the `live` key is Mistral, `say` has `voice: true` and a `sayId`; the hub
  starts `speechStream` (`POST /v1/audio/speech`, `stream: true`, SSE `speech.audio.delta` with
  base64 WAV – 16-bit, 24 kHz mono, a header per generation; German preset Heidi, metered
  `voice`) the moment the part exists and keeps its chunks for every tab (last 12 parts). Each
  tab fetches `GET /calls/:id/says/:sayId?peer=` as soon as `say` arrives (`fetchVoice`) and
  `speaker.ts` schedules the PCM gaplessly through Web Audio (one `AudioContext`, woken in the
  click that joins – `wakeVoice`); a part resolves 150 ms before its end so the next follows
  without a gap (measured: 0 gaps over 3 parts). Audio failed before its first byte → 502 → the
  tab reads the part with `speechSynthesis`.
- Which voice: each person's own (`users.call_voice`, `/einstellungen` „Anrufe“,
  `CallVoiceSection`, `/me/call-voice`) – the agent speaks in the voice of `call.agentBy`, who
  called it or brought it into a group's call (user's call; reset with `call.voice`/`call.ack`
  when another brings it). Picked from the live key's `GET /v1/audio/voices` of the first of the
  person's workspaces whose live key is Mistral (presets and the account's own, German first –
  only Heidi is German, but every preset speaks German, with its accent; checked by transcribing
  samples back; presets' slugs are the same on every key). Unpicked: the first German one. Read
  once per call (`voiceOf`, `AiConnection.speechVoice`). Samples (non-streamed `/audio/speech`)
  are kept in memory per key and voice. The workspace column of 0139 is dropped by 0140.
  Picked as „Sprache“ → „Stimme“ → „Stimmung“ (`call-voice-choices.ts`): 66 presets in 22
  languages (`fr`/`fr_fr` and `en_GB`/`en_gb` are one), a speaker's moods („Paul - Sad“) one entry
  with a „Stimmung“ row only where it has several (plain first, then Neutral). Each change saves
  and reads the sample – German for all on purpose: the call's agent always speaks German.
- Talking over it (barge-in): the listener stays on while the agent speaks. One's own voice louder
  than 0.05 RMS (echo cancelling leaves the agent's below that; normal speech gate 0.02) for 160 ms
  (a leaky counter: a dip takes off a quarter of its length) stops it: the tab hushes at once, drops
  the answer's later parts and posts `POST /calls/:id/hush {peerId, heard}`; the server aborts the
  stream and the speech, publishes `hush` (every tab stops) and keeps only the parts heard up to
  `heard` + „… (unterbrochen)“ in the history. While the agent speaks and nobody talks over it, what
  the transcription hears is dropped (echo guard); talking over keeps the words of the last 800 ms.
  Mic blocks are 2048 samples (~43 ms). Measured (fake mic, 2 runs): talking start → silent here
  224–267 ms, `hush` in all tabs 232–283 ms; a bare „Stopp,“ (~130 ms loud, then a pause) stops it
  only with the next words (~1.05 s).
- Measured 2026-11-20 (10 German questions, real Mistral; server = transcript post → event,
  browser = speech end in a fake-mic Chromium → first sound): before – Cloud agent polled, MP3
  per answer – `say` 2.17 s median / 2.89 s p95, audio 3.01 / 4.63 s after the post, first sound
  ~4.6 s after speech end. After – `say` 0.44 / 0.76 s, first audio byte 0.76 / 1.12 s; turn
  handed over 0.75–0.99 s, first sound 1.59–1.72 s median, p95 2.0–3.1 s (3 runs). The floor is
  Voxtral's turn end (~0.75 s) + Mistral Small's first sentence (~0.45 s) + TTS first byte
  (~0.3 s); ≤ 1.2 s would need a speculative start on `turn.eager_end`.
- Orders from a call (the user's call 2026-11-19: confirm first, said or with a button): the agent
  in a call (own or brought in) is told (`ORDER_HOWTO`, on the first turn of an own call, in every
  message of a brought-in one) not to do longer work in the call but to propose it as a line
  `AUFTRAG: <Titel> | <Auftrag>` (the fast voice path: the tool `auftrag_vorschlagen`). `ordersIn`
  takes those lines out of its answer into `call.orders` (`proposed`, at most 20); nothing is sent
  until someone agrees: ✓ „Losschicken“ / ✕ „Verwerfen“ in the dock's „Aufträge“ (`POST
  /calls/:id/orders/:orderId {send}`), or a short turn `replyTo` reads as yes/no – in a
  conversation's call only a clear one („schick los“, „bestätigt“) or one to the agent („Agent,
  ja“), since people say „ja“ to each other; in an own call a plain „ja“. A yes/no turn is not
  passed to the agent. Sent = `createCloudAgent` with the agreeing person's rights (in the call's
  area, else outside it); the hub polls it every 3 s while the call runs (`running` + `doing` →
  `done`). The notes agent gets the sent orders listed so it does not send them again. Cloud agents
  rename themselves with `name_chat` – the howto tells them not to, else the called agent took the
  order's name. Measured with Claude: proposal ~4 s, a memo agent done in ~21 s.
- Correcting a waiting order (the user's call 2026-11-20: „Ja, und nenn ihn Test 2 Bereich“ gave a
  second, identical order): a correction is the same order, changed (`propose`: same id, new
  title + text). The model names it – tool field `ersetzt` / line `AUFTRAG: … | … | ersetzt:
  <alter Titel>` – and the voice prompt lists the waiting orders' text; the server also takes a proposal
  under a waiting order's title (Mistral Small re-proposes the waiting one beside a new one) and,
  with one waiting, any `ersetzt`. A yes/no with a change („Ja, nenn es …“, „Nein, lieber …“;
  `replyTo`'s change words) is not a yes: it goes to the agent, which amends and asks once more.
  Measured with Mistral Small (8+6 runs): amended in place every time; a different order while one
  waits stays a second order in 7/8 (once a renamed re-proposal without `ersetzt` doubled it).
  The prompt said „ersetzt = <Titel>“ first – titles then came out as „X = Name“.
- The agent that writes along answers too: in a call with `notes`, a turn „Agent, …“ with no
  agent in the call `wake`s it – a Cloud agent made then as the speaker (call area, else none),
  titled like the notes („Notizen: Anruf in … am …“), shown as the call's agent (✕ sends it
  away, the next „Agent, …“ brings the same one back). `call.notesAgent` → `EndedCall.notesAgent`:
  `writeCallNotes` messages that agent instead of making a second one. Measured with Claude:
  answer ~2 s, notes by the same agent naming the order already sent. It is its maker's private
  agent (in a group or direct call): the others in the call ask it through its maker (`ask`'s
  `through`), `confined` to posting into the call's conversation – never with the maker's tools.
  Everything said before a question goes along marked „Gesagtes, kein Auftrag an dich“ (also the
  stored protocol); `heardFrom` moves only once a question is taken (a refused one keeps it), a no
  is said once a minute per person (`refused`), `mayAsk` keeps only real answers.
- Who sees a conversation's call is asked anew (`freshen`) when older than 5 s at the next event
  and before every stream's `hello`: one taken out is sent `ended` and `leave`s with every tab.
  At once too when someone may have been taken out – `leaveGroup`, `setAreaMembers` (someone
  gone), `updateArea` (visibility), `removeMember` call `audienceShrank(workspaceId)`
  (`call-audience.ts`, weak registry of the hubs) → `CallHub.freshenIn` – a quiet P2P call
  keeps nobody who left.
- A wrong Mistral key is marked broken on its first refused token (401) – after that `live` is
  off (notes off, agent calls 409). In a scratch check with a placeholder key, route
  `**/api/calls/*/live` to `null` in Playwright and stub `speechSynthesis` (headless Chromium
  has no voices: `onend` fires at once or never; `speak` gives up after the reading time).
- `leave()` waits ~0.7 s so the last turn lands before the call ends; `leaving` keeps the call
  id so a `pagehide` in that window still leaves (else a ghost through Vite's proxy).
- Calls that are over are kept (`call_records`, `services/call-records.ts`, migration 0143) where
  they were written down (an agent in it or notes on – `call.record` fills only then) and
  something was said: people's turns from `heard()`, the agent's from `say()` (an answer's parts
  in one turn, its „Moment.“ not; `hush()` cuts it to what was heard, „… (unterbrochen)“), the
  orders sent. `CallHub` hands it over in `end()` (`keep`, wired in `app.ts`). One's own call
  with an agent is ONE `cloud_agent_messages` row (`call_id`, `keepCallInChat`) instead of a
  message per turn – its text is the agent's memory of the call (later runs read it as its own
  turn), the chats show the entry (`CloudAgentMessage.call`, `CallEntry`) and the page
  (`…/agenten/:id/anruf/:callId`, Sender `…/agent/:id/anruf/:callId`). A conversation's call is
  ONE `sender_messages` row too (`call_id`, migration 0144, `keepCallInConversation`), authored
  by who started it, not editable or deletable, opening `…/kanal/:id/anruf/:callId` (Sender
  `CallPage` serves both); an agent brought in keeps `noteCallTurn` per turn in its chat. Unread:
  no news to who was in it – a sender entry is skipped when `call_records.person_ids` has the
  reader, an agent-chat entry when its `user_id` is the reader (`unreadOf`, `agentUnread`,
  `sender-news.ts`); others count it once like a message. Notes: `runToolCall` (`anruf_notizen`, feature `summary`) once in the
  background, links = orders' agents, the call's area, names said resolved with the starter's
  `searchNodes` – filtered per viewer in `GET /calls/:id/record` (404 for who doesn't see the
  conversation/agent). `notesState` 'pending' left by a restart is written on the next open.
  Export `anrufe.json` (own words + notes), deletion anonymises (`anonymiseCalls`). In a scratch
  check `page.route` the agent's GET (add a message with `call`) and `/api/calls/*/record`.

## Hosted instance – office.bertro.dev, formerly slider.bertro.dev

- Moved with 1.7: `SLIDER_DOMAIN=office.bertro.dev`, `SLIDER_OLD_DOMAINS=slider.bertro.dev` in
  the repo variable `DEPLOY_SETTINGS` (a key there wins over the `DEPLOY_ENV` secret's line,
  `deploy.yml`). On the old host Caddy 308s browser page loads only (GET/HEAD, `Sec-Fetch-Mode`
  navigate or none, `/api/*` only when navigate; never `/.well-known`, never `Electron/` in the
  User-Agent); the rest is proxied as before. Measured with a local caddy and curl per kind of
  client; the API needs no setting for it (same-origin pages, bearer tokens, MCP tokens do not
  look at the host).
- Old clients on slider.bertro.dev: desktop apps ≤ 1.6 (Electron) keep their pages there – their
  windows refuse any other origin and their cookie is for that host; only Slider updates itself,
  Cloud/Reader/Sender/Writer must be installed anew. From 1.7 every app moves a session, links
  and tabs kept for the old host to the new one (`desktop/hosted.mjs`, `movedServer` in
  `@slider/shared`, `CloudSync.followMove`). MCP clients go on with their tokens there (refresh
  idle 180 days); a new connection should use office.bertro.dev – the old host's metadata names
  the new resource. Not on the old host: sign-ins through Google/Microsoft started in an old
  desktop window (state cookie on the old host, callback on the new), passkeys (rpID = host;
  made on slider.bertro.dev they work nowhere now – the login page offers the other ways), a
  browser's session (sign in again).
- Keep registered while the old host lives: DNS of slider.bertro.dev (Cloudflare, proxied) and
  its old redirect URIs at Google/Microsoft beside the new ones. Cloud connections (Slider as MCP
  client) registered with the old callback register anew on their next sign-in.

## Desktop app (`desktop/`)

- Electron shell around the self-hosted setup: `main.mjs` has the staged Bun API
  (`apps/api/src/supervisor.ts`) started with `NODE_ENV=production SLIDER_DESKTOP=true` – as a
  service of its own, see „One service per computer“ – and loads the web app it serves. Not a bun workspace: own `package.json`/`bun.lock`. From the root `bun run desktop` installs,
  stages and starts it (`bun run open` in `desktop/` starts the last stage without building).
  Started from the repo it runs a clone of Electron.app named `node_modules/.slider-dev/Slider.app`
  (`scripts/dev-name.mjs`): the Dock takes the bundle folder's name, the Info.plist alone is not enough.
- `SLIDER_DESKTOP`: dev login allowed in production, `HOST` defaults to and must stay loopback,
  the owner is instance admin (AI keys via the normal Integrationen page), unused accounts never
  deleted. The Electron env is clean (no shell variables, no `.env`) – Bun loads `.env` from its
  cwd, so testing the API from the repo root picks up the dev logins and turns dev login off.
- Sign-in to a Slider server (BER-201, like Figma): „Anmelden“ → local `POST /desktop/cloud/start`
  (PKCE) → system browser on `<server>/desktop-anmelden` → `POST /auth/desktop/code` (signed,
  5 min, taken once) → `slider://auth?code&state` → Electron `open-url` → local
  `/desktop/cloud/finish` trades it at `<server>/api/auth/desktop/token` for a session token, kept
  sealed in `<dataDir>/cloud.json`. Server like Bitwarden: „Anmelden“ goes to the one signed in to
  last (kept in `cloud.json` after signing out, too), else `SLIDER_CLOUD_URL` (default
  office.bertro.dev); „Anderer Server“ on /konto sends `{ server }` – origin only, https unless
  loopback, `/api/health` must answer `ok` – and it counts once the sign-in finished. Another
  server starts the links (`cloud-sync.json`) afresh. Dev: `SLIDER_CLOUD_URL=http://localhost:5173
bun run desktop`, or type `http://localhost:5173` there. `slider://`
  from `electron .` registers the dev Electron; the real test is the packaged app.
- Signed in, the account's holdings live here as copies (`services/cloud-sync.ts`, a pass every
  15 s, after sign-in, on „Jetzt synchronisieren“ = `POST /desktop/cloud/sync`): workspaces and
  decks new/deleted on one side follow on the other (this machine's „Mein Workspace“ merges into
  the account's first writable one); local edit steps go up as their operations
  (`/edit/operations`, `clientEditId` `desktop:<step id>`, server's `applyWhatFits`); steps that
  aren't plain operations (revert, AI, pictures uploaded here) go up as a new version
  (`/revisions`); server changes come down via `GET /decks/:id/file` → `importUpload`. Links in
  `<dataDir>/cloud-sync.json`. Offline the pass stops at the first request, steps wait as local
  `deck_edits`. „Abmelden“ pushes first (refused offline), then works like iCloud: decks brought
  from the server (`origin: 'cloud'` in the link) are deleted unless marked „Auf diesem Computer
  behalten“ (`keep`, deck menu + chip on the thumbnail, `PUT /desktop/cloud/decks/:id/keep`, `CloudStatus.cloudDecks`);
  decks made here (`origin: 'local'`) always stay. Their links stay `detached` (workspace links
  are dropped – rematched by name): the same account signed in again joins them to their server
  decks, a side deleted meanwhile only drops the link. Links from before `origin` existed get it
  from which side's `createdAt` is younger. A missing `cloud-sync.json` while signed in is made
  on the next pass. The server dedupes identical bytes per workspace – tests need distinct
  files. Not carried yet: comments, folders, materials, templates, decks without edit rights;
  renames go both ways (here wins when both changed). Electron still sets the server cookie
  (`/desktop/cloud/session`) so server pages opened in the app are signed in.
- Local server guard (`http/desktop-guard.ts`): the Host must be loopback (a page rebound to
  127.0.0.1 got the signed-in owner without a login before) and a request needs the page cookie
  `slider_desktop` (HMAC of the secret, set by Electron on its session after the API answers) or
  the `x-slider-desktop-secret` header; only `/api/health` is open. Plain curl gets 403. Tests:
  `test/helpers.ts` adds the cookie when the config is desktop.
- Live mode (`live.mjs`, `main.mjs` `followConnection`): signed in and the server answering
  `/api/health`, the tabs show the server's pages, live; two misses (checked every 10 s and on
  focus) move them to this computer's copies via the id maps of `/desktop/cloud/session`
  (`decks`, `workspaces` local→cloud, swapped in `/d/:id`, `/w/:id`, `?workspace=`); back online a
  sync pass goes first, then the tabs move back. A deck made offline has no server id yet: its tab
  stays local. The offline switch is not e2e-tested (no safe way to take the dev server down).
- Bridge `window.sliderDesktop` (`page-preload.cjs`: state, openFiles, saveAs, reveal, keep,
  signOut) is answered for this computer's and the server's pages; page deck ids are mapped to
  local ones in main. The web app asks for the bridge (`lib/desktop-bridge.ts`), never for the
  platform. In a Chromium browser without it, `lib/web-files.ts` does „Öffnen …“ / „Als Datei
  sichern …“ with File System Access: handles in IndexedDB `slider-web-files` (gone on sign-out),
  written 1.5 s after the edit `seq` moves and on blur, a newer `lastModified` on focus goes up as
  a new version; after a reload the browser lets Slider write again on the first click or key.
- Files on this computer (`services/local-files.ts`, `<dataDir>/local-files.json`): `fs.watch` on
  the linked files' folders (`.slider` temp files ignored), the DB revision looked at every 1 s,
  the files every 30 s as fallback. A step is written once editing rests 1.5 s, at once on
  `POST /desktop/files/sync` (Electron calls it on blur, focus and quit). The write is atomic
  (temp + rename) and keeps mode and xattrs (Finder tags; `com.apple.quarantine` skipped); a file
  renamed in its folder is found again by inode. An outside change comes in as a new version,
  `changedAt` makes the viewer say so.
- One service per computer (`desktop/service.mjs`, the user's plan of 2026-11-18 for Slider,
  Writer and Cloud as apps side by side): the API is no child of the app any more – started
  detached (own process group, log through a file descriptor), it is used by every app of the
  family and outlives the one that started it. Every app carries the whole service and can start
  it; what they share lies in one folder, `sharedFolder` = `<appData>/Slider` – Slider's own data
  folder, so nothing moved (data, `libreoffice`, `logs`, `port`, `keys.bin`). In it
  `service/apps/<pid>` names each app using the service, `service/state.json` the service that
  runs (pid, port, version, its LibreOffice), `service/lock` is held while one app starts or
  stops it, `service/newest` is the newest release that ran on the data. Rules:
  - The newer service wins (`newer`: version; from the repo `0.0.0` and the stage's time): an
    app finding an older one ends it and starts its own on the same port, the others go on with
    that. One running without LibreOffice makes way for an app that has it, unless that app is
    the older one (`replaces`). An older _release_ does not open data a newer one worked on
    (`refuseOlder`, noted once the newer one answered; repo starts are not counted and not
    refused). The version is the service's: the family's apps count on one line of versions.
  - The last app to go ends it (`leaveService`); with no app left it ends itself after three
    looks of 5 s (`SLIDER_APPS_DIR` → `watchApps` in `apps/api/src/supervisor.ts`,
    `desktop-apps.ts`), and the server ends when its supervisor is gone (`server.ts`,
    `process.ppid`) – killed alone it would hold port and data with nothing to end it.
  - A process is named by id _and_ start (`startedAt` / `processStarted`, the same words on
    both sides): an id alone is given out again, after a restart of the computer to any
    program, and a marker left then kept the service alive for good. macOS: `ps -o lstart=`
    under `LC_ALL=C TZ=UTC` (seen equal from a German locale in Berlin time). Linux:
    `/proc/<pid>/stat` field 22 with the boot id – `ps` works its `lstart` out from the clock
    there, a second apart between two looks or moved when the clock is set (from what is known
    of procps; **the Linux side has not run anywhere yet**). A look that fails (`null`) counts
    as running: it must not clear away a live app's marker. Markers and the lock are written
    whole (beside, then moved or hard-linked in): read half-written they looked left behind.
  - A pid from the state is only ever signalled when it runs `supervisor.ts` (`ps`; Linux:
    `/proc/<pid>/cmdline`). CI runs the check on Linux (test matrix „desktop service“) – look
    there first: it is the only place that side runs.
  - The database bears one process: besides the lock the _server_ – the process that has the
    data open – holds a port of its own from before it opens anything until it is gone
    (`SLIDER_GUARD_PORT` = port + 1000, `holdData`; taken → exit 76). So the lock can fail
    without two services on one data folder, and a server on its way out keeps the next one
    off: `useService` tries its start again (4 × 5 s) before it says the port is taken.
  - An app only uses a service the state names. One that answers on the port without
    (another person's on this computer, another data folder with the same port) is not ours.
  - The app looks every 5 s whether its service answers (`watchService`): gone for three looks
    it is taken or started anew; one that still runs is left alone for two minutes (it may be
    starting); started anew three times in ten minutes Slider says so and ends. Quitting waits
    up to 10 s for a start under way (it holds the lock).
    Check: `bun run --cwd desktop check:service` (real processes on a folder of its own, the
    repo's API without LibreOffice, ~2 min, needs `apps/web/dist`) and api `desktop-apps.test.ts`.
    In the app: start with `SLIDER_USER_DATA=<folder> SLIDER_NO_INSTALLED_LIBREOFFICE=1
SLIDER_LIBREOFFICE_ANSWER=later`, kill the service (back after 15 s), quit (service gone,
    `service/` empty but `apps/`). `service.mjs` is in `build.files` – a file `main.mjs` imports
    and that list lacks only fails in the packed app. Never stage (`bun run desktop`, `app`)
    while a desktop app from the repo runs: its service runs out of `desktop/build/app`.
    So far Slider is the only app using it – Cloud's app has no local API. Open:
  - The keys for a second app. `keys.bin` is encrypted by `safeStorage`, whose key is the
    keychain item `<app name> Safe Storage` (seen: „Slider Safe Storage“, „Cloud Safe
    Storage“) – another app cannot read Slider's without macOS asking the person, so it could
    use a running service but not start one alone. A keychain group shared by the apps needs
    them signed by one team with that entitlement; not built, not measured.
  - With a second app open the service outlives the app it came from: an update swaps that
    app's bundle under it (the next start of the updated app replaces it), and a Linux
    AppImage's mount may go with its app. Not measured.
- Reader's app (`desktop/reader`, scheme `slider-reader`, `bun run reader` / `reader:app` /
  `reader:dmg`, dev clone `--reader`) is Writer's over again: a window on the server's Reader
  pages, no service of its own; home is the PDFs, `/r/:id` a tab, the bar prints, exports and
  closes (`readerDesktop.docBar` ↔ `reader:desktop`, `features/reader/hooks/useReaderDesktop.ts`).
  Other apps' pages go to the browser. No `.pdf` file association: Writer's `.odt` one has no
  `open-file` behind it, so there is nothing to follow. Cloud's app does not hand Reader pages on
  yet (`APP_PAGES` there knows Slider and Writer only).
- Fixed port per install (`port` in that folder, from 47821): the page origin, and with it the
  IndexedDB outbox and service worker, hang on it. `SLIDER_SECRET`/`SLIDER_DATA_KEY` are generated
  once and kept in `userData/keys.bin`, encrypted by the keychain (`safeStorage`, async API).
- `bun run app` = `scripts/stage.mjs` + electron-builder. The stage is built like the Dockerfile
  (production install of `@slider/api` with `--linker hoisted`, sources, web built into the
  stage, the bun binary).
  electron-builder drops symlinks and `node_modules` from extraResources, so the stage is
  dereferenced (`cp -RL`) and copied in by `scripts/after-pack.cjs`. Output
  `desktop/dist/mac-arm64/Slider.app`, unsigned, arm64 (`bun run app`/`dmg` pass
  `-c.mac.identity=null`; the config itself is set up for signing).
- Release (ci.yml job `desktop`, only in the public `Root-Bert/slider` on a `v*` tag, after its
  `release` job): `macos-14` builds the Mac (Apple Silicon only – no Intel build),
  `ubuntu-24.04` / `ubuntu-24.04-arm` Linux x64 / arm64 – never cross-build, `@napi-rs/canvas`
  and the staged bun are per platform. Artifact names are stable, so
  `releases/latest/download/<name>` works: `Slider-arm64.dmg`/`.zip`, `Slider-x86_64.AppImage`,
  `Slider-arm64.AppImage`, `Slider-amd64.deb`, `Slider-arm64.deb` (electron-builder turns
  `${arch}` into x86_64 for AppImage, amd64 for deb). Each build brings its own feed
  (`latest-mac.yml`, `latest-linux.yml`, `latest-linux-arm64.yml`), no merging. The version
  comes from the tag (`-c.extraMetadata.version`). Linux is unsigned and always uploaded; the deb
  maintainer is `author` in package.json. The Mac is signed only when the secrets `CSC_LINK`,
  `CSC_KEY_PASSWORD`, `APPLE_API_KEY` (.p8 contents), `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` are
  set there: hardened runtime with `entitlements.mac.plist` (JIT for V8 and bun, library
  validation off for native addons), notarized, checked with codesign/spctl/stapler, uploaded.
  Without them the app is signed ad hoc (`codesign --sign -`, after a `--dir` build, the DMG then
  from `--prepackaged`) and only `Slider-arm64.dmg` goes on the release – no feed, no zip: macOS
  asks before the first start and installs no unsigned update. (`-c.mac.identity=-` does not do
  this: on a machine with any certificate electron-builder signs with that one.) A deb builds on
  the Mac too (`npx electron-builder --linux deb --x64`, binaries inside are the Mac's – only for
  checking the package); AppImage only on Linux.
- Linux: system window frame with the menu bar hidden (Alt shows it, „Datei“ in place of the app
  menu); LibreOffice is never loaded – found at `/usr/bin/soffice`, `/usr/lib*/libreoffice`,
  `/opt/libreoffice*`, `/snap/bin/libreoffice`, else a dialog says to install it with the package
  manager. `slider://` links arrive as an argument (first start or `second-instance`), not
  `open-url`; the .desktop file registers `x-scheme-handler/slider`. electron-updater updates
  both: the AppImage in place, the deb through `dpkg` behind `pkexec` (asks for the admin
  password; it knows the kind from `resources/package-type`, which electron-builder writes).
- Updates: `updates.mjs` (electron-updater, feed set in code because `--dir` builds have no
  `app-update.yml`), packaged app only, at start and every 6 h, asks „Neu starten“ once loaded,
  Hilfe → Nach Updates suchen; log in `userData/logs/updates.log`. macOS installs only signed
  updates – unsigned builds just log the refusal.
- LibreOffice in the Dock (measured 2026-11-18, LibreOffice 26.8.1, through the real pool):
  `--headless --invisible` does not keep `soffice` out – a fresh worker is in no app list, with the
  first slide it draws macOS lists it as `Foreground` (Dock icon, app switcher), from
  `/Applications` and from a plain-folder copy alike. `LSUIElement=true` in its Info.plist makes
  it `UIElement` (no icon) and it draws as before – but only with the folder signed anew, ad hoc
  (`codesign --force --sign -`): with the Info.plist changed alone macOS ends `soffice` at launch
  (exit 137). codesign refuses any file of ours inside `Contents`. So the desktop app only ever
  starts its own copy in `userData/libreoffice`, hidden this way (`hide`); an installed one is
  copied there at start (`ownLibreOffice`, ~580 MB slimmed, a few seconds) since it cannot be
  changed in place, and is used as it is if that fails. The dev server and a self-hosted Mac
  still show the icons; a server has no Dock. Cloud's app starts no LibreOffice.
- LibreOffice is not in the app (~620 MB without it): `libreoffice.mjs` uses the one loaded into
  `userData/libreoffice`, else `/Applications` or `~/Applications/LibreOffice.app`; with none it
  asks at start and loads a pinned TDF build (version, size and SHA-256 per arch in the file –
  bump all three together, the checksum from download.documentfoundation.org, not a mirror),
  mounts the DMG, copies the app, slims it (805 → ~590 MB). „Später“ starts without; asked again
  next start or Hilfe → LibreOffice laden (relaunches). Its folder is never `*.app`: a copied
  LibreOffice.app hangs at `_dyld_start` – macOS checks a new app bundle before its first start
  and the original's seal is broken (`LibreOfficePython.framework`); ad-hoc re-signing doesn't
  help, a plain folder starts at once. The API's own `findScloud` still finds Homebrew/PATH ones.
- Window = a `BaseWindow` (`titleBarStyle: hiddenInset`, traffic lights at 16/13, tabs from 88 px)
  with the tab bar as a 40 px `WebContentsView` (`tabbar/`) + one view per tab (`tabs.mjs`). Never
  a BrowserWindow with the bar as its own page: that page spans the window and on macOS it (with
  its drag region) took every real click meant for the views over it – Playwright's CDP clicks
  still worked, so only a real mouse shows it. Home
  („Präsentationen“) stays first; a `/d/:id` reached at home opens as a tab (or picks its tab) and
  home steps back – past `/neu` – inside the page, one `history.back()` after the router took the
  last. A tab leaving `/d/` closes and home follows via pushState + popstate. Open tabs are kept
  in `userData/tabs.json` (saved only after start and not while the window closes – views report
  `""` then). ⌘W / ⌘1–9 / ⌃Tab are menu items; the bar follows the app's theme by reading
  `data-theme` once a second. A double click on a tab renames its deck in place (only with
  `permissions.canManage`, read with the title): `tabs:rename` → main PATCHes `/api/decks/:id`
  from that tab's page; refused, the server's title comes back. State arriving while typing waits.
- Tab bar, top right: the deck in front's „Präsentieren“, „Referentenansicht“, „Exportieren“ and ✕
  „Präsentation/Vorlage schließen“ (the deck pill drops them when `sliderDesktop.deckBar`
  exists; ✕ navigates in the page as the pill's did, so the tab closes and home follows). The page reports its offer
  (`DesktopBar.tsx` → `tabs:deckBar`, `null` while presenting / on the material page); a click
  runs in the page as `slider:desktop-bar` via `executeJavaScript(…, true)` – an IPC message
  carries no user gesture, and full screen and the presenter's window need one. A tab's HTML full
  screen (`enter-html-full-screen`) gives its view the whole window and hides the bar – a
  `WebContentsView` keeps its bounds otherwise.
- Theme: Slider opens in the app's last choice (`userData/theme.json`, read off `slider.theme`),
  else the system's (`nativeTheme`); splash and tab bar get it as `?theme=`. The start screen plays
  the web app's logo animations: `scripts/logo-css.mjs` (run by the stage) copies them, the easing
  curves and logo colours out of `apps/web/src/styles/index.css` into `generated/` – rename its
  markers there and the script fails loudly.
- e2e of the shell: Playwright `_electron.launch` with `SLIDER_USER_DATA=<folder>` keeps tests out
  of the real `~/Library/Application Support/Slider`; `SLIDER_NO_INSTALLED_LIBRECLOUD=1` and
  `SLIDER_LIBRECLOUD_ANSWER=load|later` drive the LibreOffice question. Its key presses go
  through CDP, not the macOS menu – check ⌘C/⌘V/⌘Z by hand.
