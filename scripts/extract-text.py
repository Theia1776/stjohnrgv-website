#!/usr/bin/env python
"""
scripts/extract-text.py

Pull the text out of one PDF, with page markers, and print it as JSON.

This is the command-line twin of what the upload form does in the
browser: same markers, same shape, so a book added by the bulk uploader
behaves identically in the reader — page dividers, the page a search hit
sits on, and the jump to that scanned page.

The marker is U+241E (a character no book contains) wrapping the page's
printed label and its position in the file:  ␞3|6␞

Usage:
  python scripts/extract-text.py "<file.pdf>"

Prints: {"text": "...", "pages": 63, "status": "ok"}
  status "ok"    — text was found
         "empty" — none to find (a scan; needs OCR, which this doesn't do)
         "error" — the file wouldn't open
"""

import json
import sys

MARK = "␞"
# Roughly a 1,200-page book. Beyond this the beginning is kept rather
# than the whole thing refused — matches the browser uploader's cap.
MAX_CHARS = 3_000_000


def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps({"text": "", "pages": 0, "status": "error", "note": "no file given"}))
        return

    try:
        import pymupdf
    except ImportError:
        print(json.dumps({"text": "", "pages": 0, "status": "error", "note": "PyMuPDF not installed"}))
        return

    path = sys.argv[1]
    try:
        doc = pymupdf.open(path)
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"text": "", "pages": 0, "status": "error", "note": str(exc)[:200]}))
        return

    # Real page labels where the PDF carries them — i, ii, iii before 1,
    # 2, 3 — because a citation wants the number printed on the paper.
    try:
        labels = doc.get_page_labels()
    except Exception:  # noqa: BLE001
        labels = None

    def label_for(index: int) -> str:
        if labels:
            try:
                return str(labels[index]) or str(index + 1)
            except (IndexError, TypeError):
                pass
        return str(index + 1)

    parts: list[str] = []
    chars = 0
    pages_with_text = 0

    for i, page in enumerate(doc):
        try:
            text = " ".join(page.get_text().split())
        except Exception:  # noqa: BLE001
            continue
        if not text:
            continue
        parts.append(f"{MARK}{label_for(i)}|{i + 1}{MARK}\n{text}")
        chars += len(text)
        pages_with_text += 1
        if chars > MAX_CHARS:
            break

    doc.close()

    body = "\n\n".join(parts)[:MAX_CHARS]
    print(
        json.dumps(
            {
                "text": body,
                "pages": pages_with_text if body else 0,
                "status": "ok" if body else "empty",
            }
        )
    )


if __name__ == "__main__":
    main()
