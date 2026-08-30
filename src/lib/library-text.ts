/**
 * Preparing extracted book text for the database.
 *
 * Shared by the two paths that store it: the upload form
 * (functions/api/admin/library/index.ts) and the backfill
 * (functions/api/admin/library/[id].ts).
 */

/**
 * Take out what Postgres will not store.
 *
 * A NUL character is legal in a JavaScript string and illegal in a
 * Postgres text column, and a lone surrogate isn't valid Unicode at all.
 * Both fall out of PDFs with unusual encodings — the 28 volumes of the
 * Nicene and Post-Nicene Fathers among them — and the save fails with
 * "unsupported Unicode escape sequence" even though every readable word
 * came out of the PDF perfectly well.
 *
 * Dropping the stray code units costs nothing: they carry no text.
 */
export function cleanForStorage(text: string): string {
  return text
    .replace(/\u0000/g, "")
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "")
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
}
