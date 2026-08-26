#!/usr/bin/env python
"""
scripts/shrink-pdfs.py

Shrink oversized library PDFs so they fit the 50 MB storage limit.

The enormous files in the parish archive are scans, and they're big for
two reasons: pages scanned at far more resolution than screen reading
needs, and page images stored losslessly (PNG) when a photograph of a
printed page compresses far better as JPEG. This fixes both — pages are
downsampled when they're over-resolved, and re-encoded as JPEG when that
is genuinely smaller.

Each image is only swapped when the new version is at least 20% smaller,
so images that are already efficient — and bilevel black-and-white
scans, which JPEG would only bloat — are left exactly as they are.

It never touches the original. Each book is written to a _shrunk/ folder
beside it, and if shrinking somehow makes a file bigger (a PDF that was
already well compressed), the result is discarded and the book reported
as one to handle another way.

If the first attempt is still over the limit, it tries again at a lower
resolution and quality, down to a floor — better a slightly soft scan
that parishioners can actually read than a book nobody can open.

Usage:
  python scripts/shrink-pdfs.py "<folder>"                 # every PDF over 50 MB
  python scripts/shrink-pdfs.py "<folder>" --limit 45      # aim under 45 MB
  python scripts/shrink-pdfs.py "<folder>" --all           # every PDF, big or not
  python scripts/shrink-pdfs.py "<file.pdf>"               # just this one
"""

import argparse
import io
import sys
from pathlib import Path

try:
    import pymupdf
except ImportError:
    sys.exit("PyMuPDF is needed:  python -m pip install --user pymupdf")

MB = 1024 * 1024

# Each pass is (dpi, jpeg quality). 150 DPI is comfortable on screen and
# still legible when zoomed; the later passes are for the monsters.
PASSES = [(150, 72), (120, 65), (100, 58), (85, 50)]

# Black-and-white scans are left alone below this resolution — at that
# size they're already compact and JPEG would only blur them. Above it
# (archival scans are often 600 DPI) they're worth reworking.
BILEVEL_KEEP_DPI = 250
# Text scanned in black and white needs more resolution than a
# photograph to stay crisp, so bilevel pages are taken to this rather
# than the pass's DPI.
BILEVEL_TARGET_DPI = 200


def shrink(path: Path, target_bytes: int) -> tuple[Path | None, int, int, str]:
    """Rewrite one book's images smaller. Returns (output, before, after, note)."""
    before = path.stat().st_size
    out_dir = path.parent / "_shrunk"
    out_dir.mkdir(exist_ok=True)
    out_path = out_dir / path.name

    for dpi, quality in PASSES:
        try:
            doc = pymupdf.open(path)
        except Exception as exc:  # noqa: BLE001 — a broken file is just a report line
            return None, before, 0, f"could not open ({exc})"

        try:
            for page in doc:
                for img in page.get_images(full=True):
                    xref = img[0]
                    try:
                        info = doc.extract_image(xref)
                    except Exception:  # noqa: BLE001
                        continue

                    original_bytes = len(info["image"])
                    bilevel = info.get("bpc") == 1

                    # A black-and-white scan at a sane resolution is already
                    # about as small as it gets, and JPEG would only make it
                    # bigger and blurrier. But archival scans are often 600
                    # DPI — nine times the pixels needed to read on a screen
                    # — and those are worth reworking.
                    rects_check = page.get_image_rects(xref)
                    width_in = (rects_check[0].width / 72.0) if rects_check else 0
                    dpi_now = (info["width"] / width_in) if width_in > 0.01 else 0
                    if bilevel and dpi_now <= BILEVEL_KEEP_DPI:
                        continue

                    try:
                        pix = pymupdf.Pixmap(doc, xref)
                    except Exception:  # noqa: BLE001
                        continue

                    # Stencil masks carry no colorspace — they say which
                    # parts of another image show through. They're tiny,
                    # and JPEG can't represent them at all.
                    if pix.colorspace is None:
                        pix = None
                        continue

                    # Downsample only if the page carries more resolution
                    # than screen reading needs. Plenty of these scans are
                    # already modest — their waste is in the encoding.
                    rects = page.get_image_rects(xref)
                    width_inches = (rects[0].width / 72.0) if rects else 0
                    current_dpi = (pix.width / width_inches) if width_inches > 0.01 else 0
                    target_dpi = BILEVEL_TARGET_DPI if bilevel else dpi
                    if current_dpi > target_dpi * 1.1:
                        scale = target_dpi / current_dpi
                        new_width = max(int(pix.width * scale), 1)
                        new_height = max(int(pix.height * scale), 1)
                    else:
                        new_width, new_height = pix.width, pix.height

                    # CMYK and alpha have to become plain RGB before JPEG.
                    if pix.n - pix.alpha >= 4 or pix.alpha:
                        pix = pymupdf.Pixmap(pymupdf.csRGB, pix)

                    if new_width < pix.width:
                        pix = pymupdf.Pixmap(pix, new_width, new_height)

                    try:
                        # Downsampled bilevel text turns grey at the edges;
                        # a higher quality keeps it readable.
                        jpeg = pix.tobytes("jpeg", jpg_quality=max(quality, 80) if bilevel else quality)
                    except Exception:  # noqa: BLE001
                        pix = None
                        continue

                    # Only swap when it's a real gain. This is what makes
                    # the pass safe to run over a whole library: an image
                    # that's already efficient is simply left alone.
                    if len(jpeg) < original_bytes * 0.8:
                        try:
                            page.replace_image(xref, stream=jpeg)
                        except Exception:  # noqa: BLE001
                            pass
                    pix = None

            # deflate + garbage collection squeezes out the replaced originals.
            doc.save(out_path, garbage=4, deflate=True, clean=True)
        except Exception as exc:  # noqa: BLE001
            # One awkward image shouldn't cost the whole book.
            doc.close()
            return None, before, 0, f"failed while rewriting ({exc})"
        finally:
            doc.close()

        after = out_path.stat().st_size
        if after <= target_bytes:
            note = f"{dpi} DPI, quality {quality}"
            if after >= before:
                out_path.unlink(missing_ok=True)
                return None, before, after, "already well compressed — nothing to gain"
            return out_path, before, after, note

    after = out_path.stat().st_size if out_path.exists() else 0
    if after and after < before:
        return out_path, before, after, "still over the limit at the lowest setting"
    out_path.unlink(missing_ok=True)
    return None, before, after, "could not get it under the limit"


def main() -> None:
    parser = argparse.ArgumentParser(description="Shrink oversized library PDFs.")
    parser.add_argument("target", help="a folder of PDFs, or a single PDF")
    parser.add_argument("--limit", type=float, default=50.0, help="size limit in MB (default 50)")
    parser.add_argument("--all", action="store_true", help="process every PDF, not only oversized ones")
    args = parser.parse_args()

    root = Path(args.target)
    if root.is_file():
        books = [root]
    else:
        books = sorted(p for p in root.rglob("*.pdf") if "_shrunk" not in p.parts)
    if not books:
        sys.exit(f"No PDFs found in {root}")

    limit_bytes = int(args.limit * MB)
    # A little headroom, so a book lands comfortably under the limit.
    target_bytes = int(limit_bytes * 0.95)

    todo = books if args.all else [b for b in books if b.stat().st_size > limit_bytes]
    if not todo:
        print(f"Nothing over {args.limit:.0f} MB in {root}.")
        return

    print(f"{len(todo)} book(s) to shrink, aiming under {args.limit:.0f} MB.\n")
    saved = 0
    failures = []

    for i, book in enumerate(todo, 1):
        print(f"[{i}/{len(todo)}] {book.name}")
        out, before, after, note = shrink(book, target_bytes)
        if out:
            saved += before - after
            print(f"      {before/MB:7.1f} MB -> {after/MB:6.1f} MB   ({note})")
        else:
            failures.append((book.name, note))
            print(f"      {before/MB:7.1f} MB -> unchanged   ({note})")

    print(f"\nDone. Saved {saved/MB/1024:.2f} GB across {len(todo) - len(failures)} book(s).")
    print(f"Shrunk copies are in the _shrunk folder; originals untouched.")
    if failures:
        print(f"\n{len(failures)} need another approach:")
        for name, note in failures:
            print(f"  - {name}: {note}")


if __name__ == "__main__":
    main()
