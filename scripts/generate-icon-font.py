#!/usr/bin/env python3
"""Build the Entirely icon font used by VS Code contributes.icons.

The font has one glyph, `entire-logo` (U+E001), built from Entire's official
small-size symbol (the brand kit's `entire-symbol-*-icon.svg`). The paths are
used exactly as the file draws them: only a uniform scale and a translate are
applied, to fit the 300-unit em with Codicon-compatible metrics (300 units/em,
300-unit advance, ascent/descent 300/0).

Each <path> in the SVG is a separate filled shape, so the eyes stay filled
shapes as in the official file. Contours are given the same winding direction
so that the non-zero fill rule of a font adds them together, as overlapping
fills do in an SVG, rather than cutting them out. Reversing a contour's
direction does not change its outline.

Requirements:
    python3 -m pip install 'fonttools[woff]'

Run from the repository root:
    python3 -I scripts/generate-icon-font.py [path/to/entire-symbol-icon.svg]

The path defaults to the vendored copy at assets/brand/entire-symbol-icon.svg.
"""

from __future__ import annotations

import sys
import xml.etree.ElementTree as ET
from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.areaPen import AreaPen
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.reverseContourPen import ReverseContourPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.svgLib.path import parse_path

UNITS_PER_EM = 300
ADVANCE_WIDTH = 300
ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = ROOT / 'assets' / 'brand' / 'entire-symbol-icon.svg'
OUTPUT = ROOT / 'assets' / 'entire-icons.woff'
ICON_ID = 'entire-logo'
CODEPOINT = 0xE001
SVG_NS = '{http://www.w3.org/2000/svg}'


def read_symbol(source: Path) -> tuple[float, list[str]]:
    """Return the square viewBox size and the path data of every <path>."""
    root = ET.parse(source).getroot()
    min_x, min_y, width, height = (float(v) for v in root.attrib['viewBox'].replace(',', ' ').split())
    if min_x != 0 or min_y != 0 or width != height:
        raise ValueError(f'expected a square viewBox at the origin, got {root.attrib["viewBox"]}')
    paths = [el.attrib['d'] for el in root.iter(f'{SVG_NS}path')]
    if not paths:
        raise ValueError(f'{source} has no <path> elements')
    return width, paths


def build_glyph(size: float, paths: list[str]):
    """Fit the symbol to the em box with a uniform scale (and the y flip a font needs)."""
    scale = UNITS_PER_EM / size
    transform = (scale, 0, 0, -scale, 0, UNITS_PER_EM)

    def area(d: str) -> float:
        pen = AreaPen()
        parse_path(d, TransformPen(pen, transform))
        return pen.value

    # The first path is the head; every other contour follows its winding.
    head_sign = area(paths[0]) > 0

    raw = TTGlyphPen(None)
    pen = Cu2QuPen(raw, max_err=0.5)
    for d in paths:
        target = pen
        if (area(d) > 0) != head_sign:
            target = ReverseContourPen(pen)
        parse_path(d, TransformPen(target, transform))
    return raw.glyph()


def build_font(source: Path) -> None:
    size, paths = read_symbol(source)
    glyph_name = ICON_ID.replace('-', '_')
    glyph_order = ['.notdef', glyph_name]

    font = FontBuilder(UNITS_PER_EM, isTTF=True)
    font.setupGlyphOrder(glyph_order)
    font.setupCharacterMap({CODEPOINT: glyph_name})
    font.setupGlyf({'.notdef': TTGlyphPen(None).glyph(), glyph_name: build_glyph(size, paths)})
    font.setupHorizontalMetrics({name: (ADVANCE_WIDTH, 0) for name in glyph_order})
    font.setupHorizontalHeader(ascent=300, descent=0, lineGap=0)
    font.setupNameTable(
        {
            'familyName': 'Entirely Icons',
            'styleName': 'Regular',
            'uniqueFontIdentifier': 'Entirely Icons Regular 2.0',
            'fullName': 'Entirely Icons',
            'psName': 'EntirelyIcons-Regular',
            'version': 'Version 2.0',
        }
    )
    font.setupOS2(
        sTypoAscender=300,
        sTypoDescender=0,
        sTypoLineGap=27,
        usWinAscent=327,
        usWinDescent=7,
        fsType=0,
    )
    font.setupPost()
    font.setupMaxp()

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    font.font.flavor = 'woff'
    font.save(OUTPUT)
    print(f'Wrote {OUTPUT.relative_to(ROOT)} ({OUTPUT.stat().st_size} bytes) from {source}')


if __name__ == '__main__':
    build_font(Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else DEFAULT_SOURCE)
