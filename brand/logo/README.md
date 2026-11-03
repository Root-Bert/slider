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
| `icon/`       | app icon, Dock tile, greys   | 1024 px   |

Each layout comes for light backgrounds (`slider-light`) and dark ones (`slider-dark`):

| Name           | Slides (Slider orange `#e3583d` over the ground)                | Lines | Comment box | Word             |
| -------------- | --------------------------------------------------------------- | ----- | ----------- | ---------------- |
| `slider-light` | back 30 % over white `#f7cdc5`, front 50 % `#f1ac9e`            | white | orange      | `#141414`        |
| `slider-dark`  | back 53 % over black `#782f20`, front 69 % `#9d3d2a`            | black | orange      | white at 90 %    |

In greys (`slider-mono-light` / `slider-mono-dark`, in `mark/`, `horizontal/` and as tiles in
`icon/`) – the brand guide's monochrome icons, the web app's own header:

| Name                | Tile      | Back slide | Front slide | Lines     | Comment box |
| ------------------- | --------- | ---------- | ----------- | --------- | ----------- |
| `slider-mono-light` | `#ffffff` | `#c7c7c7`  | `#a3a3a3`   | `#262626` | `#1f1f1f`   |
| `slider-mono-dark`  | `#000000` | `#525252`  | `#7a7a7a`   | `#ebebeb` | `#f5f5f5`   |

`icon/slider-dock` is the full-bleed square ("Web-App-Icons / Dock-Export"): the app icon
without its rounded corners – the platform rounds it (macOS Dock, iOS, Android). The web
app ships it as its `maskable` icon and `apple-touch-icon`.

The app icon is the mark on Slider orange: back slide `#eb8a77` (white 30 % over the orange),
front `#f1ac9e` (white 50 %), orange lines, a white comment box with a 4 px orange outline (at
256), no shadow; the grey tiles' comment box has no outline. Geometry from the brand guide: the mark 96 × 80, 24 gap,
the word in Inter Semi Bold at 72 px, tracking −2.5 %.

The files come from `scripts/logo-files.py` (SVG) and `scripts/logo-png.ts` (PNG – it also
renders the web app's icons from `apps/web/public/app-icon*.svg`).

The name and logo of Slider are not licensed under the EUPL: all rights reserved.
