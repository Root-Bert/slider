"""
Writes the Slider logo files into brand/logo/, one folder per layout: the mark (two stacked
slides with a comment box over them) beside the word "Slider", above it, alone, and the word
alone, for light and dark backgrounds; and the app icon. SVGs carry the word as outlines (Inter,
weight 600, as the app's Logo draws it), so they look the same everywhere; scripts/logo-png.ts
renders the PNGs from them.

Geometry and colours are the brand guide's (Figma, page "Playground"), as in
apps/web/src/ui/Logo.tsx (there at a quarter of this size) and apps/web/public/app-icon.svg.

Needs fontTools with brotli (pip install fonttools brotli); run from the repository root:

    python3 scripts/logo-files.py
"""

from pathlib import Path

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

OUT = Path("brand/logo")
# The web app's own copy of Inter (bun install puts it there).
FONT = "apps/web/node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2"

# The brand guide's word mark: a 96 × 80 mark, 24 gap, 72 px Inter Semi Bold, tracking -2.5 %.
MARK_W, MARK_H = 96, 80
SIZE, GAP, TRACKING = 72.0, 24.0, -0.025
# Above the word, the mark is drawn this much larger and this far (px) from the word's cap top.
STACK_SCALE, STACK_GAP = 1.6, 48.0

ORANGE = "#e3583d"
# The slides are the orange laid over the ground (white or black), their lines in the ground's
# colour; the comment box is solid orange.
VARIANTS = {
    "light": {"ground": "#ffffff", "back": 0.3, "front": 0.5, "ink": 'fill="#141414"'},
    "dark": {"ground": "#000000", "back": 0.53, "front": 0.69, "ink": 'fill="#ffffff" fill-opacity=".9"'},
}

# The mark in greys, as the brand guide's monochrome icons (the app's own header): back, front,
# lines, comment box; the tile behind them in `icon/`.
MONO = {
    "light": {"tile": "#ffffff", "back": "#c7c7c7", "front": "#a3a3a3", "lines": "#262626", "bubble": "#1f1f1f"},
    "dark": {"tile": "#000000", "back": "#525252", "front": "#7a7a7a", "lines": "#ebebeb", "bubble": "#f5f5f5"},
}
# The full-bleed 256 square ("Web-App-Icons / Dock-Export"; the app icon is the same with rounded
# corners): the orange one's comment box outlined in the tile's colour, the grey ones' not.
DOCK = (
    '<rect width="256" height="256" fill="{tile}"/>'
    '<rect x="24.32" y="41.6" width="172.8" height="97.2" rx="25.92" fill="{back}"/>'
    '<rect x="45.92" y="117.2" width="172.8" height="97.2" rx="25.92" fill="{front}"/>'
    '<path d="M49.16 57.8h66M70.76 175.52h5M91.28 175.52h82M70.76 193.88h5M91.28 193.88h54" '
    'stroke="{lines}" stroke-width="6" stroke-linecap="round"/>'
    '<path d="M110.72 62.12h86.4a34.56 34.56 0 0 1 34.56 34.56v28.08a34.56 34.56 0 0 1-34.56 34.56H84.8'
    'a8.64 8.64 0 0 1-8.64-8.64V96.68a34.56 34.56 0 0 1 34.56-34.56Z" fill="{bubble}" stroke="{outline}" stroke-width="4"/>'
)

LINES = "M11.5 7.5h33M21.5 62H24M31 62h41M21.5 70.5H24M31 70.5h27"
BUBBLE = "M40 9.5h40a16 16 0 0 1 16 16v13a16 16 0 0 1-16 16H28a4 4 0 0 1-4-4V25.5a16 16 0 0 1 16-16Z"


def flatten(alpha: float, ground: str) -> str:
    """The orange at `alpha` over the solid `ground`, as one opaque colour."""
    top = [int(ORANGE[i : i + 2], 16) for i in (1, 3, 5)]
    base = [int(ground[i : i + 2], 16) for i in (1, 3, 5)]
    # Halves round up, as Figma's hex values do.
    return "#" + "".join(f"{int(t * alpha + b * (1 - alpha) + 0.5):02x}" for t, b in zip(top, base))


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


def mark(variant: dict) -> str:
    ground = variant["ground"]
    return mark_in(flatten(variant["back"], ground), flatten(variant["front"], ground), ground, ORANGE)


def mark_in(back: str, front: str, lines: str, bubble: str) -> str:
    return (
        f'<rect width="80" height="45" rx="12" fill="{back}"/>'
        f'<rect x="10" y="35" width="80" height="45" rx="12" fill="{front}"/>'
        f'<path d="{LINES}" stroke="{lines}" stroke-width="3" stroke-linecap="round"/>'
        f'<path d="{BUBBLE}" fill="{bubble}"/>'
    )


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

    for mode, variant in VARIANTS.items():
        ink = variant["ink"]
        name = f"slider-{mode}"
        icon = mark(variant)
        write("word", name, svg(round(ink_width, 2), round(y1 - y0, 2), word(-x0, -y0, ink)))
        write("mark", name, svg(MARK_W, MARK_H, icon))
        write("horizontal", name, svg(beside_width, MARK_H, icon + word(MARK_W + GAP, MARK_H / 2 + cap / 2, ink)))
        big = f'<g transform="translate({mark_x:.3f} 0) scale({STACK_SCALE:g})">{icon}</g>'
        word_left = (stack_width - ink_width) / 2 - x0
        write("stacked", name, svg(stack_width, stack_height, big + word(word_left, stack_baseline, ink)))

        # The same in greys: the mark alone and beside the word, as the app's header shows it.
        grey = MONO[mode]
        icon = mark_in(grey["back"], grey["front"], grey["lines"], grey["bubble"])
        write("mark", f"slider-mono-{mode}", svg(MARK_W, MARK_H, icon))
        write(
            "horizontal",
            f"slider-mono-{mode}",
            svg(beside_width, MARK_H, icon + word(MARK_W + GAP, MARK_H / 2 + cap / 2, ink)),
        )
        write("icon", f"slider-mono-{mode}", svg(256, 256, DOCK.format(**grey, outline="none")))

    # The Dock tile (full bleed, the platform rounds it) and the app icon as the web app ships it
    # (`any`, rounded corners).
    write(
        "icon",
        "slider-dock",
        svg(256, 256, DOCK.format(tile=ORANGE, back="#eb8a77", front="#f1ac9e", lines=ORANGE, bubble="#ffffff", outline=ORANGE)),
    )
    app_icon = Path("apps/web/public/app-icon.svg").read_text().replace(
        'viewBox="0 0 256 256"', 'width="256" height="256" viewBox="0 0 256 256"'
    )
    write("icon", "slider-app-icon", app_icon)


if __name__ == "__main__":
    main()
