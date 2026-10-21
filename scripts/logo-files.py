"""
Writes the Slider logo files into brand/logo/, one folder per layout: the mark (two offset
slides) beside the word "Slider", above it, alone, and the word alone; for dark and light
backgrounds, each monochrome, in sage and in sky blue. SVGs carry the word as outlines (Inter,
weight 600, as the app's Logo draws it), so they look the same everywhere; scripts/logo-png.ts
renders the PNGs from them.

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

# apps/web/src/ui/Logo.tsx: 22 × 18 mark, 8 px gap, text-lg (18 px) semibold, tracking-tight.
SIZE, GAP, TRACKING = 18.0, 8.0, -0.025
BACK_OPACITY = 0.45  # THEME.logoBackOpacity
# The front slide lets the back one show through where they overlap.
FRONT_OPACITY = 0.8
# The colour logos: the website's accent (--color-sage) and its blue sibling at the same lightness
# (--color-sky). Their back slide has the colour too instead of grey: a dark shade of it on light
# backgrounds, the colour dimmed on dark ones.
COLORS = {
    "sage": {"front": "#8fcb9b", "light": ("#3d7a4b", 0.6), "dark": ("#8fcb9b", BACK_OPACITY)},
    "sky": {"front": "#8dadd7", "light": ("#3b5f91", 0.6), "dark": ("#8dadd7", BACK_OPACITY)},
}
# Above the word, the mark is drawn this much larger and this far (px) from the word's cap top.
STACK_SCALE, STACK_GAP = 1.6, 12.0
# The slides' own extent inside the mark's 22 × 18 box: x 1-20, y 1-16.
MARK_INK = (1, 1, 20, 16)
VARIANTS = {
    "dark": {"ink": "#ffffff"},  # for dark backgrounds
    "light": {"ink": "#000000"},  # for light backgrounds
}


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


def mark(back: str, back_opacity: float, front: str) -> str:
    return (
        f'<rect x="1" y="5" width="15" height="11" rx="2.5" fill="{back}" fill-opacity="{back_opacity:g}"/>'
        f'<rect x="5" y="1" width="15" height="11" rx="2.5" fill="{front}" fill-opacity="{FRONT_OPACITY}"/>'
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
        return f'<path transform="translate({x:.3f} {baseline:.3f})" d="{path}" fill="{ink}"/>'

    # Beside: the word's capitals centred on the mark's height, as in the app.
    beside_width = round(22 + GAP + word_width, 2)
    # Above: the larger slides centred over the word's ink, the box tight around both.
    ink_width, ink_height = x1 - x0, y1 - y0
    mx0, my0, mx1, my1 = (v * STACK_SCALE for v in MARK_INK)
    stack_width = round(max(mx1 - mx0, ink_width), 2)
    stack_baseline = my1 - my0 + STACK_GAP + cap
    stack_height = round(stack_baseline + y1, 2)
    mark_x = (stack_width - (mx1 - mx0)) / 2 - mx0

    for mode, colors in VARIANTS.items():
        ink = colors["ink"]
        write("word", f"slider-{mode}-word", svg(round(ink_width, 2), round(ink_height, 2), word(-x0, -y0, ink)))
        styles = {"mono": (ink, (ink, BACK_OPACITY))}
        styles.update({name: (c["front"], c[mode]) for name, c in COLORS.items()})
        for style, (front, back) in styles.items():
            name = f"slider-{mode}-{style}"
            icon = mark(*back, front)
            write("mark", name, svg(22, 18, icon))
            write("horizontal", name, svg(beside_width, 18, icon + word(22 + GAP, 9 + cap / 2, ink)))
            big = f'<g transform="translate({mark_x:.3f} {-my0:g}) scale({STACK_SCALE:g})">{icon}</g>'
            word_left = (stack_width - ink_width) / 2 - x0
            write("stacked", name, svg(stack_width, stack_height, big + word(word_left, stack_baseline, ink)))


if __name__ == "__main__":
    main()
