/**
 * One place that decides what a phone number looks like on this site.
 *
 * Everybody types their number differently — 9564346874, 956.434.6874,
 * +1 956 434 6874 — and the directory used to print back whatever they
 * typed. This turns all of those into the same thing: (956) 434-6874.
 *
 * Anything that isn't a recognisable US ten-digit number is handed back
 * untouched. A number from abroad, a half-typed one, or a note like
 * "call the office" still shows exactly as the person entered it.
 */

/** Digits only, with a leading US country code dropped. */
function tenDigits(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return null;
}

/** Split "956 434 6874 x12" into the number itself and the extension. */
function splitExtension(raw: string): { core: string; ext: string } {
  const m = raw.match(/(?:ext\.?|extension|x)\s*(\d{1,6})\s*$/i);
  if (!m) return { core: raw, ext: "" };
  return { core: raw.slice(0, m.index).trim(), ext: m[1] };
}

/**
 * (956) 434-6874 — area code in parentheses, dash after the next three.
 * Returns the original text when it can't be read as a US number.
 */
export function formatPhone(raw: string | null | undefined): string {
  if (!raw) return "";
  const text = String(raw).trim();
  if (!text) return "";

  const { core, ext } = splitExtension(text);
  const ten = tenDigits(core);
  if (!ten) return text;

  const pretty = `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
  return ext ? `${pretty} ext. ${ext}` : pretty;
}

/**
 * What belongs in href="tel:…" — digits a phone can actually dial,
 * never the parentheses and dashes a person reads.
 */
export function telHref(raw: string | null | undefined): string {
  if (!raw) return "";
  const text = String(raw).trim();
  const { core, ext } = splitExtension(text);
  const ten = tenDigits(core);
  // An extension rides along as ;ext= so a dialler doesn't dial it.
  if (ten) return `+1${ten}${ext ? `;ext=${ext}` : ""}`;
  // Unknown shape: keep the digits and a leading + if they gave one.
  const kept = core.replace(/[^\d+]/g, "");
  return kept.startsWith("+") ? "+" + kept.replace(/\+/g, "") : kept;
}

/**
 * Format as the person types. Only rewrites while the caret sits at the
 * end of the field, so backspacing into the middle of a number doesn't
 * fight them; a blur tidies up whatever's left.
 */
function maskWhileTyping(digits: string): string {
  const d = digits.replace(/\D/g, "").replace(/^1(?=\d)/, "").slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/** Give a text/tel input the house phone format. */
export function attachPhoneFormatting(input: HTMLInputElement | null): void {
  if (!input || input.dataset.phoneFormatted === "1") return;
  input.dataset.phoneFormatted = "1";

  input.addEventListener("input", () => {
    const atEnd = input.selectionStart === input.value.length;
    if (!atEnd) return;
    // Leave letters alone — somebody may be typing "ext" or a note.
    if (/[a-wyz]/i.test(input.value)) return;
    const next = maskWhileTyping(input.value);
    if (next !== input.value) {
      input.value = next;
      input.setSelectionRange(next.length, next.length);
    }
  });

  input.addEventListener("blur", () => {
    const next = formatPhone(input.value);
    if (next !== input.value) input.value = next;
  });
}

/** Format every phone field on the page at once. */
export function attachPhoneFormattingAll(selector = 'input[type="tel"]'): void {
  document.querySelectorAll<HTMLInputElement>(selector).forEach(attachPhoneFormatting);
}
