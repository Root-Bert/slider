# Slider – rules for coding agents

Claude Code reads `CLAUDE.md`, Codex `AGENTS.md` (symlink). Before touching an area listed in
[`docs/do-not-break.md`](docs/do-not-break.md), run its check and report it. Gotchas (LibreOffice,
fonts, AI, voice, Unsplash, local services): [`docs/agent-notes.md`](docs/agent-notes.md). Repo
facts go there, not into private agent memory.

## Git and the shared checkout

- Work on `main` in the main checkout – no worktrees, no branches. Other agents (Claude, Codex)
  write the same checkout at once: touch only your own files.
- Never `git stash`, `git checkout -- <file>`, `git reset` – wipes others' work. To compare with
  HEAD read the diff or copy a test to `test/zz-*.test.ts` (delete after). Failures in files you
  didn't touch are someone's work in progress: report, don't fix.
- Commit small, one change per commit, only your files (no `git add -A`). Never push, no PR – the
  user pushes. No `Co-Authored-By:` / „Generated with …“ lines.
- Dev server: never a second `bun run dev` while one runs (`lsof -iTCP:8787`) – PGlite allows one
  process; two broke the WAL.
- Migrations: never edit `schema.ts` temporarily while the dev API (`bun --watch`) runs – it
  restarts and migrates, drizzle applies each file once by timestamp, a half-written one sticks.
  Generate with the API stopped or write SQL + snapshot by hand.

## Checks

- Typecheck web: `cd apps/web && npx tsc --noEmit -p tsconfig.app.json` – `tsc -p .` there checks
  **zero** files. api/shared: `-p tsconfig.json`. Whole repo: `bun run typecheck`. Filter others'
  errors to your files.
- Tests: `bun run test`, `bun run e2e` ([`docs/testing.md`](docs/testing.md)). **≤ 500 tests in the
  whole repo** (each `it.each` row and Playwright case counts): add assertions to existing `it`s.
- e2e runs with LibreOffice disabled, so the editor never opens there – see docs/testing.md for
  the scratch-config recipe, or `bun run e2e:live`.
- Visual work is not done until you have looked at it (screenshot or parity script).

## Product rules

- One behaviour everywhere: before building a menu/dialog/shortcut/route, copy how Präsentationen
  do it (`features/reviews/components/DeckActions.tsx`) – label, icon, confirm, toast, keys. Fix
  siblings in the same go. No new modes.
- Wording: „Präsentation“ (never „Idee“). Destroying own things = „Löschen“ („X löschen?“, toast „X
  gelöscht“); „Entfernen“ only when a link goes and the thing stays. Vendor names only where the
  vendor is meant.
- Panels/popovers/dialogs loop Tab via `useFocusLoop` (in `usePopover`, `Dialog`); rows of choices
  step via `tabStep` (`lib/dom.ts`), one always picked with its panel shown.
- No spinners once a deck exists: every edit instant/optimistic through the outbox, refusals
  toast, panels close on pick. Spinners only for downloads and the AI.
- Every shortcut works in every editor state (picked, typing, panel `<select>`, template editor,
  foreign clipboard) – use `isTextTarget`.
- The editor is a lighter Figma over a real presentation file: when unsure, do as Figma does,
  simpler. Own UI only – no office iframe, no side panel in edit mode (formatting in the floating
  `FormatBar`, undo/redo/save/download in the tool bar). Esc, ⌘↵, ✕ keep the element and deselect.
  Every text box/shape with text is typable (not fields, numbering, symbol fonts, rotated text).
  Hand editing = text + box; anything complex goes to the AI.
- Colours come from the template palette („Farben“) plus „Eigene“ (`ColorPalette.tsx`); no colour
  library.
- Design tokens/primitives: [`apps/web/design-system.md`](apps/web/design-system.md).
- Minimal fixes, measure before rebuilding; complicated additions that don't help get reverted.
