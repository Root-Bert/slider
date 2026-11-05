# Tests

**At most 500 tests in the whole repo** – every Vitest case incl. each parameterized row, plus
every Playwright case. Add assertions to an existing test; merge rather than drop security
coverage. Test at the lowest layer that sees the real failure; keep regression tests for lost
edits, access boundaries, corrupted documents and concurrency.

## Commands

```sh
bun run test               # all Vitest projects (CI: API split in 3 via scripts/api-test-group.ts)
bun run e2e                # Playwright, dev server
bun run e2e:bundle         # Playwright, production bundle
bun run e2e:live           # the editor against a real LibreOffice – not in CI
bun run e2e:live:bundle    # same, production build + service worker (deck reopened offline)
bunx vitest list --no-staticParse --json                     # inventory incl. each variant
bunx playwright test -c e2e/playwright.config.ts --list
TEST_DATABASE_URL=… bun run test --project api apps/api/test/postgres.test.ts  # disposable Postgres
```

- Edit ⇄ review parity: `cd apps/web && bun --tsconfig-override=tsconfig.app.json
scripts/live-parity.ts --sample [--compose]` (needs LibreOffice, outside the suite; plain
  `bun apps/web/scripts/...` fails on the `@/` alias).
- `e2e:live` (`e2e/playwright.live.config.ts`, specs `e2e/live/`) needs `soffice`
  (`LIBREOFFICE_PATH`, else the macOS app), ports 28787/25173. `flicker.spec.ts` probes every
  screencast frame of each edit (nothing jumps back, blinks or goes blank) plus „two editors see
  each other at once“; `offline.spec.ts` (bundle) reopens a deck offline. Run it after touching
  `editing/compose/`, `SwapImage`, `shown-pictures`, preview layers, `useSlidePicturesReady`,
  `toLayerBytes`. A slide deleted while its layers were asked for answers 404 (allowed).

## Seeing the editor in a scratch e2e

The default e2e sets `LIBREOFFICE_PATH: '/nonexistent/soffice'`, so the editor never opens.

- Copy the config with `/Applications/LibreOffice.app/Contents/MacOS/soffice`, own ports and data
  dir, a longer timeout; run a scratch spec; delete both after.
- `POST /api/decks/blank` gives an editable ODP (new element ids match `^sl[a-z0-9-]{4,60}$`);
  enter edit mode via `getByRole('radio', { name: 'Bearbeiten' })`.
- Screenshots: `E2E_SHOTS=1 E2E_SHOTS_DIR=<dir>`.
- Measure editor speed with `waitForFunction(..., { polling: 'raf' })`, not `locator.waitFor`
  (polls every 500 ms).
