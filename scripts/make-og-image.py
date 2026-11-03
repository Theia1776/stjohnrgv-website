#!/usr/bin/env python3
"""
Build public/og-image.jpg — the picture that shows when somebody shares
a link to the parish on Facebook, in a text message, or in Slack.

There was none. Layout.astro has pointed every page's `og:image` at
/og-image.jpg since the site was built, and nothing was ever put there,
so Cloudflare answered the request with the 404 page — as HTML, with a
200 status. Every share of this parish for months has shown a blank or
broken thumbnail, which is exactly the moment a stranger decides
whether to click.

Run it when the parish name, the icon or the palette changes:

    python scripts/make-og-image.py

1200x630 is what Facebook, X, LinkedIn, iMessage and Slack all read.
Colours are taken from src/styles/global.css so the card looks like the
site it leads to, and the type is Cinzel, the site's display face,
pulled from the local font cache if it is there and falling back to a
serif otherwise — a fallback is worth more than a crash here.
"""
import pathlib
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "og-image.jpg"
ICON = ROOT / "src" / "assets" / "images" / "stjohn-of-kronstadt.jpg"

W, H = 1200, 630
CREAM = (250, 247, 240)
SLATE = (44, 62, 80)
GOLD = (201, 168, 76)
TAN = (168, 135, 88)

# The site's display face if it's installed, then a few common serifs,
# then Pillow's own. Each is tried in turn rather than assumed.
FONT_CANDIDATES = [
    "C:/Windows/Fonts/Cinzel-Regular.ttf",
    "C:/Windows/Fonts/georgiab.ttf",
    "C:/Windows/Fonts/georgia.ttf",
    "C:/Windows/Fonts/times.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
]


def font(size: int, bold: bool = False):
    order = FONT_CANDIDATES[:]
    if bold:
        order = ["C:/Windows/Fonts/georgiab.ttf", "C:/Windows/Fonts/timesbd.ttf"] + order
    for path in order:
        if pathlib.Path(path).exists():
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default(size)


def centred(draw, text, f, y, fill, spacing=0):
    """Draw `text` horizontally centred, optionally letter-spaced."""
    if spacing:
        widths = [draw.textlength(c, font=f) + spacing for c in text]
        x = (W - (sum(widths) - spacing)) / 2
        for c, w in zip(text, widths):
            draw.text((x, y), c, font=f, fill=fill)
            x += w
        return
    w = draw.textlength(text, font=f)
    draw.text(((W - w) / 2, y), text, font=f, fill=fill)


def main() -> int:
    img = Image.new("RGB", (W, H), CREAM)
    d = ImageDraw.Draw(img)

    # The liturgical stripe along the top, as on every page of the site.
    d.rectangle([0, 0, W, 10], fill=GOLD)

    # The patron's icon down the left, if it's where it should be. The
    # card still works without it, so a missing file is not fatal.
    text_left = 0
    if ICON.exists():
        icon = Image.open(ICON).convert("RGB")
        target_h = H - 150
        target_w = int(icon.width * (target_h / icon.height))
        icon = icon.resize((target_w, target_h), Image.LANCZOS)
        ix, iy = 80, (H - target_h) // 2 + 5
        # A thin gold edge, the way the site frames an icon.
        d.rectangle([ix - 3, iy - 3, ix + target_w + 2, iy + target_h + 2], fill=GOLD)
        img.paste(icon, (ix, iy))
        text_left = ix + target_w

    # The type sits in whatever is left to the right of the icon.
    block_w = W - text_left - 80
    cx = text_left + 80 + block_w / 2

    def place(text, f, y, fill, spacing=0):
        if spacing:
            widths = [d.textlength(c, font=f) + spacing for c in text]
            x = cx - (sum(widths) - spacing) / 2
            for c, w in zip(text, widths):
                d.text((x, y), c, font=f, fill=fill)
                x += w
        else:
            d.text((cx - d.textlength(text, font=f) / 2, y), text, font=f, fill=fill)

    # The cross is drawn, not typed. U+2629 renders as an empty box in
    # Georgia and in most of the fallbacks, and a tofu square at the top
    # of a share card is worse than no cross at all.
    def cross(cx_, top, h_, bar=7):
        """A three-bar Orthodox cross: short top bar, main bar, slanted foot."""
        d.rectangle([cx_ - bar / 2, top, cx_ + bar / 2, top + h_], fill=GOLD)
        d.rectangle([cx_ - h_ * 0.17, top + h_ * 0.13, cx_ + h_ * 0.17, top + h_ * 0.13 + bar], fill=GOLD)
        d.rectangle([cx_ - h_ * 0.30, top + h_ * 0.38, cx_ + h_ * 0.30, top + h_ * 0.38 + bar], fill=GOLD)
        d.line(
            [cx_ - h_ * 0.20, top + h_ * 0.72, cx_ + h_ * 0.20, top + h_ * 0.62],
            fill=GOLD,
            width=bar,
        )

    cross(cx, 108, 72)
    place("ST. JOHN", font(60, bold=True), 205, SLATE, spacing=3)
    place("OF KRONSTADT", font(60, bold=True), 272, SLATE, spacing=3)
    place("ORTHODOX MISSION", font(26), 352, TAN, spacing=5)

    d.line([cx - 90, 405, cx + 90, 405], fill=GOLD, width=2)

    place("A Living Tradition in the", font(31), 432, SLATE)
    place("Rio Grande Valley", font(31), 474, SLATE)
    place("BAYVIEW, TEXAS  \u00b7  STJOHNRGV.ORG", font(21), 536, TAN, spacing=2)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    img.save(OUT, "JPEG", quality=88, optimize=True)
    print(f"wrote {OUT.relative_to(ROOT)} \u2014 {W}x{H}, {OUT.stat().st_size // 1024} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
