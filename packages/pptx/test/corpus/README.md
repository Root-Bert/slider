# Test corpus: decks with every kind of change (BER-106)

Pairs of decks (`v1.pptx` → `v2.pptx`), each showing one change a reviewer can make between two
uploads, plus the result Slider is expected to compute for it (`expected.json`). The corpus
checks slide matching (`matchSlides`, BER-108) end to end on real files, plus what the parser
reads around it: hidden flags, sections and comments.

```
test/corpus/
  cases.ts        the case list (declarative: v1 and v2 as DeckSpecs with slide labels)
  bases.ts        basis decks + producer transforms (Google Slides, PowerPoint Win/Mac/Online)
  spec.ts         labelled deck types and the transforms (insertAt, move, duplicate, …)
  run-case.ts     fingerprints + matching exactly like apps/api/src/sync/sync-import.ts
  corpus.test.ts  the checks
  decks/<id>/     v1.pptx, v2.pptx, expected.json – generated, committed
  real/<name>/    optional: real exported files (see below)
```

## What the test checks

For every case in `cases.ts`:

1. **Byte identity.** The committed `v1.pptx` / `v2.pptx` are exactly what `cases.ts` builds
   today (like `test/sample.test.ts`). A change to a case or to the fixture builder fails here
   until the corpus is regenerated.
2. **Expected result.** Parsing and matching the committed files gives exactly `expected.json`.
3. **Intent.** Hand-written assertions per case in `corpus.test.ts` (`INTENTS`) state what the
   case is about, e.g. "insert-start: exactly one `new`, everything else `unchanged`, nothing
   moved". On top of that, invariants hold for every case: each slide appears once, deleted
   slides come last, confidences are in [0, 1], and a matched pair always joins the same label.
   Regenerating `expected.json` therefore cannot silently bless wrong behaviour: the intent
   still fails.

CI runs it as part of `bun run test` (Vitest picks up `packages/*`); nothing extra is needed.

### `expected.json`

```jsonc
{
  "case": "insert-start",
  "tags": ["structure"],
  "synthetic": false,
  // matchSlides(prev, next) with slide keys replaced by the case's labels
  "matches": [{ "prev": null, "next": "neu", "status": "new", "moved": false,
                "confidence": 1, "matchedBy": null, "previousPosition": null, "position": 0 }, …],
  // what the parser read from each deck
  "prev": { "author": …, "slides": […], "sections": […], "comments": […] },
  "next": {
    "author": "Slider",
    "slides": [{ "label": "neu", "sldId": 261, "part": "ppt/slides/slide1.xml", "hidden": false,
                 "title": "Executive Summary", "layoutName": "Title and Content", "section": null }, …],
    "sections": [{ "name": "Einleitung", "slides": ["titel", "agenda"] }],
    "comments": [{ "slide": "agenda", "format": "modern", "status": "open", "author": "…",
                   "providerId": "AD", "anchor": "shape", "text": "…", "replies": 1 }]
  }
}
```

Fingerprints are built like production: `fingerprintFromShapes` over the shapes with the API's
bbox clamping (`apps/api/src/import/common.ts`) and
`renderHash = sha256(svgForRenderHash(renderSlideSvg))`.
Labels come from the case definition, never from parsing, so a renumbered sldId cannot change
the keys. Confidences are rounded to two decimals.

## Cases

| id                                                                     | covers                                                                                                                                                            |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `basis-simple`                                                         | five plain slides (title, text, picture, table), nothing changed                                                                                                  |
| `basis-hidden`                                                         | two hidden slides (middle and end), nothing changed                                                                                                               |
| `basis-groups`                                                         | group shapes, one nested, nothing changed                                                                                                                         |
| `basis-sections`                                                       | seven slides in three sections, nothing changed                                                                                                                   |
| `insert-start` / `insert-middle` / `insert-end`                        | one new slide at position 1 / 3 / 6                                                                                                                               |
| `delete-middle`                                                        | one slide deleted                                                                                                                                                 |
| `move-slide`                                                           | one slide moved from the end to position 3                                                                                                                        |
| `move-section`                                                         | a three-slide section moved to the end                                                                                                                            |
| `duplicate`                                                            | PowerPoint "Duplicate slide": identical copy, new sldId                                                                                                           |
| `reuse-slides`                                                         | "Reuse slides → keep source formatting": a slide from another deck with its own master and layout (`1_Title and Content`) and the same title as an existing slide |
| `text-changed`                                                         | body text edited                                                                                                                                                  |
| `image-swapped`                                                        | picture replaced (same box, other pixels)                                                                                                                         |
| `layout-changed`                                                       | layout switched, text unchanged                                                                                                                                   |
| `groups-text-changed`                                                  | text changed inside a nested group                                                                                                                                |
| `hide` / `unhide`                                                      | `show="0"` set / removed                                                                                                                                          |
| `comments-modern`                                                      | modern comments anchored to a shape, a point and the slide                                                                                                        |
| `comments-legacy`                                                      | legacy comments (`p:cmLst`) by two authors                                                                                                                        |
| `comments-threads`                                                     | modern thread gets two more replies                                                                                                                               |
| `comments-legacy-threads`                                              | legacy replies (`p15:threadingInfo`)                                                                                                                              |
| `comments-resolved`                                                    | modern comments resolved / closed / still open                                                                                                                    |
| `comments-moved-slide`                                                 | commented slide moved; the comment stays with its sldId                                                                                                           |
| `google-roundtrip`                                                     | PowerPoint deck (sections, comments, grown sldIds) → Google Slides download, no edits _(synthetic)_                                                               |
| `google-insert` / `google-move`                                        | both versions from Google Slides, with an insert / a move _(synthetic)_                                                                                           |
| `google-hidden`                                                        | skipped slides from Google Slides, one unhidden _(synthetic)_                                                                                                     |
| `producer-win` / `producer-mac` / `producer-online`                    | the same edit (text, thread answered and resolved, new comment) saved by PowerPoint for Windows / 2019 for Mac / the web _(synthetic)_                            |
| `producer-win-to-online`                                               | saved on Windows, re-saved unchanged on the web _(synthetic)_                                                                                                     |
| `producer-win-move`                                                    | PowerPoint move with stable part names, rIds and creationIds _(synthetic)_                                                                                        |
| `rewrite-most-slides`                                                  | four of five slides translated, sldIds kept: all still matched by sldId                                                                                           |
| `ppt-delete-last-insert`                                               | last slide deleted, new one inserted on the reused max sldId, told apart by creationId _(synthetic)_                                                              |
| `google-insert-late` / `google-delete-late`                            | Google Slides insert / delete late in the deck: shifted sldIds are not trusted _(synthetic)_                                                                      |
| `google-insert-footer` / `google-delete-footer` / `google-move-footer` | Google Slides insert / delete / move with the same footer line on every slide: shared text does not make the shifted sldIds trustworthy _(synthetic)_             |
| `insert-start-slide-numbers`                                           | insert at the start in a deck with slide numbers and an auto date: renumbered fields do not mark slides as modified                                               |

## Synthetic cases

We cannot drive Google Slides or the PowerPoint apps in CI, so the producer cases imitate their
output with opt-in options of the fixture builder (`test/fixtures/build-pptx.ts`). The quirks are
plausible, from what these apps are known to write, but **not verified against real files**:

- **Google Slides** (`asGoogleSlides`): sldIds renumbered from 256 in the current order; slide
  parts and rIds renamed by position; no `p14:creationId`; no sections; no PowerPoint comments
  or author parts; layouts named `TITLE` / `TITLE_AND_BODY`; Google-style shape ids (54, 64, …)
  with explicit placeholder boxes; an app.xml without an Office application; hidden ("skipped")
  slides keep `show="0"`.
- **PowerPoint for Windows** (`asPowerPointWin`): `Microsoft Office PowerPoint` 16.0000 with
  TotalTime and Company; `p14:creationId` on every slide (also the `pc:sldMk/@cId` of its
  comments and part of the comment file name); slide parts numbered by history, not position;
  modern comments by work (`AD`, `S::upn::oid`) and personal (`Windows Live`) accounts;
  `cp:lastModifiedBy` and `cp:revision`.
- **PowerPoint 2019 for Mac** (`asPowerPointMac`): `Microsoft Macintosh PowerPoint`; that
  build predates modern comments, so it writes legacy comments, replies as
  `p15:threadingInfo/p15:parentCm`, and cannot store "resolved". (Current Mac 365 builds write
  modern comments like Windows.)
- **PowerPoint for the web** (`asPowerPointOnline`): a sparse app.xml (Application and
  AppVersion only), modern comments by work accounts, `lastModifiedBy` = the signed-in user.

Matching ignores app.xml, core.xml, part names and rIds; these cases mainly pin down that it
keeps ignoring them, plus the sldId checks (creationIds, Google's renumbering) and the comment
parsing.

### Real files

Real exports belong in `real/<name>/v1.pptx`, `v2.pptx` (e.g. one deck uploaded, then edited
and downloaded again from Google Slides, PowerPoint Win/Mac/Online). The test picks up every
folder there. Slides are keyed by position (`v1:1`, `v2:1`, …). After checking the result by
hand, write its `expected.json` with `UPDATE_CORPUS=1 bunx vitest run packages/pptx/test/corpus`;
without it the test fails. Real files do not get intent assertions automatically – add a line
to this README on what the pair shows. Mind that real decks may contain personal data.

## Adding a case

1. Add an entry to `CASES` in `cases.ts`: `id` (folder name), `title`, `description`, `tags`
   (`synthetic` plus a `synthetic` note for imitated producers), `v1` and `v2`. Build v2 from v1
   with the transforms in `spec.ts`. Give new slides a new `label`; keep the label of a slide
   that is "the same slide" in both versions.
2. If the builder lacks a feature, add it to `build-pptx.ts` as an **opt-in** option: leaving it
   out must produce exactly the bytes it did before (`test/sample.test.ts` and every committed
   corpus deck check that).
3. Add the case's intent to `INTENTS` in `corpus.test.ts` (the test fails without one).
4. Run `bun run corpus` (in `packages/pptx`) and review `decks/<id>/expected.json`.

## Regenerating

- `bun run corpus` (in `packages/pptx`) rewrites every `decks/<id>/` and removes folders of
  deleted cases.
- `UPDATE_CORPUS=1 bunx vitest run packages/pptx/test/corpus` does the same from the test, and
  also writes `expected.json` for `real/` folders.

A change to matching (weights, thresholds) changes confidences in many files. Review the diff:
the intents keep the meaning in check, the numbers are for reviewing.

## Known behaviour

What the matcher does today that a reader might not expect. These are recorded, not fixed, here.

- **Hide / unhide is not a change.** `hide`, `unhide` and `google-hidden` come out `unchanged`:
  neither the fingerprint nor the rendered SVG looks at `show="0"`. Only `slides[].hidden` in
  the summary shows it.
- **Moving a section marks the other slides as moved.** In `move-section` the three "Analyse"
  slides were dragged to the end, but the result marks the two "Abschluss" slides as `moved`:
  the matcher keeps the longest run in order and calls everything else moved.
- **A duplicate is `new` with confidence 1.** The original keeps its sldId and is matched first;
  the identical copy then has no candidate left, so "how sure is it that there is no
  counterpart" is 1 even though an identical slide exists.
- **Google round trip without edits is `unchanged`.** All sldIds are reassigned, so the renumber
  guard drops them (`matchedBy: "content"`), and since the render is identical nothing counts as
  modified, although layout names and shape ids changed. Sections and comments are gone from
  the Google file.
- **Legacy comments are always `open`.** Reply threads come back from
  `p15:threadingInfo/p15:parentCm` (`comments-legacy-threads`, `producer-mac`), but legacy
  comments cannot store "resolved".
- **A reused sldId is only recognised with `p14:creationId`.** `ppt-delete-last-insert` gets it
  right because PowerPoint writes creationIds; without them (and without a better content match
  elsewhere) a slide on the same sldId counts as the same slide, however much it changed
  (`rewrite-most-slides`).
