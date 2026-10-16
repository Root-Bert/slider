# Slider design system

One source of truth for how the web app looks and how its code is laid out. Tokens live in
`apps/web/src/styles/index.css` (`@theme`), primitives in `apps/web/src/ui/`. If a value or a
pattern is not in here, it is either added here first or it is a documented exception.

Slider is dark-only: the slides are the only bright surface on screen. Everything else is black
canvas, frosted glass and white at fixed opacities.

## 1. Rules

1. **No raw colours in components.** No `bg-white/12`, `#141414`, `rgb(…)` or `rgba(…)` in `.tsx`.
   Use a token class (`bg-hover`, `text-fg-muted`, `bg-scrim`) or a utility (`glass-control`,
   `ring-hairline`). Exceptions are listed in `apps/web/src/styles/raw-color-allowlist.ts` and
   enforced by `styles/design-tokens.test.ts`.
2. **No hand-rolled controls.** A clickable thing is a `Button`, `IconButton`, `TextLink`,
   `ButtonLink`, `MenuItem`, `SegmentedControl`, `Toggle` or `ColorSwatches`. Surfaces that are
   clickable as a whole (deck cards, thumbnails, pins) stay bespoke but use the state tokens.
3. **Tailwind scale first, tokens second, arbitrary values last.** An arbitrary value
   (`h-[88px]`) is fine for one-off geometry, never for colours, font sizes, radii, z-index or
   easings.
4. **`cn` is plain `clsx`** — there is no tailwind-merge. A `className` override only wins by CSS
   order or `!`. Kit components therefore expose props (variant, size, tone) instead of relying
   on callers overriding classes.
5. **Behaviour never changes in a refactor.** Same DOM semantics, same `data-*` hooks, same
   storage keys, same query keys, same German copy.

## 2. Colour tokens

### Surfaces

| Token            | Value                  | Use                                                     |
| ---------------- | ---------------------- | ------------------------------------------------------- |
| `canvas`         | `#000`                 | Page background, dot grid base                          |
| `glass-solid`    | `#141414`              | Opaque glass (tooltips, image backdrops, pending tiles) |
| `placeholder`    | `#1a1a1a`              | Image placeholders                                      |
| `surface-raised` | `#2a2a2a`              | Opaque raised chip (avatar `+N`)                        |
| `glass`          | `rgb(77 77 77/.3)`     | `glass` utility (cards)                                 |
| `glass-hover`    | `rgb(110 110 110/.38)` | Hover on clickable glass cards                          |
| `glass-panel`    | `rgb(30 30 30/.5)`     | `glass-panel` utility (side panels over slides)         |
| `glass-control`  | `rgb(40 40 40/.25)`    | `glass-control` utility (control pills, buttons)        |
| `glass-elevated` | `rgb(20 20 20/.86)`    | `glass-elevated` utility (dialogs, popovers, menus)     |

### White overlay ladder (fills and states)

All state and fill tints are white at one of these steps. Nothing in between.

| Token          | Alpha | Use                                                                         |
| -------------- | ----- | --------------------------------------------------------------------------- |
| `surface-1`    | 0.05  | Inset wells, info boxes, tab tracks, quiet row hover (`hover:bg-surface-1`) |
| `surface-2`    | 0.08  | Chips, code, soft-button rest, selected row in a list                       |
| `hover`        | 0.10  | **Standard hover / focus / open** for ghost controls; progress tracks       |
| `surface-3`    | 0.12  | Thread rails, workspace mark, soft-button rest on glass                     |
| `selected`     | 0.15  | **Pressed / selected** controls; hover on `glass-control` and soft chips    |
| `surface-4`    | 0.20  | Switch track off; hover on `surface-3`                                      |
| `handle`       | 0.25  | Drag handles, waveform bars, dashed tile border at rest                     |
| `border-focus` | 0.35  | Field focus ring (`focus-field`), dashed tile border on hover               |

Above 0.35 use the foreground tokens: `fg-faint` 0.3, `fg-subtle` 0.5, `fg-muted` 0.7, `fg` 0.9.

### Lines

| Token             | Alpha | Use                                                    |
| ----------------- | ----- | ------------------------------------------------------ |
| `hairline`        | 0.08  | Horizontal rules, glass edges, card borders            |
| `hairline-strong` | 0.16  | Vertical toolbar dividers, field edges, elevated edges |

### Black ladder (scrims and overlays)

| Token          | Alpha | Use                                                             |
| -------------- | ----- | --------------------------------------------------------------- |
| `well-dark`    | 0.25  | Dark wells for media/reply controls                             |
| `scrim`        | 0.60  | Dialog backdrop, chips over slides/thumbnails (`glass-dark`)    |
| `scrim-strong` | 0.75  | Full-screen sheet backdrop, strong badges (`glass-dark-strong`) |
| `scrim-max`    | 0.90  | Hover on `scrim-strong` controls                                |

### Foreground

`fg` 0.9 · `fg-muted` 0.7 · `fg-subtle` 0.5 · `fg-faint` 0.3 · `primary` (= white 0.9) ·
`primary-hover` (white) · `on-primary` (black). Placeholders are `placeholder:text-fg-subtle`.

### Status, brand, accents

`success` `warning` `info` `danger` `mention` · brand `powerpoint` `libreoffice` `onedrive`
`sharepoint` · reviewer accents `accent-{red,yellow,green,cyan,blue,violet}` and their
`ring-*` presence colours.

Status tints use Tailwind opacity modifiers on the token, at fixed steps only:

| Step | Use                               | Example                 |
| ---- | --------------------------------- | ----------------------- |
| /10  | Tinted notice / banner background | `bg-warning/10`         |
| /15  | Soft danger button, strong tint   | `bg-danger/15`          |
| /25  | Hover on a /15 tint               | `hover:bg-danger/25`    |
| /30  | Subtle ring around a tinted panel | `ring-danger/30`        |
| /45  | Status ring on a badge or slide   | `inset-ring-warning/45` |

### On-accent text

Text on a reviewer accent is black or white, decided by `isLightAccent` in `lib/accent.ts`
(`onAccentClass(color)`). Raw `text-black` / `text-white` only there.

## 3. Surfaces (utilities)

| Utility                | What                                                                  |
| ---------------------- | --------------------------------------------------------------------- |
| `glass`                | Frosted card (24px blur) + hairline ring                              |
| `glass-panel`          | Side panel over slides (24px blur, darker)                            |
| `glass-floating`       | `glass-panel` + hairline ring + float shadow (thread, deleted panels) |
| `glass-control`        | Control pill / button (4px blur) + hairline ring                      |
| `glass-elevated`       | Dialog, popover, menu (32px blur, near-opaque) + strong ring + float  |
| `glass-dark`           | Chip over a slide or thumbnail (`scrim` + 8px blur)                   |
| `glass-dark-strong`    | Badge over a slide (`scrim-strong` + 8px blur)                        |
| `ring-hairline`        | `inset 0 0 0 1px hairline` as box-shadow                              |
| `ring-hairline-strong` | `inset 0 0 0 1px hairline-strong` as box-shadow                       |
| `field-well`           | Inset quote / reply well: `surface-1` + strong hairline ring          |
| `focus-field`          | Field focus: inset `border-focus` ring on `:focus-within`             |
| `dot-grid`             | Canvas with the 22px dot grid (`--color-dot`)                         |
| `skeleton`             | Shimmering loading placeholder                                        |
| `scrollbar-none`       | Hidden scrollbar                                                      |

The `ring-*` utilities and the glass utilities each set `box-shadow`; never stack two of them on
one element — use the combined utility instead.

## 4. Typography

Inter Variable with `cv11, ss01`. Weights: 400, 500 (`font-medium`), 600 (`font-semibold`).

| Class          | Size | Role                                                |
| -------------- | ---- | --------------------------------------------------- |
| `text-display` | 28px | Page title (`PageHeader`)                           |
| `text-2xl`     | 24px | Standalone card title (login, join, no access)      |
| `text-lg`      | 18px | Dialog title                                        |
| `text-base`    | 16px | Panel / section heading                             |
| `text-sm`      | 14px | Form inputs, md/lg buttons, card subtitles          |
| `text-body`    | 13px | **UI body**: comments, menus, list rows, sm buttons |
| `text-xs`      | 12px | Labels, author lines, inline errors                 |
| `text-caption` | 11px | Timestamps, badges, kbd, meta chips, tooltips       |
| `text-tiny`    | 10px | Avatar overflow counters, mini labels               |
| `text-micro`   | 9px  | Slide-number chips on minimap thumbnails            |

The custom sizes carry no line height of their own (same as `text-[13px]`); pair them with
`leading-*` where needed. Use `leading-4.5` (18px) and `leading-3.5` (14px) instead of
arbitrary leading. Slide text (`TextBox`, sketch canvas) mirrors slide geometry and is exempt.

## 5. Radius

Slightly boxy, concentric: inner radius = outer radius − padding.

| Class                | px  | Use                                                             |
| -------------------- | --- | --------------------------------------------------------------- |
| `rounded-panel`      | 16  | Pills, docks, cards, dialogs, menus, toasts                     |
| `rounded-control`    | 12  | Controls in a 4px-padded pill; standalone fields; md/sm buttons |
| `rounded-control-sm` | 10  | Controls in a 6px-padded pill; sm buttons                       |
| `rounded-chip`       | 8   | Chips, tags, 28px icon buttons                                  |
| `rounded-badge`      | 6   | Badges, kbd, switch tracks, 24px buttons, xs buttons            |
| `rounded-thumb`      | 4   | Slide thumbnails, knobs, segments inside badges                 |
| `rounded-mark`       | 3   | Frames and marquees on slides, skeleton bars                    |
| `rounded-full`       | –   | Avatars, pin dots, swatches, spinners, round icon buttons       |

## 6. Elevation

Shadows: `shadow-float` (overlays), `shadow-mark` (pins and marks on slides), `shadow-lift`
(live cursors and labels). Tailwind's `shadow-sm`/`shadow-lg` are not used.

Stacking uses named layers (`z-(--z-…)`):

| Variable      | Value | Layer                                                               |
| ------------- | ----- | ------------------------------------------------------------------- |
| `--z-raised`  | 10    | Local lift, stretched links                                         |
| `--z-overlay` | 20    | Drawing surfaces, cursors, sticky timeline header                   |
| `--z-sticky`  | 25    | Sticky timeline column above overlays                               |
| `--z-chrome`  | 30    | Floating viewer controls, annotation layers, banners, selection bar |
| `--z-panel`   | 40    | Side panels                                                         |
| `--z-popover` | 50    | Menus, popovers, composer, mention menu                             |
| `--z-toast`   | 55    | Toasts (above popovers)                                             |
| `--z-stage`   | 60    | Import stage                                                        |

## 7. Motion

Durations come from Tailwind's scale only: `duration-150` (default: hover, colour), `200`
(cards, pins, cursors), `300` (panels, layout), `500` (import stage). Easings are tokens:

| Class             | Curve                            | Use                       |
| ----------------- | -------------------------------- | ------------------------- |
| `ease-out`        | Tailwind                         | Small fades               |
| `ease-emphasized` | `cubic-bezier(.2,.9,.25,1)`      | Panels, rise-in, slide-in |
| `ease-overshoot`  | `cubic-bezier(.2,.9,.3,1.2)`     | Pop-in                    |
| `ease-sheet`      | `cubic-bezier(.32,.72,0,1)`      | Sheets and drawers        |
| `ease-symmetric`  | `cubic-bezier(.65,0,.35,1)`      | Drawn lines               |
| `ease-exit`       | `cubic-bezier(.4,0,1,1)`         | Leaving the page          |
| `ease-hop`        | `cubic-bezier(.3,.7,.4,1)`       | Logo hop                  |
| `ease-deal`       | `cubic-bezier(.16,.92,.24,1.05)` | Import stage deal-in      |

JS-coupled timings live in `lib/motion.ts`; `motionMs(ms)` returns 0 under reduced motion.

## 8. Icons

`<Icon size>` takes a step of the scale `xs 12 · sm 14 · md 16 · lg 18 · xl 20 · 2xl 24`
(`ICON_SIZE`) or px. Defaults: Button 2xs → 16, xs → 14, all other sizes → 18; IconButton
xs/compact → 18, sm/lg → 20, md → 24 (`iconSize` overrides, e.g. 16 for dense rows).

## 9. States

| State    | Ghost / list controls                                                         | Glass / soft controls         | Primary            |
| -------- | ----------------------------------------------------------------------------- | ----------------------------- | ------------------ |
| Rest     | transparent, `text-fg-muted`                                                  | `glass-control` / `surface-2` | `bg-primary`       |
| Hover    | `bg-hover`, `text-fg`                                                         | `bg-selected`                 | `bg-primary-hover` |
| Selected | `bg-selected`, `text-fg`                                                      | `bg-selected`                 | –                  |
| Open     | `aria-expanded:bg-hover`                                                      | `aria-expanded:bg-selected`   | –                  |
| Disabled | `opacity-40`, no pointer                                                      | `opacity-40`, no pointer      | `opacity-40`       |
| Focus    | global `:focus-visible` outline (mention blue, 2px); fields use `focus-field` |

## 10. Components (`apps/web/src/ui`)

Everything is exported from `@/ui`. Defaults are **bold**. `cn` is plain `clsx` (no class
merging), so pick a size/variant prop instead of overriding classes with `className`.

### Actions

| Component     | Props (variants · sizes)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Button`      | `variant` **primary** · secondary · soft · ghost · danger; `size` 2xs 20 · xs 24 · sm 32 · **md 36** · field 40 · lg 44 · toolbar 40 (panel radius); `tone` **default** · subtle (ghost) · strong · warning (soft); `weight` **medium** · normal; `icon`, `trailingIcon`, `iconSize` (default 16 at 2xs, 14 at xs, 18 otherwise); `loading` (spinner, disabled, `aria-busy`); `expanded` (`aria-expanded` + open fill); `ref`; native button props (`type` defaults to `button`). Class helper: `buttonClasses({ variant, size, tone, weight })` |
| `ButtonLink`  | Router `LinkProps` + `variant` `size` `tone` `weight` `icon` `trailingIcon` `iconSize` – navigation that looks like a `Button`                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `IconButton`  | `icon`, `label` (required, `aria-label`); `variant` **ghost** · subtle · glass · primary · danger; `size` xs 24 · compact 28 · sm 32 · lg 36 · **md 40** (icon 18 · 18 · 20 · 20 · 24); `shape` **square** · round; `active` (`aria-pressed`, `bg-selected`; a caller's own `aria-pressed` wins); `expanded` (`aria-expanded` only); `title` (defaults to `label`, `false` for none); `iconTone="success"`; `disabledStyle` **fade** (40 %) · dim (`fg-faint`); `iconSize`; `ref`. Class helper: `iconButtonClasses()`                           |
| `TextLink`    | Renders a router `Link` for `to`, an `<a>` for `href`, otherwise a `<button>`; `variant` **quiet** · underline · inline · mention; `tone` **subtle** · muted (quiet only); `size` **inherit** · xs · body · sm; `weight` **normal** · medium; `icon`, `trailingIcon`, `iconSize` (**16**). Class helper: `textLinkClasses()`                                                                                                                                                                                                                     |
| `BackLink`    | `to`, `label` (**"Zurück zu den Reviews"**), `className` – the arrow link above a page title                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `CountBubble` | `count`, `color` (author accent fill), `aria-label` (required), `dim` (50 %), `size` **sm 20** · md 24; native button props                                                                                                                                                                                                                                                                                                                                                                                                                      |

### Selection

| Component          | Props                                                                                                                                                                                                                                                                                                                                  |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SegmentedControl` | `segments` (`{ value, label, count?, icon?, disabled?, title? }[]`), `value`, `onChange(value)`, `label` (group name); `size` xs 20 · sm 28 · **md 32**; `tone` **neutral** · warning; `track` **none** · soft; `mode` **radio** (radiogroup) · tabs (tablist, roving focus, ←/→/Home/End skip disabled)                               |
| `FilterChip`       | `selected`, `onClick`, `children` (string); `icon`, `count`, `disabled`, `title`; `role` **checkbox** · radio · tab; `size` xs · sm · **md**; `tone` **neutral** · warning; `tabIndex`; `value` (`data-segment`)                                                                                                                       |
| `Toggle`           | `checked`, `onChange(checked)`, `label`, `description`, `disabled`, `size` sm 28×16 · **md 36×20** – `role="switch"` with a label row                                                                                                                                                                                                  |
| `SwitchTrack`      | `checked`, `size` **sm** · md – decorative switch inside a row button that is itself `role="switch"`                                                                                                                                                                                                                                   |
| `ColorSwatches`    | `value`, `onChange(color)`, `colors` (**the six accents**), `labelledBy` or `label`, `swatchLabel`, `swatchTitle`, `disabled` (wait cursor), `size` **28** · 32; `variant` **fill** (radiogroup, check mark) · dot (pressed buttons); `ringOffset` canvas · glass-solid (fill default) · placeholder (dot default) · well-dark · scrim |
| `Select`           | `value`, `onChange(value)`, `options` (`{ value, label }[]`), `size` sm · **md** · toolbar; native select props                                                                                                                                                                                                                        |

### Menus, popovers, dialogs

| Component                   | Props                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Menu`                      | `label` (trigger name), `actions` (`MenuAction[]`: `label`, `icon`, `onSelect`, `tone` default · danger, `disabled`, `title`), `triggerSize` (IconButton size, **sm**), `triggerClassName`, `className` – menu button pattern (Enter/Space/↓ open, ↑/↓/Home/End, Escape/Tab close)                                                                      |
| `ContextMenu`               | `label`, `actions`, `at` (`{ x, y }`), `onClose` – the same menu at the pointer, portalled to `<body>`                                                                                                                                                                                                                                                  |
| `MenuItem`                  | `as` (**button** · `a` · router `Link` · `div` static row); `icon` (icon name or node); `trailing`; `selected` (`bg-surface-2`, `aria-current`); `tone` **default** · danger; `size` **sm** (13px) · md (14px); `inset` 4 (`rounded-control`) · **6** (`rounded-control-sm`); `disabled`, `dimDisabled` (**true**), `focusableWhenDisabled`; `truncate` |
| `MenuDivider` `MenuHeading` | Hairline between groups; uppercase caption above a group (give it an `id` to label the group)                                                                                                                                                                                                                                                           |
| `usePopover`                | Options `extraRefs`, `returnFocus` (**true**), `hasPopup`, `onOpenChange`, `initialOpen` → `{ open, setOpen, toggle, close, wrapperRef, triggerRef, panelRef, panelId, triggerProps }`                                                                                                                                                                  |
| `PopoverPanel`              | `as` **div** · section; `side` **bottom** · top; `align` **start** · end; `position` **anchored** · none; `offset` sm 4 · **md 8**; `tone` **elevated** · default; `padding` **none** · sm 4 · md 6 · lg 12; `ref`                                                                                                                                      |
| `Tooltip`                   | `label`, `children`; `align` **center** · start · end; `maxWidth` **48** · 64 · none; `showOnFocus` (**true**); `animated` (**true**); `decorative` (`aria-hidden` instead of `role="tooltip"`); `disabled`; `display` **inline-flex** · flex                                                                                                           |
| `Dialog`                    | `open`, `onClose`, `title`, `description`, `children`, `footer`, `className` – native `<dialog>`, close button, a backdrop click closes                                                                                                                                                                                                                 |
| `ConfirmDialog`             | `open` (**true**), `onClose`, `title`, `description`, `confirmLabel`, `confirmIcon`, `tone` **danger** · primary, `onConfirm`, `form` (confirm becomes that form's submit), `pending`, `confirmDisabled`, `error` (alert), `extraActions`, `cancelLabel` (**"Abbrechen"**), `children`, `className`                                                     |
| `Toolbar`                   | `label`, `role` **toolbar** · group · `false` (plain pill), `tone` (GlassPanel), div props                                                                                                                                                                                                                                                              |
| `ToolbarDivider`            | `size` sm 16 · **md 20**; `tone` **strong** · subtle; `spacing` none · **sm** · md                                                                                                                                                                                                                                                                      |
| `GlassPanel`                | `as`, `tone` **default** (`glass-control`) · elevated                                                                                                                                                                                                                                                                                                   |
| `Toast` / `useToast`        | `toast` (`{ id, text, tone }` or `null`) – polite live region at the bottom                                                                                                                                                                                                                                                                             |

### Layout and content

| Component        | Props                                                                                                                                                                                                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Section`        | `title`, `id`, `icon`, `description`, `aside`, `tone` **default** · danger, `density` **default** · compact, `children` – settings card (`aria-labelledby`)                                                                                                                                                        |
| `PageHeader`     | `title`, `subtitle`, `subtitleSize` sm · body, `back` (`{ to, label? }`), `leading`, `actions`, `truncate`, `align` start · center, `layout` stacked · inline, `titleRow`                                                                                                                                          |
| `RowList`        | `variant` **divided** · hover · flush; `ul` props                                                                                                                                                                                                                                                                  |
| `ListRow`        | `title`, `leading`, `badge`, `subtitle`, `subtitleTitle`, `trailing`, `actionSlot`; `variant` divided · hover · flush; `padding` sm · md · wide · header (each with its radius); `textGap` none · tight; `size` sm · body; `titleWeight` medium · normal; `titleTone` fg · muted · subtle; `dimmed`; `as` li · div |
| `IconTile`       | `children`, `size` 32 · 36 · 40 · 56; `tone` muted · fg · inherit · danger; `tint` surface-1 · hover; `dimmed`                                                                                                                                                                                                     |
| `Notice`         | `tone` info · success · warning · danger · neutral; `variant` glass · tinted · plain · inline; `size` md · sm; `title`, `icon` (name or `false`; a tone default otherwise), `onDismiss` + `dismissLabel`, `footer`, `role` alert · status, `animated`                                                              |
| `EmptyState`     | `title`, `message`, `action`, `illustration`, `size` md · lg, `headingLevel` 1 · 2 · 3                                                                                                                                                                                                                             |
| `LoadingState`   | `fullPage`, `height` full · screen, `padding` sm · md · lg, `size` (spinner px)                                                                                                                                                                                                                                    |
| `ErrorText`      | `size` **body** · xs; `p` props                                                                                                                                                                                                                                                                                    |
| `Divider`        | `label` (e.g. "oder"; without it a `role="separator"` hairline), `labelPosition` **center** · start                                                                                                                                                                                                                |
| `Badge`          | `tone` **neutral** · success · warning · info · danger · powerpoint · overlay (`glass-dark text-fg`); `iconOnly` (24px square); span props                                                                                                                                                                         |
| `Avatar`         | `author`, `size` 16 · 18 · 20 · 24 · 28 · 32 · 64, `showPowerPointBadge`, `nativeTitle`                                                                                                                                                                                                                            |
| `AvatarStack`    | `authors`, `max`, `size`, `interactive`                                                                                                                                                                                                                                                                            |
| `AvatarOverflow` | `count`, `size`, `title` – the "+n" chip                                                                                                                                                                                                                                                                           |

App chrome lives in `shell/` (not `ui/`): `SettingsLayout` (`docTitle`, `title`, `subtitle`,
`leading`, `back`, `truncate`, `header` app · logo, `toast`), `CenteredLayout` (`docTitle`,
`logoLink`, `headerEnd`) with `CenteredCard` (`icon`, `eyebrow`, `title`, `message`,
`headingLevel`, `density`, `titleId`) and `CenteredMessage`.

### Inputs, misc, hooks

| Component          | Props                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------- |
| `TextField`        | `label`, `icon`, `error`, `hint`, `trailing`, `size` md · lg, `ref`; input props                              |
| `AutosizeTextarea` | `value`, `maxHeight`, `ref`; textarea props                                                                   |
| `Icon`             | `name`, `size` (scale step `xs`…`2xl` or px, **24**), `label` (otherwise decorative); `ICON_SIZE`, `iconPx()` |
| `Spinner`          | `size` (scale step or px, **20**), `label` (**"Lädt"**, `role="status"`)                                      |
| `ProgressBar`      | `value` (0–1, `null` = indeterminate), `label`                                                                |
| `Kbd` `ReturnKey`  | Shortcut hint chip; the ↵ glyph                                                                               |
| `Logo`             | `withText` (**true**), `onAnimationEnd`                                                                       |
| `brand/*`          | `MicrosoftMark` `GoogleMark` `PasskeyMark` `PowerPointMark`                                                   |
| `hooks/*`          | `useDismiss` `usePopover` `useToast` `useMediaQuery` `useIsNarrow` `useCopyToClipboard` `useFullscreen`       |

### How to pick a control

1. **Does it navigate?** To another route → `ButtonLink` (looks like a button) or `TextLink to`
   (looks like text); out of the app → `TextLink href`. Anything that _does_ something is a
   `<button>`: `Button`, `IconButton`, or `TextLink` without `to`/`href`.
2. **Text or only an icon?** Visible label → `Button`. Icon only → `IconButton` (its `label`
   is required). A quiet action inside running text or a comment row ("Aufklappen") →
   `TextLink`, or `Button variant="ghost" size="2xs"`/`"xs"`.
3. **Which `Button` variant?** One `primary` per view (the main action). `secondary` on glass
   next to it, `soft` on cards and in lists, `ghost` for low-emphasis actions ("Abbrechen"),
   `danger` only for destructive actions – and confirm those with `ConfirmDialog`.
4. **Which size?** Match the row: `toolbar` / `IconButton md` in floating pills (40), `sm` /
   `IconButton sm` inside a `Toolbar` (32), `field` next to a `TextField` (40), `md` in dialogs
   and settings (36), `xs` / `2xs` in dense comment rows.
5. **A choice, not an action?** One of a few, always visible → `SegmentedControl`
   (`mode="tabs"` when it switches panels). On/off → `Toggle` (`SwitchTrack` inside a row
   button). An on/off tool in a toolbar → `IconButton active`. A colour → `ColorSwatches`. Many
   options → `Select`.
6. **More actions than fit?** A "…" → `Menu` (right click: `ContextMenu`). Free content in a
   floating panel → `usePopover` + `PopoverPanel` with `MenuItem` rows. A blocking question →
   `ConfirmDialog`; a form → `Dialog`.
7. **Feedback, not a control?** Inline message → `Notice`; field error → `TextField error` or
   `ErrorText`; short confirmation → `useToast`; status chip → `Badge`; hover hint → `Tooltip`
   (or the `IconButton` `title`).

## 11. File structure (`apps/web/src`)

```
app/            router, App, RouteError, NotFoundPage — only wiring; nothing imports app/
shell/          AppHeader, CenteredMessage (app chrome shared by several features)
ui/             design-system primitives; never imports features or shell/
  brand/        provider and app marks (Google, Microsoft, Passkey, PowerPoint)
  hooks/        generic UI hooks (useDismiss, useToast, useCopyToClipboard, useMediaQuery,
                useFullscreen)
lib/            pure, app-wide code: api-client, api/ (query hooks per domain, one barrel
                api/index.ts), routes (typed URL builders), return-to, format, dom, motion,
                accent, palette, platform, passkeys, deck-labels, last-visits,
                generated-avatar, preferences/ (box-mode, split, work-preferences)
styles/         index.css (tokens), token tests, raw-colour allowlist
features/<f>/   <Page>.tsx at the root, components/, hooks/, lib/, index.ts (public API,
                only where another feature imports it: auth, workspaces, viewer)
```

- Inside a feature: relative imports. Across features: only `@/features/<f>` (its `index.ts`;
  barrels never re-export route pages, so each keeps its own lazy chunk).
  `app/router.tsx` may import route pages directly (lazy routes). ESLint enforces this with
  `no-restricted-imports` in `eslint.config.js`: no `@/features/<f>/…` deep imports outside the
  router, no `@/app` from features, shell, ui or lib, and no features or shell from ui or lib.
- `lib/` holds pure functions and stores; `use*` hooks live in `hooks/`.
- Tests sit next to the module (`foo.ts` → `foo.test.ts`); component tests are `*.test.tsx`
  and run in happy-dom.
- The viewer is the one large feature and is split by sub-domain (`comments`, `connectors`,
  `controls`, `import`, `live`, `media`, `revisions`, `stage`, `state`, `timeline`), each with
  its own `hooks/` and `lib/` where needed.
