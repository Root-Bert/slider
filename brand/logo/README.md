# Slider logo

The mark – a projection screen on a tripod, under its roll, a title line and a bar chart on it, and
a comment box over it, its bottom-left corner nearly sharp like a speech bubble pointing at the
slide – and the word "Slider", as SVG (the word as outlines, no font needed) and as PNG with a
transparent background, one folder per layout:

| Folder        | Layout                       | PNG width |
| ------------- | ---------------------------- | --------- |
| `horizontal/` | mark beside the word         | 4000 px   |
| `stacked/`    | mark above the word, centred | 2048 px   |
| `mark/`       | mark alone                   | 2048 px   |
| `word/`       | word alone                   | 4000 px   |
| `icon/`       | Composer app icon, 256 tiles | 1024 px   |

Each layout comes for light backgrounds (`slider-light`) and dark ones (`slider-dark`):

| Name           | Legs, screen, bars, roll (Slider orange `#e3583d` over the ground)        | Title, comment box | Word          |
| -------------- | ------------------------------------------------------------------------- | ------------------ | ------------- |
| `slider-light` | 30 % over white `#f7cdc5`, 50 % `#f1ac9e`, 65 % `#ed9281`, 90 % `#e66950` | orange             | `#141414`     |
| `slider-dark`  | 69 % over black `#9d3d2a`, 53 % `#782f20`, 80 % `#b64631`, 90 % `#cc4f37` | orange             | white at 90 % |

In greys (`slider-mono-light` / `slider-mono-dark`, in `mark/`, `horizontal/` and as tiles in
`icon/`) – the brand guide's monochrome icons, the web app's own header:

| Name                | Tile      | Legs      | Roll      | Screen    | Bars      | Title     | Comment box | Its inner edge (tiles) |
| ------------------- | --------- | --------- | --------- | --------- | --------- | --------- | ----------- | ---------------------- |
| `slider-mono-light` | `#ffffff` | `#a3a3a3` | `#525252` | `#c7c7c7` | `#7a7a7a` | `#262626` | `#1f1f1f`   | `#f0f0f0`              |
| `slider-mono-dark`  | `#000000` | `#7a7a7a` | `#c7c7c7` | `#525252` | `#a3a3a3` | `#ebebeb` | `#f5f5f5`   | `#181818`              |

The mark (brand guide "Slider Mark", 96.2 × 89) is the 256 tile's ("Zugband – Balken") shrunk
2.1 × round (32.83, 40.05): in the tile the roll 168 × 14 at (36, 42), r 7; the screen 152 × 154
at (44, 52), r 10; the title line 12 at (54, 74), 6 wide; six bars 16 wide, r 4, at x 54 + 22 n,
tops 150 / 178 / 132 / 168 / 184 / 120, standing on y 196; three legs 7 wide from (120, 146),
behind the screen, to (84, 222), (156, 222) and (120, 214); the comment box 155.52 × 97.2 at (76.16, 62.12), radii 34.56 /
34.56 / 34.56 / 8.64. The marks in `mark/`, `horizontal/`, `stacked/` and the app are flat: no
shadows, the comment box solid.

`icon/slider-app-icon.png` is the 1024 × 1024 default iOS export from Apple Icon Composer, with
the glass effects baked in. `scripts/app-icons.ts` writes the guide's „App Icon“ frame as layers
into `icon/Slider.icon/` (comment box, chart, roll, screen as glass, legs – only below the screen) and exports it with `ictool`
– as it does Cloud's, Writer's, Sender's and Reader's; do not regenerate it from the flat logo.
Its layers stand at 93 % of the brand guide's mark: the app icons share one size in the Dock –
the comment box 58 % of the tile's width, one picture in all of them: a white edge of 4, a ring
of the product's colour of 4 inside it. The bars are cut under the comment box, which lets what
is under it shine through.
The web app uses resized PNGs for its manifest (192 and 512 px) and Apple touch icon (180 px).
The export already has rounded transparent corners, so the manifest declares it only as `any`,
not `maskable`. A future maskable export needs an opaque square and a safe area for its motif.
The browser-tab favicon stays the simpler flat SVG so it reads at small sizes.

The 256 tiles in `icon/` are the brand guide's "Icon-Exporte": the screen, the roll
and the comment box casting a shadow (black 25 %, blur 8, 2 left and 4 down). `slider-dock` is
the full-bleed Dock tile: Slider orange under an angular gradient (orange, Solver green `#009572`
at 25 %, Writer blue `#003399` at 50 %, Cloud purple `#6a3fc4` at 75 %, orange) centred 128 above
the tile, drawn as 1° wedges; legs `#f7cdc5` (white 70 % over the orange), screen `#f1ac9e`
(white 50 %), roll `#e66950` (white 10 %), orange bars and title, a white comment box with the guide's double edge – a 4
outline in its own colour, an orange band 6 deep inside it. The grey tiles have the same double
edge in their own greys. `slider-white` / `slider-black` show the mark as it is (comment box
solid orange) on a white or black tile. Geometry of the word mark: 24 gap, the word in
Inter Semi Bold at 72 px, tracking −2.5 %.

The logo files come from `scripts/logo-files.py` (SVG; e.g.
`uv run --no-project --with fonttools --with brotli python scripts/logo-files.py`) and
`scripts/logo-png.ts` (PNG).
To resize only the Composer export into the web app's icons, run
`bun scripts/logo-png.ts --app-only`. When replacing it, bump the icon URLs in
`apps/web/public/manifest.webmanifest` and `apps/web/index.html` to avoid stale browser caches.

The name and logo of Slider are not licensed under the EUPL: all rights reserved.
