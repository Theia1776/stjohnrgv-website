#!/usr/bin/env python3
"""
scripts/sort-recipes-for-books.py

Decide which of the parsed recipes can go in the fasting book, and with
what swapped, following Theia's rules:

  Everything goes in the EVERYDAY book, exactly as written. Nothing is
  altered there — the original recipe is the point.

  A recipe ALSO goes in the FASTING book only if it can honestly be made
  without anything from an animal with bones. Honey is fine: the fast is
  about meat, not bees.

  Swappable, roughly one for one:
      butter          -> plant butter
      milk            -> oat or almond milk
      cheese          -> plant-based cheese
      Worcestershire  -> liquid smoke, but only where smoke is the
                         flavour the dish is after (a barbecue sauce,
                         not a spaghetti sauce)

  Disqualifying, so the recipe stays in Everyday alone:
      eggs            no swap worth standing behind
      cream           coconut cream is far too strong
      meat, fish      pulled out
      gelatin         pulled out
      butterscotch chips

A recipe that qualifies appears TWICE: once in Everyday as written, once
in Fasting with the swaps applied and a note saying what was changed. A
cook deserves to know a recipe was adjusted and by whom.

Usage:
  python scripts/sort-recipes-for-books.py recipes.json --out for-import.json
"""
import argparse
import json
import re
from pathlib import Path

# (pattern, what it is, replacement or None if it disqualifies)
SWAPS = [
    (r"\bunsalted butter\b", "butter", "unsalted plant butter"),
    (r"\bsalted butter\b", "butter", "salted plant butter"),
    (r"\bbutter\b", "butter", "plant butter"),
    (r"\bbuttermilk\b", "buttermilk", "plant milk soured with 1 tsp vinegar"),
    (r"\bwhole milk\b", "milk", "oat milk"),
    (r"\bmilk\b", "milk", "oat milk"),
    (r"\bcream cheese\b", "cheese", "plant-based cream cheese"),
    (r"\bparmesan\b", "cheese", "plant-based parmesan"),
    (r"\bcheddar\b", "cheese", "plant-based cheddar"),
    (r"\bmozzarella\b", "cheese", "plant-based mozzarella"),
    (r"\bricotta\b", "cheese", "plant-based ricotta"),
    (r"\bcheese\b", "cheese", "plant-based cheese"),
    (r"\bworcestershire(\s+sauce)?\b", "worcestershire", "liquid smoke"),
    (r"\bsour cream\b", "cream", None),
    (r"\bheavy cream\b", "cream", None),
    (r"\bwhipping cream\b", "cream", None),
    (r"\bhalf and half\b", "cream", None),
    (r"\bcream\b", "cream", None),
]

# Anything here keeps a recipe out of the fasting book entirely.
DISQUALIFY = [
    (r"\beggs?\b", "eggs"),
    (r"\bmiracle whip\b", "eggs"),
    # "Mayo" is what a recipe card actually says; spelling it out in
    # full let Fish Tacos through as vegan.
    (r"\bmayo(nnaise)?\b", "eggs"),
    (r"\baioli\b", "eggs"),
    (r"\bhollandaise\b", "eggs"),
    (r"\balfredo\b", "cream"),
    (r"\bbutterscotch\b", "butterscotch chips"),
    (r"\bgelatin\b", "gelatin"),
    (r"\bmarshmallows?\b", "gelatin"),
    (r"\bjell-?o\b", "gelatin"),
    # The first pass knew "beef" and missed "hamburger", so Mongolian
    # Beef and Hamburger Gravy came through as vegan. This is a
    # butcher's vocabulary rather than a cook's shorthand.
    (r"\b(beef|chicken|pork|ham|bacon|sausage|turkey|lamb|lard|veal|mutton|venison)\b", "meat"),
    (
        r"\b(hamburger|ground round|ground chuck|burgers?|steaks?|brisket|ribs?|roast|"
        r"chops?|tenderloin|cutlets?|meatballs?|meatloaf|pepperoni|salami|chorizo|"
        r"prosciutto|pancetta|hot ?dogs?|wieners?|bratwurst|kielbasa|jerky|"
        r"drumsticks?|thighs?|wings?|giblets?|liver|suet|gravy)\b",
        "meat",
    ),
    (
        r"\b(tuna|salmon|shrimp|anchov\w*|crab|lobster|clams?|oysters?|mussels?|"
        r"scallops?|cod|tilapia|halibut|haddock|trout|bass|snapper|catfish|"
        r"sardines?|squid|calamari|fish|seafood|caviar|roe|"
        # Mahi-Mahi is what put Fish Tacos in the fasting book.
        r"mahi(-?mahi)?|swordfish|grouper|pollock|perch|sole|flounder|monkfish|"
        r"mackerel|herring|eel|octopus|crawfish|crayfish)\b",
        "fish",
    ),
    (r"\b(broth|stock|bouillon|consomm\w*)\b", "broth — check whether it is meat"),
]

# Pre-made and branded items. A box of macaroni and cheese does not
# become fasting food by calling it "macaroni and plant-based cheese",
# and a tube of refrigerated biscuits has dairy baked into it. These
# need a substitute a cook chooses, not a word swapped in a list.
PREMADE = [
    (r"\bmacaroni and cheese\b", "boxed macaroni and cheese"),
    (r"\b(refrigerated|canned|tube)\b.*\bbiscuits?\b", "refrigerated biscuits"),
    (r"\bbuttermilk biscuits?\b", "refrigerated biscuits"),
    (r"\bcrescent rolls?\b", "refrigerated crescent rolls"),
    (r"\bkraft\b", "a branded dairy product"),
    (r"\bvelveeta\b", "a branded dairy product"),
    (r"\bcool whip\b", "a branded dairy product"),
    (r"\bpuff pastry\b", "puff pastry — usually butter"),
    (r"\bphyllo\b", "phyllo — check the packet"),
    (r"\bpie crust\b", "pie crust — usually lard or butter"),
    (r"\bdough for\b.*\bpie\b", "pie crust — usually lard or butter"),
    (r"\bchocolate chips?\b", "chocolate chips — check for milk"),
    (r"\bwhite chocolate\b", "white chocolate — contains milk"),
    (r"\bcaramels?\b", "caramels — usually contain cream"),
    (r"\btoffee\b", "toffee — usually contains butter"),
]

# "Peanut butter" is not butter; "coconut milk" is not milk.
PLANT_QUALIFIERS = (
    "peanut", "almond", "coconut", "soy", "oat", "cashew", "rice", "hemp",
    "plant", "vegan", "nut", "sun", "cocoa", "shea", "tahini",
)

# Where smoke genuinely is the flavour wanted. Elsewhere the swap would
# change the dish into something else, so the recipe is left alone.
SMOKE_SUITS = ("barbecue", "bbq", "baked bean", "chili", "sloppy", "burger", "rib")


def qualified(text: str, start: int) -> bool:
    """Is the match preceded by a word that makes it plant food?"""
    before = text[max(0, start - 24):start].rstrip(" -")
    words = before.split()
    return bool(words) and words[-1] in PLANT_QUALIFIERS


def assess(recipe: dict) -> dict:
    """What would have to change, and whether it can go in the fasting book."""
    blockers: list[str] = []
    changes: list[str] = []
    new_ingredients: list[str] = []
    title_low = recipe["title"].lower()
    smoke_ok = any(word in title_low for word in SMOKE_SUITS)

    for raw in recipe["ingredients"]:
        line = raw
        low = line.lower()

        stop = None
        for pattern, what in PREMADE:
            m = re.search(pattern, low)
            if m and not qualified(low, m.start()):
                stop = what
                break
        if stop:
            blockers.append(f"{stop} ({raw.strip()})")
            new_ingredients.append(line)
            continue

        for pattern, what in DISQUALIFY:
            for m in re.finditer(pattern, low):
                if not qualified(low, m.start()):
                    stop = what
                    break
            if stop:
                break
        if stop:
            blockers.append(f"{stop} ({raw.strip()})")
            new_ingredients.append(line)
            continue

        for pattern, what, replacement in SWAPS:
            match = re.search(pattern, line, re.I)
            if not match or qualified(line.lower(), match.start()):
                continue
            if what == "worcestershire" and not smoke_ok:
                blockers.append(f"worcestershire ({raw.strip()}) — smoke would change the dish")
                break
            if replacement is None:
                blockers.append(f"{what} ({raw.strip()})")
                break
            line = re.sub(pattern, replacement, line, flags=re.I)
            changes.append(f"{raw.strip()} → {line.strip()}")
            break

        new_ingredients.append(line)

    return {
        "fasting_ok": len(blockers) == 0,
        "blockers": blockers,
        "changes": changes,
        "fasting_ingredients": new_ingredients,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("parsed", help="the JSON from parse-recipe-pdfs.py")
    ap.add_argument("--out", default="for-import.json")
    args = ap.parse_args()

    recipes = json.loads(Path(args.parsed).read_text(encoding="utf-8"))
    out: list[dict] = []
    fasting_count = 0
    blocked_reasons: dict[str, int] = {}

    for recipe in recipes:
        verdict = assess(recipe)

        # Everyday gets it as written, always.
        out.append({
            "title": recipe["title"],
            "fasting": False,
            "hands_on": recipe["hands_on"],
            "total_time": recipe["total_time"],
            "serves": recipe["serves"],
            "preheat": recipe["preheat"],
            "intro": "",
            "ingredients": recipe["ingredients"],
            "directions": recipe["directions"],
            "notes": recipe["notes"],
            "source": recipe["source"],
        })

        if verdict["fasting_ok"]:
            fasting_count += 1
            note = recipe["notes"]
            if verdict["changes"]:
                swapped = "; ".join(verdict["changes"])
                note = (note + "  " if note else "") + f"Adjusted for fasting: {swapped}."
            out.append({
                "title": recipe["title"],
                "fasting": True,
                "hands_on": recipe["hands_on"],
                "total_time": recipe["total_time"],
                "serves": recipe["serves"],
                "preheat": recipe["preheat"],
                "intro": "",
                "ingredients": verdict["fasting_ingredients"],
                "directions": recipe["directions"],
                "notes": note.strip(),
                "source": recipe["source"],
            })
        else:
            for blocker in verdict["blockers"]:
                key = blocker.split(" (")[0]
                blocked_reasons[key] = blocked_reasons.get(key, 0) + 1

    Path(args.out).write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"{len(recipes)} recipes read.\n")
    print(f"EVERYDAY book: {len(recipes)} — every recipe, exactly as written")
    print(f"FASTING book:  {fasting_count} — can be made without animal products\n")
    print(f"{len(recipes) - fasting_count} cannot. Why, counted by first blocker:")
    for reason, n in sorted(blocked_reasons.items(), key=lambda kv: -kv[1]):
        print(f"  {reason:<24} {n}")
    print(f"\nWrote {len(out)} rows to {args.out}")


if __name__ == "__main__":
    main()
