# Slider

**Review PowerPoint decks precisely – mark, comment, version.** Like Frame.io, but for slides:
where Frame.io has a timecode, Slider has _slide + position_.

Drop in a PowerPoint (share link or `.pptx`), invite reviewers with a link – no account needed –
and collect feedback pinned to the exact spot on the slide. The original file is never changed.

> **Status: first prototype (milestones M1 + M2).** Upload, parsing, preview rendering, the review
> viewer with pins/frames/freehand, threads, done-status, filters, PowerPoint comment import and
> guest links work end to end on your machine, and so does importing by link (direct `.pptx`
> URLs out of the box, OneDrive/SharePoint after a one-time Microsoft app registration – see
> [Link import](#link-import)). Linked decks update themselves when the PowerPoint changes – see
> [Automatic updates](#automatic-updates). Media comments are next – see [Roadmap](#roadmap).

## Quick start

Requirements: [Bun](https://bun.com) ≥ 1.3 (package manager and API runtime) and Node.js ≥ 22
(Vite and Vitest run on Node). Nothing else – the database is embedded.

```bash
bun install
bun run dev          # API on :8787, web app on http://localhost:5173
```

The first start creates a local database in `apps/api/.data` and seeds a demo workspace
("Q4 Strategie" with feedback from four reviewers). Reset it any time with `bun run seed`.

Try the upload flow with the generated sample deck:

```bash
bun run sample       # writes packages/pptx/samples/slider-demo.pptx
```

| Command             | What it does                                   |
| ------------------- | ---------------------------------------------- |
| `bun run dev`       | API + web with hot reload                      |
| `bun run test`      | All unit and API tests (Vitest)                |
| `bun run lint`      | ESLint (TypeScript, React hooks)               |
| `bun run typecheck` | `tsc` for every workspace                      |
| `bun run build`     | Production build (`apps/web/dist` is static)   |
| `bun run seed`      | Reset the local database to the demo workspace |

> Use `bun run test`, not `bun test`: the suite runs on Vitest. `bun test` would start Bun's own
> test runner, so it is blocked with a hint (`bunfig.toml`).

## Architecture

```
apps/
  web/       Vite + React 19 + Tailwind 4 – static SPA (no SSR), talks to the API via /api
  api/       Hono on Bun – REST API, import pipeline, file serving
packages/
  shared/    Domain model + API contract (zod schemas → TypeScript types), geometry, link parsing
  pptx/      OOXML parser (slides, shapes, sections, modern + legacy comments) and SVG preview renderer
```

```mermaid
flowchart LR
  Browser["apps/web<br/>(static SPA)"] -- "/api, /files" --> API["apps/api<br/>(Hono)"]
  API --> DB[("Postgres<br/>PGlite locally")]
  API --> Blobs[("Blob storage<br/>filesystem locally")]
  API -- "import job" --> Pipeline["Import pipeline<br/>@slider/pptx"]
```

Design decisions worth knowing:

- **One contract, two sides.** `packages/shared` holds zod schemas for every entity and request.
  The API validates with them; the web app infers its types from them. No drift.
- **Normalised geometry.** Every anchor, frame and stroke is stored in 0–1 slide coordinates, so
  marks stay pixel-exact at any zoom level and screen size. Anchors also remember the shape they
  sit on (`cNvPr/@id`), so they can follow objects across revisions later.
- **Timeline zoom.** The zoom pill (and ⌘/Ctrl + wheel or pinch) only scales the horizontal
  slide row, from one big slide (Desktop-1) to several small ones side by side (Desktop-7). The
  active slide stays anchored at the left, and the comments simply start below the filmstrip.
  The zoom is remembered per browser.
- **Stable slide identity.** Slides get a Slider UUID and keep PowerPoint's `sldId`; URLs use the
  stable id (`/d/:deck?slide=:id`), never the slide number.
- **Real Postgres, zero setup.** Locally the API runs [PGlite](https://pglite.dev) (Postgres in
  WASM) through Drizzle. The same schema and migrations run on a hosted Postgres in production.
- **Adapters at the edges.** Blob storage, the job queue, the slide renderer and link sources are
  interfaces with a local implementation today (filesystem, in-process queue, SVG preview,
  Microsoft Graph + plain HTTPS link sources) and S3 / pg-boss / LibreOffice tomorrow.
- **The original stays untouched.** Slider only ever reads the PPTX. Guests see rendered slide
  images, never the file.

## Link import

Paste a link on the start page (`/neu`). Three kinds are recognised (`packages/shared/src/link.ts`):

| Link                                                                      | How Slider reads it                                                                                 | Login     |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | --------- |
| Any `https://…/deck.pptx` URL                                             | Downloads the file directly                                                                         | none      |
| SharePoint / OneDrive for Business (`*.sharepoint.com/:p:/…`, `Doc.aspx`) | Anonymous download first (`download=1`, works for "Anyone with the link"), else Graph `/shares/u!…` | if needed |
| OneDrive personal (`1drv.ms`, `onedrive.live.com`)                        | Follows the redirects to the `resid`, then Graph `/drives/{drive}/items/{resid}`                    | always    |

All downloads run server-side through `apps/api/src/sources/safe-fetch.ts`: https only, public IP
addresses only (re-checked on every redirect, max. 5), 60 s timeout, size limit while streaming,
and the file must start with the ZIP header `PK\x03\x04`.

**Microsoft login (one-time setup).** OneDrive and org-only SharePoint links need a delegated
Microsoft Graph token. Without one, the start page explains what is missing.

1. Entra admin center → _App registrations_ → _New registration_ "Slider", supported account
   types: _Accounts in any organizational directory and personal Microsoft accounts_.
2. _Authentication_ → _Add a platform_ → _Web_, redirect URI
   `http://localhost:5173/api/auth/microsoft/callback` (dev, through the Vite proxy) or
   `https://<your host>/api/auth/microsoft/callback`.
3. _Certificates & secrets_ → new client secret.
4. _API permissions_ → Microsoft Graph, delegated: `Files.Read.All`, `offline_access`, `User.Read`.
5. Copy `.env.example` to `.env` in the repo root, fill in `MS_CLIENT_ID`, `MS_CLIENT_SECRET`
   (optionally `MS_TENANT`, `MS_REDIRECT_URI`) and restart `bun run dev` – `.env` is only read at
   start-up.

The flow: the API answers `401 microsoft_login_required` with a `loginUrl` → "Mit Microsoft
anmelden" → Microsoft (authorization code + PKCE) → `/api/auth/microsoft/callback` stores the
refresh token AES-GCM-encrypted (key derived from `SLIDER_SECRET`) → back to `/neu?link=…`, which
retries the import automatically. If an organisation requires admin approval (AADSTS65001/90094),
the page says so; an admin grants consent once for the tenant.

## Automatic updates

Decks imported from a link follow their source (BER-107/108/114). Uploaded decks stay as they
are; a new version can be uploaded with `POST /api/decks/:id/revisions`.

- **Polling.** Every `SYNC_POLL_INTERVAL_MS` (default 2 min, `0` = off) the API process checks
  linked decks that someone opened or changed in the last 7 days. It asks only for the change
  token – Graph `cTag`/`eTag` for OneDrive/SharePoint, `ETag`/`Last-Modified` via `HEAD` for
  direct URLs; sources without either are downloaded and hashed at most every 5 intervals.
  An unchanged token never creates a revision, and a new token with identical bytes only
  records the token.
- **Debounce.** PowerPoint Online autosaves constantly, so a change is imported only after
  `SYNC_DEBOUNCE_MS` (default 1 min) without a further change – at the latest after 10 × that.
  The owner can skip the wait with "Jetzt aktualisieren" (`POST /api/decks/:id/sync`).
- **Slide matching.** The new revision is matched to the previous one (`@slider/pptx`
  `matchSlides`): same PowerPoint `sldId` first – even when the slide was completely rewritten –
  unless most ids disagree with the content (deck rebuilt/renumbered), then text, title, layout,
  neighbours and position with an optimal assignment. A slide deleted earlier that comes back
  with the same content is recognised and gets its old identity (and comments) back. Matched slides keep
  their Slider id, so comments simply stay on them; every slide gets `unchanged`, `moved`,
  `modified` or `new` with a confidence, stored as the revision's diff. Deleted slides keep
  their last image and all their comments – no comment ever disappears. With duplicated slides
  the original keeps its comments (including PowerPoint ones); the copy is new.
- **PowerPoint comments** are re-imported idempotently: edited text and statuses changed in
  PowerPoint are taken over, comments deleted in PowerPoint are flagged
  (`sourceStatus: "removed_in_pptx"`), never deleted, and replies written in Slider stay.
- **Errors** (expired Microsoft login, access revoked, file deleted, broken file, …) never touch
  the current revision; the deck's `sync.lastSyncError` carries a German banner text (and a
  login link). Unreachable sources show up only after three failures in a row; checks back off.

For the web app: `GET /api/decks/:id/status` is a cheap poll (`revisionNumber`, `sync`),
`GET /api/decks/:id/revisions` lists versions with a summary ("3 Folien geändert, 1 neu,
1 gelöscht, 5 neue Kommentare aus PowerPoint"), `GET /api/decks/:id/revisions/latest/diff`
returns per-slide changes plus deleted slides with their comments, and every slide carries
`change`.

## Roadmap

Tracked in Linear (project _Slider_). This prototype covers:

| Ticket          | Topic                                                         | State                                                 |
| --------------- | ------------------------------------------------------------- | ----------------------------------------------------- |
| BER-89          | Monorepo, stack, one-command dev, CI                          | ✅ (deploy pending, BER-123)                          |
| BER-90          | Data model: deck, revision, slide, slide version, comment     | ✅                                                    |
| BER-91          | `.pptx` upload with progress and error states                 | ✅                                                    |
| BER-93          | PPTX parser: slide ids, order, hidden, sections, shapes, text | ✅                                                    |
| BER-94          | Rendering                                                     | 🟡 SVG preview renderer; LibreOffice/PDF adapter next |
| BER-95/96       | Viewer, filmstrip, counter, zoom, fullscreen, deep links      | ✅                                                    |
| BER-97          | Import status and error states                                | ✅                                                    |
| BER-98/99       | Pins, frames, freehand, arrow, highlighter                    | ✅                                                    |
| BER-100/101     | Threads, connector lines, done status, filters                | ✅                                                    |
| BER-102         | Guest review links (name only, revocable, expiring)           | ✅                                                    |
| BER-103         | "A slide is missing here" gap comments                        | ✅                                                    |
| BER-112/113/115 | PowerPoint comments (modern + legacy) imported and labelled   | ✅                                                    |
| BER-121         | Owner overview "Meine Reviews"                                | ✅ (login via Microsoft/magic link pending)           |
| BER-88/92       | Import by link: OneDrive, SharePoint, direct `.pptx` URL      | ✅ (PDF render via Graph pending)                     |
| BER-107/108/114 | Change detection, slide matching, PPT comment re-import       | ✅ API (polling, debounce, diff, manual sync)         |
| BER-109–111     | Version UI: change badges, deleted slides, version history    | ⏳ API ready, UI pending                              |
| BER-116         | Voice and video comments                                      | ⏳                                                    |

## Contributing

Conventional commits, small PRs, `bun run lint && bun run typecheck && bun run test` before pushing.
The license is not decided yet (BER-122; AGPL-3.0 is the current recommendation).
