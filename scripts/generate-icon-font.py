#!/usr/bin/env python3
"""Build the custom Entirely icon font used by VS Code contributes.icons.

The font has Codicon-compatible metrics: 300 units/em, a 300-unit advance
width, and an ascent/descent of 300/0. The artwork is the flattened, static
Marvin head documented in issue #15. State variants keep Marvin as the primary
shape and add a monochrome badge that works in VS Code's currentColor icon
pipeline.

Requirements:
    python3 -m pip install 'fonttools[woff]'

Run from the repository root:
    python3 scripts/generate-icon-font.py
"""

from __future__ import annotations

from dataclasses import dataclass
from math import hypot
from pathlib import Path
from typing import Callable

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.recordingPen import RecordingPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.svgLib.path import parse_path

UNITS_PER_EM = 300
ADVANCE_WIDTH = 300
ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'assets' / 'entire-icons.woff'

# Flattened Marvin mascot head from the Entire CLI, as cited in issue #15.
# The two eye circles are deliberately separate contours: in a font their
# opposite winding makes them transparent cut-outs, so the glyph inherits the
# status-bar foreground colour without needing a second fill colour.
MARVIN_HEAD = (
    'M17.6.22c1.61-.43,3.33-.21,4.77.61l7.47,4.25c.31.18.25.64-.09.73'
    'l-16.75,4.49c-1.69.45-2.69,2.19-2.24,3.88l.82,3.06c.45,1.69,2.19,2.69,3.88,2.24'
    'l9.57-2.5,4.61,4.74c.89.89,1.39,2.1,1.39,3.36v2.54c0,1.65-1.27,3.03-2.92,3.16'
    'l-15.61,1.2c-1.85.14-3.67-.53-4.98-1.85l-5.11-5.14c-.88-.89-1.38-2.09-1.38-3.35'
    'v-2.55c0-1.65,1.5-3.08,3-3.08h2l-3.85-3.04c-.6-.43-1.04-1.05-1.23-1.76'
    'l-.81-3.03c-.45-1.69.55-3.43,2.24-3.88L17.6.22Z'
)
EYES = ((17.52, 13.94, 2.5), (25.52, 11.94, 2.5))
KAPPA = 0.5522847498307936

# A familiar two-arrow sync treatment for the static in-progress state. It is
# drawn beside Marvin, rather than on top of it, so it stays legible at 16px.
SYNC_MARK = (
    'M14 3.5V6.5C14 6.78 13.78 7 13.5 7H10.5C10.22 7 10 6.78 10 6.5'
    'C10 6.22 10.22 6 10.5 6H12.58C11.78 4.17 10.01 3 8 3'
    'C5.78 3 3.8 4.5 3.19 6.64C3.13 6.86 2.93 7 2.71 7'
    'C2.66 7 2.62 7 2.57 6.98C2.3 6.9 2.15 6.63 2.23 6.36'
    'C2.96 3.79 5.33 2 8 2C10.05 2 11.91 3.02 13 4.69V3.5'
    'C13 3.22 13.22 3 13.5 3C13.78 3 14 3.22 14 3.5Z'
    'M13.42 9.02C13.16 8.95 12.88 9.1 12.8 9.37C12.19 11.51 10.22 13.01 7.99 13.01'
    'C5.98 13.01 4.21 11.84 3.41 10.01H5.49C5.77 10.01 5.99 9.79 5.99 9.51'
    'C5.99 9.23 5.77 9.01 5.49 9.01H2.49C2.21 9.01 1.99 9.23 1.99 9.51V12.51'
    'C1.99 12.79 2.21 13.01 2.49 13.01C2.77 13.01 2.99 12.79 2.99 12.51V11.32'
    'C4.08 12.98 5.94 14.01 7.99 14.01C10.66 14.01 13.03 12.22 13.76 9.65'
    'C13.84 9.38 13.68 9.11 13.41 9.03L13.42 9.02Z'
)


class GlyphPen:
    """A small filled-shape API over a TrueType pen.

    Coordinates are in the conventional font coordinate system: the baseline
    is y=0 and y increases upward. The helper normalises polygon winding so
    rings and Marvin's eye holes survive the WOFF conversion consistently.
    """

    def __init__(self) -> None:
        self._raw_pen = TTGlyphPen(None)
        # Marvin's source path and the geometric badges both use cubic
        # Béziers. TrueType glyf outlines are quadratic, so every shape must
        # use the same conversion pen before the font is assembled.
        self.pen = Cu2QuPen(self._raw_pen, max_err=1.0)

    def glyph(self):
        return self._raw_pen.glyph()

    def polygon(self, points: list[tuple[float, float]], *, clockwise: bool = False) -> None:
        if len(points) < 3:
            raise ValueError('a polygon needs at least three points')

        area = sum(
            x1 * y2 - x2 * y1
            for (x1, y1), (x2, y2) in zip(points, points[1:] + points[:1], strict=True)
        )
        is_clockwise = area < 0
        if is_clockwise != clockwise:
            points = list(reversed(points))

        self.pen.moveTo(points[0])
        for point in points[1:]:
            self.pen.lineTo(point)
        self.pen.closePath()

    def circle(self, cx: float, cy: float, radius: float, *, clockwise: bool = False) -> None:
        k = radius * KAPPA
        self.pen.moveTo((cx + radius, cy))
        if clockwise:
            self.pen.curveTo((cx + radius, cy - k), (cx + k, cy - radius), (cx, cy - radius))
            self.pen.curveTo((cx - k, cy - radius), (cx - radius, cy - k), (cx - radius, cy))
            self.pen.curveTo((cx - radius, cy + k), (cx - k, cy + radius), (cx, cy + radius))
            self.pen.curveTo((cx + k, cy + radius), (cx + radius, cy + k), (cx + radius, cy))
        else:
            self.pen.curveTo((cx + radius, cy + k), (cx + k, cy + radius), (cx, cy + radius))
            self.pen.curveTo((cx - k, cy + radius), (cx - radius, cy + k), (cx - radius, cy))
            self.pen.curveTo((cx - radius, cy - k), (cx - k, cy - radius), (cx, cy - radius))
            self.pen.curveTo((cx + k, cy - radius), (cx + radius, cy - k), (cx + radius, cy))
        self.pen.closePath()

    def ring(self, cx: float, cy: float, outer: float, inner: float) -> None:
        # Marvin's outer path is clockwise. Match that winding for every
        # positive badge contour so the shapes add where a badge overlaps the
        # mascot; use the opposite direction only for the transparent centre.
        self.circle(cx, cy, outer, clockwise=True)
        self.circle(cx, cy, inner)

    def marvin(self, x: float, y: float, size: float) -> None:
        """Draw Marvin into a square whose lower-left corner is (x, y)."""
        scale = size / 32

        # SVG uses y-down coordinates. The transform puts its 32x32 viewBox on
        # the glyph baseline and converts cubic Béziers to TrueType quadratics.
        transform = (scale, 0, 0, -scale, x, y + size)
        parse_path(MARVIN_HEAD, TransformPen(self.pen, transform))

        # The transformed head path is clockwise. The counter-clockwise circles
        # below therefore form holes under the TrueType non-zero fill rule.
        for eye_x, eye_y, radius in EYES:
            self.circle(x + eye_x * scale, y + (32 - eye_y) * scale, radius * scale)


def bar(pen: GlyphPen, x: float, y: float, width: float, height: float) -> None:
    pen.polygon([(x, y), (x + width, y), (x + width, y + height), (x, y + height)], clockwise=True)


def check_mark(pen: GlyphPen, cx: float, cy: float) -> None:
    # Build the tick from two rounded strokes instead of one concave outline.
    # That removes the clipped-looking join at small sizes.
    def stroke(start: tuple[float, float], end: tuple[float, float], width: float) -> None:
        start_x, start_y = start
        end_x, end_y = end
        distance = hypot(end_x - start_x, end_y - start_y)
        half = width / 2
        normal_x = -(end_y - start_y) * half / distance
        normal_y = (end_x - start_x) * half / distance
        pen.polygon(
            [
                (start_x + normal_x, start_y + normal_y),
                (end_x + normal_x, end_y + normal_y),
                (end_x - normal_x, end_y - normal_y),
                (start_x - normal_x, start_y - normal_y),
            ],
            clockwise=True,
        )
        pen.circle(start_x, start_y, half, clockwise=True)
        pen.circle(end_x, end_y, half, clockwise=True)

    joint = (cx - 8, cy - 18)
    stroke((cx - 30, cy + 3), joint, 10)
    stroke(joint, (cx + 28, cy + 21), 10)


def cross_mark(pen: GlyphPen, cx: float, cy: float) -> None:
    pen.polygon(
        [(cx - 34, cy - 23), (cx - 23, cy - 34), (cx + 34, cy + 23), (cx + 23, cy + 34)],
        clockwise=True,
    )
    pen.polygon(
        [(cx - 34, cy + 23), (cx - 23, cy + 34), (cx + 34, cy - 23), (cx + 23, cy - 34)],
        clockwise=True,
    )


def warning_mark(pen: GlyphPen, cx: float, cy: float, radius: float) -> None:
    pen.ring(cx, cy, radius, radius - 13)
    # These bounds centre the full exclamation mark, not just its stem, in the
    # surrounding circle.
    bar(pen, cx - 7, cy - 8, 14, 38)
    pen.circle(cx, cy - 28, 8, clockwise=True)


def blocked_mark(pen: GlyphPen, cx: float, cy: float) -> None:
	pen.ring(cx, cy, 62, 48)
	bar(pen, cx - 42, cy - 7, 84, 14)


def progress_mark(pen: GlyphPen, cx: float, cy: float) -> None:
    """Draw a familiar static sync mark inside the available badge area."""
    size = 112
    scale = size / 16
    parse_path(SYNC_MARK, TransformPen(pen.pen, (scale, 0, 0, -scale, cx - size / 2, cy + size / 2)))


def z_mark(pen: GlyphPen, x: float, y: float, size: float) -> None:
    thickness = size * 0.22
    pen.polygon(
        [
            (x, y + size),
            (x + size, y + size),
            (x + size, y + size - thickness),
            (x + thickness, y + thickness),
            (x + size, y + thickness),
            (x + size, y),
            (x, y),
            (x, y + thickness),
            (x + size - thickness, y + size - thickness),
            (x, y + size - thickness),
        ],
        clockwise=True,
    )


def whole_logo(pen: GlyphPen) -> None:
    pen.marvin(50, 50, 200)


def compact_logo(pen: GlyphPen) -> None:
    pen.marvin(78, 78, 144)


def large_logo(pen: GlyphPen) -> None:
    pen.marvin(5, 5, 290)


def dot_logo(pen: GlyphPen) -> None:
    pen.marvin(18, 65, 190)
    pen.circle(250, 58, 47, clockwise=True)


def dot_compact_logo(pen: GlyphPen) -> None:
    pen.marvin(62, 75, 145)
    pen.circle(250, 67, 43, clockwise=True)


def badged_logo(mark: Callable[[GlyphPen, float, float], None]) -> Callable[[GlyphPen], None]:
    def draw(pen: GlyphPen) -> None:
        pen.marvin(8, 72, 185)
        mark(pen, 234, 67)

    return draw


def success_logo(pen: GlyphPen) -> None:
    pen.marvin(4, 85, 165)
    pen.ring(225, 67, 62, 48)
    check_mark(pen, 225, 67)


def error_logo(pen: GlyphPen) -> None:
    pen.marvin(4, 85, 165)
    pen.ring(225, 67, 62, 48)
    cross_mark(pen, 225, 67)


def warning_logo(pen: GlyphPen) -> None:
    pen.marvin(4, 85, 165)
    warning_mark(pen, 225, 67, 62)


def warning_large_logo(pen: GlyphPen) -> None:
    # Keep the larger warning badge separate from the mascot's solid body.
    pen.marvin(4, 80, 170)
    warning_mark(pen, 235, 60, 53)


def in_progress_logo(pen: GlyphPen) -> None:
    pen.marvin(4, 85, 165)
    progress_mark(pen, 225, 67)


def unavailable_logo(pen: GlyphPen) -> None:
    pen.marvin(42, 42, 216)
    # Shift the counter-clockwise slash upward into Marvin's eye opening. It
    # remains a true cut-out, so it works in both light and dark themes.
    pen.polygon([(34, 300), (74, 276), (300, 50), (276, 34)], clockwise=False)


def not_connected_logo(pen: GlyphPen) -> None:
	pen.marvin(4, 85, 165)
	pen.ring(225, 67, 62, 48)
	# Two offset contacts read as a broken connection, rather than sharing the
	# error icon's X. The little terminals remain visible at Codicon's 16px
	# default size.
	bar(pen, 187, 62, 25, 12)
	bar(pen, 238, 62, 25, 12)
	bar(pen, 198, 74, 12, 17)
	bar(pen, 240, 43, 12, 17)


def snooze_logo(pen: GlyphPen) -> None:
    pen.marvin(18, 20, 245)
    z_mark(pen, 210, 238, 58)
    z_mark(pen, 164, 203, 42)


def blocked_logo(pen: GlyphPen) -> None:
    pen.marvin(4, 85, 165)
    blocked_mark(pen, 225, 67)


@dataclass(frozen=True)
class Icon:
    icon_id: str
    codepoint: int
    draw: Callable[[GlyphPen], None]


ICONS = (
    Icon('entire-logo', 0xE001, whole_logo),
    Icon('entire-compact', 0xE002, compact_logo),
    Icon('entire-large', 0xE003, large_logo),
    Icon('entire-dot', 0xE004, dot_logo),
    Icon('entire-dot-compact', 0xE005, dot_compact_logo),
    Icon('entire-in-progress', 0xE006, in_progress_logo),
    Icon('entire-success', 0xE007, success_logo),
    Icon('entire-warning', 0xE008, warning_logo),
    Icon('entire-warning-large', 0xE009, warning_large_logo),
    Icon('entire-error', 0xE00A, error_logo),
    Icon('entire-unavailable', 0xE00B, unavailable_logo),
    Icon('entire-not-connected', 0xE00C, not_connected_logo),
    Icon('entire-snooze', 0xE00D, snooze_logo),
    Icon('entire-blocked', 0xE00E, blocked_logo),
)


def build_font() -> None:
    glyph_order = ['.notdef'] + [icon.icon_id.replace('-', '_') for icon in ICONS]
    glyphs = {'.notdef': TTGlyphPen(None).glyph()}
    cmap: dict[int, str] = {}

    for icon in ICONS:
        glyph = GlyphPen()
        icon.draw(glyph)
        glyph_name = icon.icon_id.replace('-', '_')
        glyphs[glyph_name] = glyph.glyph()
        cmap[icon.codepoint] = glyph_name

    font = FontBuilder(UNITS_PER_EM, isTTF=True)
    font.setupGlyphOrder(glyph_order)
    font.setupCharacterMap(cmap)
    font.setupGlyf(glyphs)
    font.setupHorizontalMetrics({glyph_name: (ADVANCE_WIDTH, 0) for glyph_name in glyph_order})
    font.setupHorizontalHeader(ascent=300, descent=0, lineGap=0)
    font.setupNameTable(
        {
            'familyName': 'Entirely Icons',
            'styleName': 'Regular',
            'uniqueFontIdentifier': 'Entirely Icons Regular 1.0',
            'fullName': 'Entirely Icons',
            'psName': 'EntirelyIcons-Regular',
            'version': 'Version 1.0',
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
    print(f'Wrote {OUTPUT.relative_to(ROOT)} ({OUTPUT.stat().st_size} bytes)')


if __name__ == '__main__':
    build_font()
