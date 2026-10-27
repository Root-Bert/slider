# Tests

The suite focuses on failures that can lose data, grant access incorrectly, corrupt a document,
prevent sign-in, or break a complete review workflow. Assertions about CSS classes, icon sizes,
static copy, simple prop forwarding, and the spelling of CI commands have been removed.

After the reduction, there are 598 Vitest cases in 37 files (including two conditional
Postgres checks) and 12 browser cases in seven files. All 65 ODP cases remain. These counts
include the security regression tests added after review and individual variants of parameterized tests; Vitest's default static listing
does not expand them.

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
```

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
