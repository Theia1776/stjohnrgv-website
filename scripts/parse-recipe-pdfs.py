#!/usr/bin/env python3
"""
scripts/parse-recipe-pdfs.py

Read the Theia's Kitchen recipe PDFs into JSON for An Orthodox Table.

The PDFs share one template, which is what makes this possible:

    [checkbox]  H E I R L O O M   R E C I P E
    Title
    Hands-on 10 min | Total 4 hr, 20 min | Serves 4 to 6     (optional)
    P R E H E A T   T E M P E R A T U R E
    [temperature]                                            (optional)
    I N G R E D I E N T S
    one per line
    D I R E C T I O N S
    1.
    the step
    notes
    [notes]                                                  (optional)

The section headers are letter-spaced, so every line is compared with
its spaces squeezed out. Anything that doesn't match the template is
reported rather than guessed at — a recipe imported wrong is worse than
one imported by hand.

Flags, not fixes: ingredients that aren't vegan are listed per recipe so
a person can decide. Substituting butter for "plant butter" silently
across 127 recipes would put the parish's name on food nobody tasted.

Usage:
  python scripts/parse-recipe-pdfs.py "C:/Users/Tina/Desktop/Orthodox Table" --out recipes.json
"""
import argparse
import json
import re
import sys
from pathlib import Path

try:
    import pymupdf
except ImportError:  # pragma: no cover
    sys.exit("pymupdf is needed:  python -m pip install --user pymupdf")

# Which folder means which book.
BOOKS = {
    "Vegan": {"fasting": True, "needs_work": False},
    "Vegan Mod": {"fasting": True, "needs_work": True},
    "Regular": {"fasting": False, "needs_work": False},
}

# Anything from an animal. Checked against the ingredient text so a
# person can see what stands between a recipe and the fasting book.
NOT_FASTING = {
    "butter": "butter",
    "butterscotch": "possibly milk",
    "milk": "milk",
    "cream": "cream",
    "half and half": "cream",
    "buttermilk": "milk",
    "cheese": "cheese",
    "parmesan": "cheese",
    "cheddar": "cheese",
    "cream cheese": "cheese",
    "egg": "eggs",
    "eggs": "eggs",
    "mayonnaise": "eggs",
    "miracle whip": "eggs",
    "honey": "honey",
    "gelatin": "gelatin",
    "marshmallow": "gelatin",
    "jell-o": "gelatin",
    "lard": "meat fat",
    "bacon": "meat",
    "beef": "meat",
    "ground beef": "meat",
    "chicken": "meat",
    "pork": "meat",
    "ham": "meat",
    "sausage": "meat",
    "turkey": "meat",
    "lamb": "meat",
    "broth": "possibly meat broth",
    "bouillon": "possibly meat broth",
    "worcestershire": "anchovies",
    "fish sauce": "fish",
    "tuna": "fish",
    "salmon": "fish",
    "shrimp": "shellfish",
    "yogurt": "milk",
    "sour cream": "cream",
    "whipped topping": "cream",
    "condensed milk": "milk",
    "evaporated milk": "milk",
    "chocolate chips": "possibly milk",
    "white chocolate": "milk",
}


# The line under the title comes in two shapes across this collection:
#
#   Hands-on 10 min | Total 4 hr, 20 min | Serves 4 to 6
#   Prep 20 min. | Bake 1 hour | Makes 8 servings
#
# Both are the same three facts. Reading only the first shape left the
# second stuck to the title — "Apple Pie Prep 20 min. | Bake 1 hour |
# Makes 8 servings" — which is what would have gone in as the name.
META_WORDS = (
    "hands-on", "hands on", "prep", "total", "bake", "cook", "grill",
    "chill", "stand", "rise", "rising", "serves", "makes", "yield",
)


def looks_like_meta(line: str) -> bool:
    low = line.lower()
    return any(re.search(rf"(?<![a-z]){re.escape(word)}", low) for word in META_WORDS)


def tidy(text: str) -> str:
    """
    PDF text is full of non-breaking and thin spaces. They look like
    spaces and are not, so "Prep 20 min" failed to match "prep" and the
    whole line fell through to the wrong field.
    """
    return re.sub(r"[\s  -​  ]+", " ", text).strip()


def apply_meta(record: dict, line: str) -> None:
    """Pull the three facts out of either shape of the line."""
    parts = [tidy(p).strip(" .|") for p in tidy(line).split("|")]
    parts = [p for p in parts if p]
    cook_parts: list[str] = []
    for part in parts:
        low = part.lower()
        if re.match(r"^(hands-?\s?on|prep)\b", low):
            record["hands_on"] = re.sub(r"^(hands-?\s?on|prep)\s*", "", part, flags=re.I).strip()
        elif re.match(r"^(serves|makes|yields?)\b", low):
            record["serves"] = re.sub(r"^(serves|makes|yields?)\s*", "", part, flags=re.I).strip()
        elif re.match(r"^total\b", low):
            record["total_time"] = re.sub(r"^total\s*", "", part, flags=re.I).strip()
        else:
            # Bake / Cook / Grill / Chill — the time at the stove, which
            # is what "total" means to someone reading a card.
            cook_parts.append(part)
    if cook_parts and not record["total_time"]:
        record["total_time"] = " + ".join(cook_parts)


def squeeze(text: str) -> str:
    """Letter-spaced header to a plain comparable word."""
    return re.sub(r"\s+", "", text).lower()


def parse_pdf(path: Path) -> dict:
    doc = pymupdf.open(path)
    lines: list[str] = []
    for page in doc:
        for raw in page.get_text().splitlines():
            line = raw.strip()
            if line:
                lines.append(line)
    doc.close()

    record: dict = {
        "source": path.name,
        "title": "",
        "hands_on": "",
        "total_time": "",
        "serves": "",
        "preheat": "",
        "ingredients": [],
        "directions": [],
        "notes": "",
        "problems": [],
    }

    section = "head"
    pending_step = False
    meta_seen = False

    for line in lines:
        flat = squeeze(line)

        # The banner carries a checkbox glyph; the title is the line
        # after it, so the banner is skipped rather than recorded.
        if "heirloomrecipe" in flat:
            section = "title"
            continue
        if flat == "preheattemperature":
            section = "preheat"
            continue
        if flat == "ingredients":
            section = "ingredients"
            continue
        if flat == "directions":
            section = "directions"
            continue
        if flat == "notes":
            section = "notes"
            continue

        if section == "title":
            if not record["title"]:
                record["title"] = tidy(line)
            elif looks_like_meta(line):
                apply_meta(record, line)
                meta_seen = True
            elif re.fullmatch(r"\d{2,3}\s*°?\s*[FfCc]?", tidy(line)):
                # An oven temperature sitting where the times would be.
                record["preheat"] = tidy(line)
            elif meta_seen and not re.match(r"^[A-Z0-9\"']", tidy(line)):
                # The meta line wrapped: "… | Makes 8" then "servings"
                # on its own. Stuck on the title that becomes "Cranberry
                # Ricotta Gnocchi … servings".
                record["serves"] = tidy(f"{record['serves']} {line}")
            else:
                # A title that genuinely wrapped onto a second line.
                record["title"] = tidy(f"{record['title']} {line}")
        elif section == "preheat":
            record["preheat"] = (record["preheat"] + " " + line).strip()
        elif section == "ingredients":
            record["ingredients"].append(line)
        elif section == "directions":
            # Steps arrive as "1." on its own line, then the text. A
            # continuation line belongs to the step before it.
            if re.fullmatch(r"\d+\.?", line):
                pending_step = True
                continue
            if pending_step or not record["directions"]:
                record["directions"].append(line)
                pending_step = False
            else:
                record["directions"][-1] = f"{record['directions'][-1]} {line}"
        elif section == "notes":
            record["notes"] = (record["notes"] + " " + line).strip()

    if not record["title"]:
        record["problems"].append("no title found")
    if not record["ingredients"]:
        record["problems"].append("no ingredients found")
    if not record["directions"]:
        record["problems"].append("no directions found")

    return record


# Words that make the thing after them plant food. "Peanut butter" is
# not butter and "coconut milk" is not milk — counting them as animal
# products inflates every number a person would work from.
PLANT_QUALIFIERS = (
    "peanut", "almond", "coconut", "soy", "oat", "cashew", "rice", "hemp",
    "plant", "vegan", "nut", "sun", "apple", "cocoa", "shea", "tahini",
)


def flag_animal_products(record: dict) -> list[str]:
    """What stands between this recipe and the fasting book."""
    blob = " ".join(record["ingredients"]).lower()
    found: dict[str, None] = {}
    for needle, what in NOT_FASTING.items():
        # An optional plural, because the pantry says "marshmallows" and
        # "eggs" rather than the singular this list is written in.
        pattern = rf"(?<![a-z]){re.escape(needle)}e?s?(?![a-z])"
        for match in re.finditer(pattern, blob):
            # What comes immediately before decides it: "peanut butter"
            # is not butter, "apple cider" is not cider from an animal.
            before = blob[max(0, match.start() - 24):match.start()].rstrip(" -")
            preceding = before.split()[-1] if before.split() else ""
            if preceding in PLANT_QUALIFIERS:
                continue
            found[what] = None
            break
    return sorted(found)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("root", help="the folder holding Vegan / Vegan Mod / Regular")
    ap.add_argument("--out", default="recipes.json")
    args = ap.parse_args()

    root = Path(args.root)
    out: list[dict] = []
    counts: dict[str, int] = {}
    broken: list[str] = []

    for folder, settings in BOOKS.items():
        directory = root / folder
        if not directory.is_dir():
            print(f"  (no {folder} folder)")
            continue
        files = sorted(directory.glob("*.pdf"))
        counts[folder] = len(files)
        for path in files:
            record = parse_pdf(path)
            record["book"] = folder
            record["fasting"] = settings["fasting"]
            record["needs_work"] = settings["needs_work"]
            record["animal_products"] = flag_animal_products(record)
            if record["problems"]:
                broken.append(f"{folder}/{path.name}: {', '.join(record['problems'])}")
            out.append(record)

    Path(args.out).write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"\n{sum(counts.values())} recipes read:")
    for folder, n in counts.items():
        print(f"  {folder:<12} {n}")

    # The two things a person needs to look at.
    not_vegan = [r for r in out if r["fasting"] and r["animal_products"]]
    print(f"\n{len(not_vegan)} recipes bound for the FASTING book contain animal products:")
    by_book: dict[str, int] = {}
    for r in not_vegan:
        by_book[r["book"]] = by_book.get(r["book"], 0) + 1
    for book, n in by_book.items():
        print(f"  {book:<12} {n}")

    if broken:
        print(f"\n{len(broken)} did not parse cleanly:")
        for line in broken[:20]:
            print(f"  {line}")
        if len(broken) > 20:
            print(f"  … and {len(broken) - 20} more")
    else:
        print("\nEvery file parsed cleanly.")

    print(f"\nWrote {args.out}")


if __name__ == "__main__":
    main()
