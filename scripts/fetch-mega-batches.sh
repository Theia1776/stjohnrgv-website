#!/usr/bin/env bash
# Pull the MEGA folders the library is still missing, one after another.
#
# Resumable: each folder skips files already present at the right size,
# so re-running after a stop costs nothing. Ordered smallest-first, so
# the quick wins land early and a stop mid-run still leaves whole
# folders finished.
set -u

LINK="https://mega.nz/folder/WE4XjbQJ#WDHYHXV1pONaFwK1TpZaJA"
ROOT="library-incoming"

# folder-name-fragment : destination
FOLDERS=(
  "Books in Serbian:serbian"
  "Books in Greek:greek"
  "Bibles:bibles"
  "Letters from the Holy Fathers:letters"
  "Issues of Death to the World:death-to-the-world"
  "Comentaries:commentaries"
  "Edifying writings:edifying"
  "Prayers and Liturgical books:prayers"
  "Lives of Saints:lives-of-saints"
  "Books on the Spiritual Life:spiritual-life"
  "Books Against Heresy:against-heresy"
  "Orthodox Word issues:orthodox-word"
)

for entry in "${FOLDERS[@]}"; do
  name="${entry%%:*}"
  dest="${entry##*:}"
  echo "=== $name -> $ROOT/$dest ==="
  node scripts/list-mega-folder.mjs "$LINK" --download "$ROOT/$dest" --folder "$name"
  echo
done

echo "All folders attempted."
du -sh "$ROOT" 2>/dev/null || true
