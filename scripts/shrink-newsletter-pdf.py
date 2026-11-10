"""Shrink a PDF by downsampling its images to the size they are actually drawn.

Text stays vector, so it is still sharp and still selectable. Only the
pictures lose resolution nobody was ever going to see: this file has
3873x3873 PNGs drawn as 13-point dots.
"""
import io, os, sys, pymupdf
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
DPI = float(sys.argv[3]) if len(sys.argv) > 3 else 150.0
Q = int(sys.argv[4]) if len(sys.argv) > 4 else 75

doc = pymupdf.open(src)

# Where each image is drawn, across the whole document — an image used
# on two pages must be sized for the larger of the two.
drawn = {}
for page in doc:
    for info in page.get_images(full=True):
        xref = info[0]
        for r in page.get_image_rects(xref):
            w, h = drawn.get(xref, (0, 0))
            drawn[xref] = (max(w, r.width), max(h, r.height))

# replace_image lives on the page, and any page that draws the image
# will do — the xref is document-wide.
owner = {}
for page in doc:
    for info in page.get_images(full=True):
        owner.setdefault(info[0], page)

replaced = skipped = failed = 0
for xref, (w_pt, h_pt) in drawn.items():
    try:
        raw = doc.extract_image(xref)
        im = Image.open(io.BytesIO(raw["image"]))
    except Exception:
        failed += 1
        continue
    tw = max(1, round(w_pt / 72.0 * DPI))
    th = max(1, round(h_pt / 72.0 * DPI))
    if im.width <= tw and im.height <= th:
        skipped += 1
        continue
    # Leave transparent artwork alone. A PDF keeps transparency in a
    # separate soft mask, so re-encoding the image on its own drops the
    # mask's alignment — which is what wiped the watermark out of the
    # masthead the first time round.
    if raw.get("smask") or raw["ext"] not in ("jpeg", "jpg"):
        skipped += 1
        continue
    alpha = False
    im2 = im.convert("RGBA" if alpha else "RGB")
    im2.thumbnail((tw, th), Image.LANCZOS)
    buf = io.BytesIO()
    if alpha:
        im2.save(buf, format="PNG", optimize=True)
    else:
        im2.save(buf, format="JPEG", quality=Q, optimize=True, progressive=True)
    try:
        owner[xref].replace_image(xref, stream=buf.getvalue())
        replaced += 1
    except Exception as e:
        failed += 1
        print("  could not replace", xref, e)

doc.save(dst, garbage=4, deflate=True, clean=True)
print(f"replaced {replaced}, left alone {skipped}, failed {failed}")
print(f"{os.path.getsize(src)/1048576:.1f} MB -> {os.path.getsize(dst)/1048576:.1f} MB  (@{DPI:.0f} dpi, q{Q})")
