# Tests

The suite focuses on failures that can lose data, grant access incorrectly, corrupt a document,
prevent sign-in, or break a complete review workflow. Assertions about CSS classes, icon sizes,
static copy, simple prop forwarding, and the spelling of CI commands have been removed.

The whole repo holds **at most 500 tests** – every Vitest case including each parameterized
variant, plus every Playwright case (Vitest's default static listing does not expand
variants; use the inventory commands below). Add assertions to an existing test rather than a
new case, and merge rather than drop security coverage. Visual parity between edit and review
mode is checked by `apps/web/scripts/live-parity.ts`, which needs LibreOffice and runs outside
the suite.

## What stays covered

- API: sessions and workspace SSO, instance setup, workspace and deck permissions, comments,
  account export/deletion, encryption, safe fetches, upload limits, import and sync, migrations,
  ODP editing and rendering, render-pool recovery, layers, and AI proposals.
- ODP: all document, live-editing, and merge tests. These check persisted files, formatting,
  stable IDs, conflicting edits, and removal of executable content.
- PPTX: archive limits, reading presentations, and stripping external links. The parser still
  feeds imports; the detailed SVG rendering and matching corpus are no longer a separate suite.
  API sync tests retain regression coverage for slide identity and preservation of comments.
- Web: viewer state and preservation of drafts across revisions, optimistic text editing,
  rectangle manipulation, recovery from outdated chunks, navigation away from unsaved work,
  saving drawings, pending comment saves, and link import.
- Shared: source-link recognition and credential handling, plus sync payload contracts.
- Browser: upload, persistent comments/replies, keyboard and mobile navigation, setup-token
  access, production document headers, search, and find within a review.

The container smoke checks, Caddy validation, lint, type checking, build, and secret scan remain
in CI. The former infrastructure tests that searched configuration files for specific strings
have been removed.

## Running tests

```sh
bun run test
bun run e2e
bun run e2e:bundle
bun run e2e:live   # the editor against a real LibreOffice – not in CI
bun run e2e:live:bundle   # the same, production build: a deck reopened offline
```

`bun run e2e:live` (`e2e/playwright.live.config.ts`, specs in `e2e/live/`) runs what the default
suite cannot see, since it turns LibreOffice off: the editor itself. `flicker.spec.ts` records a
CDP screencast of each edit until the slide is LibreOffice's picture alone again and probes
every frame: a moved shape never shows at its old place once it showed at its new one, a new
fill or grown part stays once shown, an untouched element never blinks, typed text never
vanishes, a new background never falls back to the old, a gradient fill or a picture's part
chosen never shows the look before once the new one did, typed text shows once (no picture of
it under the editor's), „Wie im Master“ shows the master's background in the first frame. A
moved box the browser draws must be at its new place in the first frame after the release (it
prints how long that took), and a gradient's end dragged over the slide (the background's, a
turned box's) must be followed while dragged and change nothing once let go. Offline, a box moved, undone and redone shows each at once, and back online the server has it where it ended. Run it after
touching the editor's drawing (`editing/compose/`, `SwapImage`, `shown-pictures`, the preview
layers, `useSlidePicturesReady`, `toLayerBytes`). It
needs `soffice` (`LIBREOFFICE_PATH`, else the macOS app) and uses ports 28787/25173. A failure
prints each frame's colour at the point and what every animation frame drew over the slide.
Together with `live-parity --compose` (per element, see CLAUDE.md §1) it guards the per-element
editor.

Its second test, „two editors see each other at once“, opens one deck in two tabs (A and B – the
editor tells tabs apart as people) and probes B's frames while A edits: A's move on B (ten of
them, p50/p95 printed from A's release – B usually has it by then from A's live drag), A's drag
seen on its way, A's pick framed with A's name, a move and a recolour at once (both stay, on
both screens and in the file), one property set by both at once (both screens end on the
server's winner and never flip back), B's own drag under A's recolour (never back at its old
place, the new colour on it), both typing in one text box while one takes the bold off (both
screens and the file the same, the words not interleaved), and slides copied, moved in front of
B's and deleted by A – in B's overview at once with B's own refetch held back, B's slide staying
where it is on screen. A slide deleted while its layers were asked for answers 404 (allowed).

`bun run e2e:live:bundle` builds apps/web and lets the API serve it (`E2E_BUNDLE=1`), so its
service worker runs: `offline.spec.ts` opens a deck in Bearbeiten twice online, has an element
LibreOffice draws moved elsewhere, goes offline and reopens it – composed from what the worker
kept, that element at its new place – moves, undoes and redoes a box, and back online the server
has it where it ended – and offline the pause detector (speaking to the AI) is not loaded ahead
(no `loading model file /vad/…` error).

Pushes to `main` and pull requests run every remaining Vitest project, including `odp`.
The API suite is split across three runners using `scripts/api-test-group.ts`; the other
projects share one runner. Browser tests run against both the development server and production
bundle. The existing path filters can skip CI for website/brand-only changes.

The additional Postgres job runs only `apps/api/test/postgres.test.ts`: migration idempotency,
queries through the production driver, upserts, counts, and transaction rollback. Business
behavior runs once with PGlite rather than repeating the entire API suite on Postgres.
For the database-specific checks locally, set `TEST_DATABASE_URL` to a disposable database on
a test Postgres server and run:

```sh
bun run test --project api apps/api/test/postgres.test.ts
```

For an expanded inventory (including each parameterized case), use:

```sh
bunx vitest list --no-staticParse --json
bunx playwright test -c e2e/playwright.config.ts --list
```

Prefer a test at the lowest layer that can observe the real failure. Add a browser test when
only the complete browser/server workflow can expose the issue. Retain regression tests for
lost edits, access boundaries, corrupted documents, and concurrency bugs; avoid duplicating
all their variants in component tests.
