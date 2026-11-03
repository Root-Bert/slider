"""
Fetches the Google Fonts Slider draws slides in besides the office fonts (BER-183): regular,
bold, italic and bold italic of each as static TrueType files from the Google Fonts CSS API.
Writes the TTFs into fonts/google/ (installed for LibreOffice in the Docker image) and the same
faces as WOFF2 into apps/web/public/fonts/office/ (the live editor), and prints each font's
entry for apps/web/src/features/viewer/editing/live/fonts.ts – hhea ascent and descent, as
LibreOffice lays out with them.

Needs fontTools with brotli (pip install fonttools brotli); run from the repository root:

    python3 scripts/google-fonts.py
"""

import io
import re
import urllib.request
from pathlib import Path

from fontTools.ttLib import TTFont

# The 20 most used families of Google Fonts, sans, serif and mono – and 80 more for slides
# (BER-183): sans, display, serif, mono and handwriting. Latin faces; a family Google has no bold
# or italic of is drawn with a synthesised one.
FAMILIES = [
    'Roboto',
    'Open Sans',
    'Noto Sans',
    'Montserrat',
    'Inter',
    'Lato',
    'Poppins',
    'Roboto Condensed',
    'Oswald',
    'Raleway',
    'Nunito',
    'Ubuntu',
    'Rubik',
    'Work Sans',
    'PT Sans',
    'Playfair Display',
    'Merriweather',
    'Lora',
    'Noto Serif',
    'Roboto Mono',
    # Sans
    'Source Sans 3',
    'Nunito Sans',
    'Fira Sans',
    'Barlow',
    'Barlow Condensed',
    'DM Sans',
    'Manrope',
    'IBM Plex Sans',
    'Karla',
    'Titillium Web',
    'Josefin Sans',
    'Libre Franklin',
    'Mulish',
    'Quicksand',
    'Archivo',
    'Space Grotesk',
    'Outfit',
    'Plus Jakarta Sans',
    'Lexend',
    'Figtree',
    'Red Hat Display',
    'Sora',
    'Urbanist',
    'Public Sans',
    'Jost',
    'Be Vietnam Pro',
    'Hanken Grotesk',
    'Geist',
    'Bricolage Grotesque',
    'Instrument Sans',
    'Cabin',
    'Exo 2',
    'Kanit',
    'Asap',
    # Display
    'Bebas Neue',
    'Anton',
    'Archivo Black',
    'Fjalla One',
    'Teko',
    'Dosis',
    'Comfortaa',
    'Varela Round',
    'Fredoka',
    'Righteous',
    # Serif
    'Source Serif 4',
    'PT Serif',
    'Libre Baskerville',
    'EB Garamond',
    'Cormorant Garamond',
    'Crimson Pro',
    'Bitter',
    'Roboto Slab',
    'Zilla Slab',
    'Arvo',
    'DM Serif Display',
    'Spectral',
    'Alegreya',
    'Vollkorn',
    'Literata',
    'Fraunces',
    'Newsreader',
    'Frank Ruhl Libre',
    'Abril Fatface',
    'Cinzel',
    'Instrument Serif',
    # Mono
    'Source Code Pro',
    'Fira Code',
    'JetBrains Mono',
    'IBM Plex Mono',
    'Space Mono',
    'Inconsolata',
    # Handwriting
    'Dancing Script',
    'Caveat',
    'Pacifico',
    'Lobster',
    'Permanent Marker',
    'Indie Flower',
    'Great Vibes',
    'Amatic SC',
    'Satisfy',
]

FACES = [('Regular', 0, 400), ('Bold', 0, 700), ('Italic', 1, 400), ('BoldItalic', 1, 700)]

TTF_DIR = Path('fonts/google')
WOFF2_DIR = Path('apps/web/public/fonts/office')


def fetch(url: str) -> bytes:
    # No browser user agent: the API answers with whole TrueType files.
    request = urllib.request.Request(url, headers={'User-Agent': 'curl/8'})
    with urllib.request.urlopen(request) as response:
        return response.read()


def faces_of(family: str) -> dict[tuple[int, int], str]:
    """The TTF address of each face Google has of the family, by (italic, weight)."""
    query = ';'.join(f'{italic},{weight}' for _, italic, weight in FACES)
    css = fetch(
        f"https://fonts.googleapis.com/css2?family={family.replace(' ', '+')}:ital,wght@{query}"
    ).decode()
    found = {}
    for block in css.split('@font-face')[1:]:
        italic = 1 if 'font-style: italic' in block else 0
        weight = int(re.search(r'font-weight: (\d+)', block).group(1))
        found[(italic, weight)] = re.search(r'url\((\S+?\.ttf)\)', block).group(1)
    return found


def main() -> None:
    TTF_DIR.mkdir(parents=True, exist_ok=True)
    WOFF2_DIR.mkdir(parents=True, exist_ok=True)
    for family in FAMILIES:
        stem = family.replace(' ', '')
        urls = faces_of(family)
        files = []
        metrics = None
        for face, italic, weight in FACES:
            local = TTF_DIR / f'{stem}-{face}.ttf'
            url = urls.get((italic, weight))
            if not url and not local.exists():
                files.append(None)
                continue
            # A face already in the checkout stays as it is: refetched, a newer version could
            # break lines elsewhere in decks drawn with it.
            data = local.read_bytes() if local.exists() else fetch(url)
            font = TTFont(io.BytesIO(data))
            # LibreOffice finds the face by its family name: it must be the one decks name.
            name = font['name'].getBestFamilyName()
            if name != family:
                raise SystemExit(f'{family} {face}: the file names its family {name!r}')
            local.write_bytes(data)
            if not (WOFF2_DIR / f'{stem}-{face}.woff2').exists():
                font.flavor = 'woff2'
                font.save(WOFF2_DIR / f'{stem}-{face}.woff2')
            files.append(f'{stem}-{face}')
            if metrics is None:
                metrics = (font['head'].unitsPerEm, font['hhea'].ascent, -font['hhea'].descent)
        upm, ascent, descent = metrics
        listed = ', '.join(f"'{file}'" if file else 'null' for file in files)
        print(f"  '{family}': {{ files: [{listed}], upm: {upm}, ascent: {ascent}, descent: {descent} }},")


if __name__ == '__main__':
    main()
