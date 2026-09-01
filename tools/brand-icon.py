#!/usr/bin/env python3
"""Add a COMPANION band to the HashGG icon.

Run from the repository root:

    python3 tools/brand-icon.py

Reads icon.png and writes icon-companion.png. The output is committed, so nothing
in the build regenerates it; re-run this after any change to icon.png.

Why a band rather than a different icon: the two packages are the same
application, and someone running both needs to tell the tiles apart at a glance
without being told they are unrelated things. Same approach as the Sparrow
BLAKE2b build, for the same reason.

Design notes, since they are not obvious from the code:

The artwork is not scaled to make room, unlike the Sparrow icon. That one is a
bird on transparency whose feet reach the bottom edge, so a band laid over it
crops them. This one is a full-bleed dark square whose logo ends around 68% of
the height, leaving the bottom fifth as background texture. A band there covers
nothing, and scaling would leave gaps at the sides of a full-bleed image.

The band is near-black with an orange rule rather than solid orange. Solid orange
was tried and competes with the logo's own orange and its flames, and dark text on
orange is less legible at small sizes than white on dark. The rule is the brand
colour sampled from the logo, and it stops the band reading as a continuation of
the already-dark background.

The label is sized to whichever of width or band height binds first. COMPANION is
nine characters and stays readable down to about 48px, which is the smallest size
a StartOS or Umbrel tile uses. Below that it degrades to a texture, which is the
same behaviour as the icon it is derived from.
"""
from PIL import Image, ImageDraw, ImageFont
import sys

SRC = 'icon.png'
OUT = 'icon-companion.png'
LABEL = 'COMPANION'

BAND_COLOUR = (24, 24, 28, 255)
TEXT_COLOUR = (255, 255, 255, 255)
# Sampled from the logo's orange, not chosen: it has to be the same orange.
RULE_COLOUR = (253, 75, 1, 255)
BAND_FRACTION = 0.21
RULE_FRACTION = 0.006
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'


def banded(src: Image.Image, label: str) -> Image.Image:
    im = src.convert('RGBA')
    w, h = im.size
    band_h = int(h * BAND_FRACTION)
    top = h - band_h

    layer = Image.new('RGBA', im.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.rectangle([0, top, w, h], fill=BAND_COLOUR)
    d.rectangle([0, top, w, top + max(1, int(h * RULE_FRACTION))], fill=RULE_COLOUR)
    im = Image.alpha_composite(im, layer)

    # Fit the label to ~86% of the width and ~62% of the band, whichever binds first.
    draw = ImageDraw.Draw(im)
    size = band_h
    while size > 4:
        font = ImageFont.truetype(FONT, size)
        l, t, r, b = draw.textbbox((0, 0), label, font=font)
        if (r - l) <= w * 0.86 and (b - t) <= band_h * 0.62:
            break
        size -= 1
    font = ImageFont.truetype(FONT, size)
    l, t, r, b = draw.textbbox((0, 0), label, font=font)
    draw.text(
        ((w - (r - l)) / 2 - l, top + (band_h - (b - t)) / 2 - t),
        label, font=font, fill=TEXT_COLOUR,
    )
    return im


if __name__ == '__main__':
    src = sys.argv[1] if len(sys.argv) > 1 else SRC
    out = sys.argv[2] if len(sys.argv) > 2 else OUT
    banded(Image.open(src), LABEL).convert('RGB').save(out)
    print(f'  wrote {out}')
