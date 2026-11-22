"""
Writes the Slider logo files into brand/logo/, one folder per layout: the mark (a pull-down
screen with a bar chart, a comment box over it) beside the word "Slider", above it, alone, and the word
alone, for light and dark backgrounds, plus the 256 icon tiles in `icon/`. SVGs carry the word
as outlines (Inter, weight 600, as the app's Logo draws it), so they look the same everywhere;
scripts/logo-png.ts renders the PNGs from them.

Geometry, colours and effects are the brand guide's (Figma, page "Brand Guide": "Slider Mark",
"Icon-Exporte"), as in apps/web/src/ui/Logo.tsx (there at a quarter of the mark's size). The app
icon is a separate Icon Composer export; this script leaves it untouched.

Needs fontTools with brotli (pip install fonttools brotli); run from the repository root:

    python3 scripts/logo-files.py
"""

import math
from pathlib import Path

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

OUT = Path("brand/logo")
# The web app's own copy of Inter (bun install puts it there).
FONT = "apps/web/node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2"

# The brand guide's word mark: a 96.2 × 89 mark, 24 gap, 72 px Inter Semi Bold, tracking -2.5 %.
MARK_W, MARK_H = 96.2, 89.0
SIZE, GAP, TRACKING = 72.0, 24.0, -0.025
# Above the word, the mark is drawn this much larger and this far (px) from the word's cap top.
STACK_SCALE, STACK_GAP = 1.6, 48.0

ORANGE = "#e3583d"
# Solver's, Writer's and Cloud's colours, in the Dock tile's gradient
GREEN, BLUE, PURPLE = "#009572", "#003399", "#6a3fc4"

# The mark's parts as the 256 icon tiles place them ("Icon-Exporte", Figma „Zugband – Balken“):
# a projection screen on a tripod, under its roll, a title line and a bar chart on it, the comment
# box over it with its bottom-left corner nearly sharp. Boxes are x, y, width, height and corner
# radius; the title x, y, length; the bars x and top, standing on BASE; the legs run from LEGS_TOP
# (behind the screen) to their feet. The mark alone is the same shrunk by TILE_SCALE
# round TILE_ORIGIN, centred in the 96.2 × 89 "Slider Mark" frame.
TILE_SCALE, TILE_ORIGIN = 2.1, (32.83, 40.05)
ROLL = (36.0, 42.0, 168.0, 14.0, 7.0)
SCREEN = (44.0, 52.0, 152.0, 154.0, 10.0)
TITLE = (54.0, 74.0, 12.0)
BARS, BAR_W, BASE = (
    [
        (54.0, 150.0),
        (76.0, 178.0),
        (98.0, 132.0),
        (120.0, 168.0),
        (142.0, 184.0),
        (164.0, 120.0),
    ],
    16.0,
    196.0,
)
LEGS_TOP, FEET = (120.0, 146.0), [(84.0, 222.0), (156.0, 222.0), (120.0, 214.0)]
BUBBLE = (76.16, 62.12, 155.52, 97.2, 34.56, 8.64)
# Stroke widths in the tile's units (the mark shrinks them with it).
TITLE_LINE, LEG_LINE = 6.0, 7.0

# The legs, the screen, the bars and the roll are the orange laid over the ground (white or
# black); the title line and the comment box are solid orange.
VARIANTS = {
    "light": {
        "ground": "#ffffff",
        "legs": 0.3,
        "roll": 0.9,
        "screen": 0.5,
        "bars": 0.65,
        "ink": 'fill="#141414"',
    },
    "dark": {
        "ground": "#000000",
        "legs": 0.69,
        "roll": 0.9,
        "screen": 0.53,
        "bars": 0.8,
        "ink": 'fill="#ffffff" fill-opacity=".9"',
    },
}

# The mark in greys, as the brand guide's monochrome icons (the app's own header): tile, legs,
# roll, screen, bars, title, comment box, and the comment box's inner edge in the tiles ("doppelte Kante").
MONO = {
    "light": {
        "tile": "#ffffff",
        "legs": "#a3a3a3",
        "roll": "#525252",
        "screen": "#c7c7c7",
        "bars": "#7a7a7a",
        "title": "#262626",
        "bubble": "#1f1f1f",
        "edge": "#f0f0f0",
    },
    "dark": {
        "tile": "#000000",
        "legs": "#7a7a7a",
        "roll": "#c7c7c7",
        "screen": "#525252",
        "bars": "#a3a3a3",
        "title": "#ebebeb",
        "bubble": "#f5f5f5",
        "edge": "#181818",
    },
}
# The Dock tile: white 70 % / 50 % / 10 % over the orange (legs, screen, roll), orange bars and
# title, a white comment box with an orange inner edge.
DOCK = {
    "legs": "#f7cdc5",
    "roll": "#e66950",
    "screen": "#f1ac9e",
    "bars": ORANGE,
    "title": ORANGE,
    "bubble": "#ffffff",
    "edge": ORANGE,
}


def num(v: float) -> str:
    return f"{round(v, 4):g}"


def flatten(alpha: float, ground: str, top: str = ORANGE) -> str:
    """`top` at `alpha` over the solid `ground`, as one opaque colour."""
    a = [int(top[i : i + 2], 16) for i in (1, 3, 5)]
    b = [int(ground[i : i + 2], 16) for i in (1, 3, 5)]
    # Halves round up, as Figma's hex values do.
    return "#" + "".join(
        f"{int(t * alpha + g * (1 - alpha) + 0.5):02x}" for t, g in zip(a, b)
    )


def mix(c1: str, c2: str, t: float) -> str:
    return flatten(t, c1, c2)


class Place:
    """Maps the tile's coordinates into an SVG: `scale` times their distance from TILE_ORIGIN
    (the mark alone), or as they are (a tile)."""

    def __init__(
        self, tile: bool, scale: float = 1.0, at: tuple[float, float] = (0.0, 0.0)
    ):
        self.k = scale if tile else scale / TILE_SCALE
        self.ox, self.oy = (0.0, 0.0) if tile else TILE_ORIGIN
        self.at = at

    def x(self, v: float) -> float:
        return (v - self.ox) * self.k + self.at[0]

    def y(self, v: float) -> float:
        return (v - self.oy) * self.k + self.at[1]

    def rect(self, part: tuple, fill: str, extra: str = "") -> str:
        x, y, w, h, r = part
        return (
            f'<rect x="{num(self.x(x))}" y="{num(self.y(y))}" width="{num(w * self.k)}" '
            f'height="{num(h * self.k)}" rx="{num(r * self.k)}" fill="{fill}"{extra}/>'
        )

    def line(
        self, x: float, y: float, dx: float, dy: float, stroke: str, width: float
    ) -> str:
        """A line with round ends from (x, y), `dx` across and `dy` down."""
        return (
            f'<path d="M{num(self.x(x))} {num(self.y(y))}l{num(dx * self.k)} {num(dy * self.k)}" '
            f'stroke="{stroke}" stroke-width="{num(width * self.k)}" stroke-linecap="round"/>'
        )

    def circle(self, cx: float, cy: float, r: float, fill: str, extra: str = "") -> str:
        return f'<circle cx="{num(self.x(cx))}" cy="{num(self.y(cy))}" r="{num(r * self.k)}" fill="{fill}"{extra}/>'

    def bubble_d(self) -> str:
        x, y, w, h, r, s = BUBBLE
        x, y, w, h, r, s = (
            self.x(x),
            self.y(y),
            w * self.k,
            h * self.k,
            r * self.k,
            s * self.k,
        )
        return (
            f"M{num(x + r)} {num(y)}h{num(w - 2 * r)}a{num(r)} {num(r)} 0 0 1 {num(r)} {num(r)}"
            f"v{num(h - 2 * r)}a{num(r)} {num(r)} 0 0 1-{num(r)} {num(r)}H{num(x + s)}"
            f"a{num(s)} {num(s)} 0 0 1-{num(s)}-{num(s)}V{num(y + r)}a{num(r)} {num(r)} 0 0 1 {num(r)}-{num(r)}Z"
        )


def screen(place: Place, c: dict, shadow: str = "") -> str:
    """Everything under the comment box, back to front: the legs, the screen with its title line
    and bars, the roll. `shadow` on the screen and the roll."""
    x, y, n = TITLE
    lx, ly = LEGS_TOP
    return (
        "".join(
            place.line(lx, ly, fx - lx, fy - ly, c["legs"], LEG_LINE) for fx, fy in FEET
        )
        + place.rect(SCREEN, c["screen"], shadow)
        + place.line(x, y, n, 0, c["title"], TITLE_LINE)
        + "".join(
            place.rect((bx, bt, BAR_W, BASE - bt, 4.0), c["bars"]) for bx, bt in BARS
        )
        + place.rect(ROLL, c["roll"], shadow)
    )


def mark(place: Place, c: dict) -> str:
    """The flat mark: no shadows, the comment box solid."""
    return screen(place, c) + f'<path d="{place.bubble_d()}" fill="{c["bubble"]}"/>'


# Every part of a tile casts the brand guide's shadow: black 25 %, 8 blur, 2 left and 4 down.
SHADOW = (
    # over the whole tile: a box around each part would clip the shadow of the thin roll
    '<filter id="shadow" filterUnits="userSpaceOnUse" x="-16" y="-16" width="288" height="288" color-interpolation-filters="sRGB">'
    '<feDropShadow dx="-2" dy="4" stdDeviation="4" flood-color="#000000" flood-opacity=".25"/></filter>'
)


def tile(ground: str, c: dict, edge: str | None) -> str:
    """A 256 tile: the screen, the roll and the comment box with their shadow; with `edge`, the comment box
    has the guide's double edge – outlined 4 in its own colour, a band of `edge` 6 deep inside its
    outline (Figma's inner shadow, spread 8, renders that deep)."""
    p = Place(tile=True)
    d = p.bubble_d()
    bubble = c["bubble"]
    if edge:
        box = (
            f'<path d="{d}" fill="{bubble}"/>'
            f'<path d="{d}" stroke="{edge}" stroke-width="12" clip-path="url(#box)"/>'
            f'<path d="{d}" stroke="{bubble}" stroke-width="4"/>'
        )
        defs = f'<clipPath id="box"><path d="{d}"/></clipPath>'
    else:
        box, defs = f'<path d="{d}" fill="{bubble}"/>', ""
    return (
        f"<defs>{SHADOW}{defs}</defs>"
        + ground
        + screen(p, c, ' filter="url(#shadow)"')
        + f'<g filter="url(#shadow)">{box}</g>'
    )


def dock_ground() -> str:
    """Slider orange under the guide's angular gradient (orange, Solver green at 25 %, Writer
    blue at 50 %, Cloud purple at 75 %, orange), centred 128 above the tile – drawn as 1° wedges,
    as SVG has no conic gradient. Its angle runs clockwise from straight down."""
    stops = [(0.0, ORANGE), (0.25, GREEN), (0.5, BLUE), (0.75, PURPLE), (1.0, ORANGE)]

    def colour(pos: float) -> str:
        for (p0, c0), (p1, c1) in zip(stops, stops[1:]):
            if pos <= p1:
                return mix(c0, c1, (pos - p0) / (p1 - p0))
        return ORANGE

    cx, cy, far = 128.0, -128.0, 800.0
    wedges = []
    for deg in range(-46, 47):
        # A wedge a little wider than its degree, so no seam shows between neighbours.
        a0, a1 = math.radians(deg - 0.5), math.radians(deg + 0.6)
        pts = [(cx, cy)] + [
            (cx - far * math.sin(a), cy + far * math.cos(a)) for a in (a0, a1)
        ]
        d = "M" + "L".join(f"{num(x)} {num(y)}" for x, y in pts) + "Z"
        wedges.append(f'<path d="{d}" fill="{colour((deg % 360) / 360)}"/>')
    return (
        '<clipPath id="tile"><rect width="256" height="256"/></clipPath>'
        f'<g clip-path="url(#tile)"><rect width="256" height="256" fill="{ORANGE}"/>{"".join(wedges)}</g>'
    )


def word_paths() -> tuple[str, float, float, tuple[float, float, float, float]]:
    """The word as one SVG path in px (baseline at y = 0), its advance width, its cap height and
    its ink bounds (x min, y min, x max, y max)."""
    font = instantiateVariableFont(TTFont(FONT), {"wght": 600})
    glyphs, cmap = font.getGlyphSet(), font.getBestCmap()
    scale = SIZE / font["head"].unitsPerEm
    pen = SVGPathPen(glyphs)
    bounds = BoundsPen(glyphs)
    x = 0.0
    for i, char in enumerate("Slider"):
        name = cmap[ord(char)]
        if i:
            x += TRACKING * SIZE
        # Flip y: font units grow upwards, SVG downwards; baseline at y = 0.
        for target in (pen, bounds):
            glyphs[name].draw(TransformPen(target, (scale, 0, 0, -scale, x, 0)))
        x += glyphs[name].width * scale
    cap = font["OS/2"].sCapHeight * scale
    return pen.getCommands(), x, cap, bounds.bounds


def svg(width: float, height: float, body: str) -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width:g}" height="{height:g}" '
        f'viewBox="0 0 {width:g} {height:g}" fill="none">{body}</svg>\n'
    )


def write(layout: str, name: str, content: str) -> None:
    (OUT / layout).mkdir(parents=True, exist_ok=True)
    (OUT / layout / f"{name}.svg").write_text(content)
    print(f"wrote {layout}/{name}.svg")


def main() -> None:
    path, word_width, cap, (x0, y0, x1, y1) = word_paths()

    def word(x: float, baseline: float, ink: str) -> str:
        return f'<path transform="translate({x:.3f} {baseline:.3f})" d="{path}" {ink}/>'

    # Beside: the word's capitals centred on the mark's height, as in the app.
    beside_width = round(MARK_W + GAP + word_width, 2)
    # Above: the larger mark centred over the word's ink, the box tight around both.
    ink_width = x1 - x0
    big_w, big_h = MARK_W * STACK_SCALE, MARK_H * STACK_SCALE
    stack_width = round(max(big_w, ink_width), 2)
    stack_baseline = big_h + STACK_GAP + cap
    stack_height = round(stack_baseline + y1, 2)
    mark_x = (stack_width - big_w) / 2
    alone, big = Place(tile=False), Place(tile=False, scale=STACK_SCALE, at=(mark_x, 0))

    for mode, variant in VARIANTS.items():
        ink, ground = variant["ink"], variant["ground"]
        name = f"slider-{mode}"
        colours = {
            "legs": flatten(variant["legs"], ground),
            "roll": flatten(variant["roll"], ground),
            "screen": flatten(variant["screen"], ground),
            "bars": flatten(variant["bars"], ground),
            "title": ORANGE,
            "bubble": ORANGE,
        }
        icon = mark(alone, colours)
        write(
            "word",
            name,
            svg(round(ink_width, 2), round(y1 - y0, 2), word(-x0, -y0, ink)),
        )
        write("mark", name, svg(MARK_W, MARK_H, icon))
        write(
            "horizontal",
            name,
            svg(
                beside_width,
                MARK_H,
                icon + word(MARK_W + GAP, MARK_H / 2 + cap / 2, ink),
            ),
        )
        word_left = (stack_width - ink_width) / 2 - x0
        write(
            "stacked",
            name,
            svg(
                stack_width,
                stack_height,
                mark(big, colours) + word(word_left, stack_baseline, ink),
            ),
        )
        # The mark as it is on a white or black tile ("App-Icons / Weißer/Schwarzer Hintergrund").
        on = "white" if mode == "light" else "black"
        write(
            "icon",
            f"slider-{on}",
            svg(
                256,
                256,
                tile(
                    f'<rect width="256" height="256" fill="{ground}"/>', colours, None
                ),
            ),
        )

        # The same in greys: the mark alone and beside the word, as the app's header shows it.
        grey = MONO[mode]
        icon = mark(alone, grey)
        write("mark", f"slider-mono-{mode}", svg(MARK_W, MARK_H, icon))
        write(
            "horizontal",
            f"slider-mono-{mode}",
            svg(
                beside_width,
                MARK_H,
                icon + word(MARK_W + GAP, MARK_H / 2 + cap / 2, ink),
            ),
        )
        write(
            "icon",
            f"slider-mono-{mode}",
            svg(
                256,
                256,
                tile(
                    f'<rect width="256" height="256" fill="{grey["tile"]}"/>',
                    grey,
                    grey["edge"],
                ),
            ),
        )

    # The full-bleed Dock tile, kept as a brand asset. The web app uses the Composer PNG.
    write("icon", "slider-dock", svg(256, 256, tile(dock_ground(), DOCK, DOCK["edge"])))


if __name__ == "__main__":
    main()
