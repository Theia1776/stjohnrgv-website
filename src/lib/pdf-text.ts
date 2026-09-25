/**
 * Pulling the text out of a PDF, in the browser.
 *
 * Shared by the two admin pages that upload PDFs — the library and the
 * catechism lessons — so the text, the page markers and the rules about
 * what counts as a scan can never drift apart between them.
 *
 * It runs in the browser rather than on the server on purpose: a long
 * PDF would blow through a Cloudflare Function's CPU budget, and the
 * admin's browser has PDF.js loaded already.
 *
 * PDF.js gives us the text layer. A PDF that was typeset digitally
 * hands it over cleanly; one that is photographs of pages has none to
 * give and comes back empty — that's a scan, not a failure, and it is
 * recorded as such so a backfill doesn't keep retrying it.
 *
 * The page it lives on must load PDF.js itself, e.g.
 *   <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
 */

const PDFJS_VERSION = "3.11.174";

/** Beyond this the beginning is kept rather than the file refused. */
export const MAX_TEXT_CHARS = 3_000_000;

export type Extraction = { text: string; status: "ok" | "empty" | "error"; pages: number };

let workerConfigured = false;

/**
 * PDF.js off the window, with its worker pointed at the matching build.
 *
 * Read at call time, not when this module is first evaluated: the CDN
 * tag and this module are separate scripts, and which lands first is
 * not ours to decide.
 */
export function getPdfjs(): any {
  const lib = (window as unknown as { pdfjsLib?: any }).pdfjsLib;
  if (lib && !workerConfigured) {
    lib.GlobalWorkerOptions.workerSrc =
      `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.js`;
    workerConfigured = true;
  }
  return lib;
}

export async function extractText(
  source: { data: ArrayBuffer } | { url: string },
  onProgress?: (page: number, total: number) => void,
): Promise<Extraction> {
  const pdfjsLib = getPdfjs();
  if (!pdfjsLib) return { text: "", status: "error", pages: 0 };
  try {
    const pdf = await pdfjsLib.getDocument(source).promise;

    // Many PDFs carry real page labels — i, ii, iii through the front
    // matter, then 1, 2, 3 — and those are what's printed on the paper,
    // which is what a citation needs. Where a file has none, its
    // position in the file is the honest fallback.
    let labels: string[] | null = null;
    try {
      labels = await pdf.getPageLabels();
    } catch {
      labels = null;
    }

    const parts: string[] = [];
    let chars = 0;
    let pagesWithText = 0;
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      // PDF.js hands back positioned fragments, so they're joined with
      // spaces and squeezed down to one line per page.
      const pageText = content.items
        .map((it: any) => it.str)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (pageText) {
        const label = labels && labels[i - 1] ? String(labels[i - 1]) : String(i);
        // The marker carries what to show and where to go: the printed
        // label, then the page's position in the file. U+241E is a
        // character no book contains, so it can never be mistaken for
        // the text itself. Readers strip these out on load.
        parts.push(`␞${label}|${i}␞\n${pageText}`);
        chars += pageText.length;
        pagesWithText++;
      }
      onProgress?.(i, pdf.numPages);
      if (chars > MAX_TEXT_CHARS) break;
    }
    // A blank line between pages, so a text view has some sense of
    // where one page ended and the next began.
    const text = parts.join("\n\n").slice(0, MAX_TEXT_CHARS);
    // pages counts the pages the text actually carries markers for —
    // that's what tells a backfill this file has page numbers.
    return { text, status: text ? "ok" : "empty", pages: text ? pagesWithText : 0 };
  } catch (err) {
    console.error("Text extraction failed:", err);
    return { text: "", status: "error", pages: 0 };
  }
}
