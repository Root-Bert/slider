# Slider logo

The mark – two stacked slides (the deck) with a comment box over them, its bottom-left corner
nearly sharp like a speech bubble pointing at the slides – and the word "Slider", as SVG (the
word as outlines, no font needed) and as PNG with a transparent background, one folder per layout:

| Folder        | Layout                       | PNG width |
| ------------- | ---------------------------- | --------- |
| `horizontal/` | mark beside the word         | 4000 px   |
| `stacked/`    | mark above the word, centred | 2048 px   |
| `mark/`       | mark alone                   | 2048 px   |
| `word/`       | word alone                   | 4000 px   |
| `icon/`       | Composer app icon, 256 tiles | 1024 px   |

Each layout comes for light backgrounds (`slider-light`) and dark ones (`slider-dark`):

| Name           | Slides (Slider orange `#e3583d` over the ground)     | Lines | Comment box | Word          |
| -------------- | ---------------------------------------------------- | ----- | ----------- | ------------- |
| `slider-light` | back 30 % over white `#f7cdc5`, front 50 % `#f1ac9e` | white | orange      | `#141414`     |
| `slider-dark`  | back 69 % over black `#9d3d2a`, front 53 % `#782f20` | black | orange      | white at 90 % |

In greys (`slider-mono-light` / `slider-mono-dark`, in `mark/`, `horizontal/` and as tiles in
`icon/`) – the brand guide's monochrome icons, the web app's own header:

| Name                | Tile      | Back slide | Front slide | Lines     | Comment box | Its inner edge (tiles) |
| ------------------- | --------- | ---------- | ----------- | --------- | ----------- | ---------------------- |
| `slider-mono-light` | `#ffffff` | `#a3a3a3`  | `#c7c7c7`   | `#262626` | `#1f1f1f`   | `#f0f0f0`              |
| `slider-mono-dark`  | `#000000` | `#7a7a7a`  | `#525252`   | `#ebebeb` | `#f5f5f5`   | `#181818`              |

The mark (brand guide "Slider Mark", 96.2 × 89): back slide 80 × 45 at (0.93, 0.93), front slide
80 × 48.06 at (10.15, 39.91), both r 12; title line 30.56 at (12.57, 8.43), bullets and lines at
y 68.74 and 77.82 (x 21.65 / 31.15, lengths 2.31, 37.96, 25), stroke 3, square ends; comment box
72 × 45 at (24.15, 13.94), radii 16 / 16 / 16 / 4. The marks in `mark/`, `horizontal/`,
`stacked/` and the app are flat: no shadows, the comment box solid.

`icon/slider-app-icon.png` is the original 1024 × 1024 default iOS export from Apple Icon
Composer, with the glass effects baked in. The editable source and its layer images are in
`icon/Slider.icon/`. Keep the original PNG as the source; do not regenerate it from the flat logo.
The web app uses resized PNGs for its manifest (192 and 512 px) and Apple touch icon (180 px).
The export already has rounded transparent corners, so the manifest declares it only as `any`,
not `maskable`. A future maskable export needs an opaque square and a safe area for its motif.
The browser-tab favicon stays the simpler flat SVG so it reads at small sizes.

The 256 tiles in `icon/` are the brand guide's "Icon-Exporte": the mark 2.16 × as large (back
slide at 26, 34), each slide and the comment box casting a shadow (black 25 %, blur 8, 2 left and
4 down). `slider-dock` is the full-bleed Dock tile: Slider orange under an angular gradient
(orange, Solver green `#009572` at 33 %, Writer blue `#104d80` at 67 %, orange) centred 128 above
the tile, drawn as 1° wedges; back slide `#f1ac9e` (white 50 % over the orange), front `#eb8a77`
(white 30 %), orange lines 6 wide, a white comment box with the guide's double edge – a 4 outline
in its own colour, an orange band 6 deep inside it. The grey tiles have the same double edge in
their own greys. `slider-white` / `slider-black` show the mark as it is (comment box solid
orange, lines 6.48) on a white or black tile. Geometry of the word mark: 24 gap, the word in
Inter Semi Bold at 72 px, tracking −2.5 %. The guide's lines are brush strokes ("Blockbuster");
the files draw them as plain lines.

The logo files come from `scripts/logo-files.py` (SVG; e.g.
`uv run --no-project --with fonttools --with brotli python scripts/logo-files.py`) and
`scripts/logo-png.ts` (PNG).
To resize only the Composer export into the web app's icons, run
`bun scripts/logo-png.ts --app-only`. When replacing it, bump the icon URLs in
`apps/web/public/manifest.webmanifest` and `apps/web/index.html` to avoid stale browser caches.

The name and logo of Slider are not licensed under the EUPL: all rights reserved.
