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
  every hex itself. Open: several themes per template, theme refs in the ODP. Uploaded templates
  bring their theme's ten colours (PowerPoint `clrScheme`, LibreOffice `loext:theme`).
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

## Material page

- A page of its own beside the presentation, not in the track (`board/MaterialPage.tsx`): the
  store's `materialOpen` (`?material`, a new deck via `OPEN_ON_BOARD`); the presentation root
  slides out right (`translate`, `inert`), the page in from the left; the fullscreen target wraps
  both. The minimap's paperclip tile (left of the thumbnails, the bracket never on it) and M open
  it; „Präsentation →“ / M go back. Viewer and editor keys sleep there (`keysActive`), the board
  panel portals into `[data-material-page]` and is no longer one of the deck's side panels.
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
  `edit …` in `list_comments`), `update_presentation` = `updateDeck` (a folder name not there is
  created), `set_access` = `updateDeckAccess` (people by name, address or id),
  `download_presentation` = `exportedFile` (ODP decks only, as on the page; attached as an MCP
  `resource` ≤ 10 MB plus the `/api/…/edit/…` link; PDFs share `aiLimits().pdfs` with the page).
  Templates being designed are refused by the manage tools.
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

## Comments

- The reaction picker in a scrolling panel (`ReactionPicker floating`) is a `popover="manual"` in
  the top layer, tied to its line by CSS anchor positioning – a scroller cuts off anything else.
  In the top layer `:hover` / `:focus-within` on it do **not** count for its DOM ancestors
  (`group-hover/message` goes off under the pointer): it holds itself open with its own
  `hover:` / `focus-within:`.
- Reactions to the AI's answers live in `ai_proposal_reactions` (`services/proposal-reactions.ts`),
  attached in the route, not in `toDto` – other proposal answers come without `reactions`.

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
  the word itself („…“) to keep it, kept in `localStorage` (`accepted-words.ts`).

## Desktop app (`desktop/`)

- Electron shell around the self-hosted setup: `main.mjs` starts the staged Bun API
  (`apps/api/src/supervisor.ts`) with `NODE_ENV=production SLIDER_DESKTOP=true` and loads the web
  app it serves. Not a bun workspace: own `package.json`/`bun.lock`. From the root `bun run desktop` installs,
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
  slider.bertro.dev); „Anderer Server“ on /konto sends `{ server }` – origin only, https unless
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
- Fixed port per install (`userData/port`, from 47821): the page origin, and with it the
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
  Without them it builds unsigned and keeps the DMG as a workflow artifact only. A deb builds on
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
- LibreOffice is not in the app (~620 MB without it): `libreoffice.mjs` uses the one loaded into
  `userData/libreoffice`, else `/Applications` or `~/Applications/LibreOffice.app`; with none it
  asks at start and loads a pinned TDF build (version, size and SHA-256 per arch in the file –
  bump all three together, the checksum from download.documentfoundation.org, not a mirror),
  mounts the DMG, copies the app, slims it (805 → ~590 MB). „Später“ starts without; asked again
  next start or Hilfe → LibreOffice laden (relaunches). Its folder is never `*.app`: a copied
  LibreOffice.app hangs at `_dyld_start` – macOS checks a new app bundle before its first start
  and the original's seal is broken (`LibreOfficePython.framework`); ad-hoc re-signing doesn't
  help, a plain folder starts at once. The API's own `findSoffice` still finds Homebrew/PATH ones.
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
  of the real `~/Library/Application Support/Slider`; `SLIDER_NO_INSTALLED_LIBREOFFICE=1` and
  `SLIDER_LIBREOFFICE_ANSWER=load|later` drive the LibreOffice question. Its key presses go
  through CDP, not the macOS menu – check ⌘C/⌘V/⌘Z by hand.
