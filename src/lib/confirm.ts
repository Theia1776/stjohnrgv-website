/**
 * An in-page confirmation, in place of window.confirm.
 *
 * The native confirm() is a blocking call: while its box is up the
 * renderer stops. Nothing else on the page runs, no script can answer
 * it, and to anything driving the browser the button that opened it
 * simply looks dead. That is how a working Send button came to look
 * broken — the click landed, the box opened, and everything froze
 * behind it with nothing on screen to explain why.
 *
 * This is the same question asked with a real <dialog>. It returns a
 * promise, so the caller awaits an answer instead of the page halting,
 * and it is an ordinary element: it can be styled like the rest of the
 * parish site, read by a screen reader, and clicked by a test.
 *
 *   if (!(await confirmAction("Delete this?"))) return;
 *
 * Escape and the backdrop both mean no, which is the safe answer, and
 * the cancel button holds focus when it opens so a stray Return never
 * sends anything.
 */

export interface ConfirmOptions {
  /** The question. Plain text; line breaks are kept. */
  message: string;
  /** The button that says yes. Name the action: "Send", "Delete". */
  confirmLabel?: string;
  /** The button that says no. */
  cancelLabel?: string;
  /**
   * Colour the yes button as destructive. For deletes and anything
   * else that cannot be undone.
   */
  danger?: boolean;
}

/** Injected once, the first time a dialog is opened. */
const STYLE_ID = "parish-confirm-style";

const STYLE = `
dialog.parish-confirm {
  border: 1px solid var(--color-border-soft, #d8d0c0);
  background: var(--color-cream-card, #fdfaf4);
  color: var(--color-text-primary, #2b2b2b);
  padding: 0;
  max-width: 32rem;
  width: calc(100% - 2rem);
  box-shadow: 0 10px 40px rgb(0 0 0 / 0.18);
}
dialog.parish-confirm::backdrop {
  background: rgb(0 0 0 / 0.45);
}
dialog.parish-confirm .parish-confirm-body {
  padding: 1.5rem;
}
dialog.parish-confirm p {
  margin: 0;
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
dialog.parish-confirm .parish-confirm-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  justify-content: flex-end;
  padding: 0 1.5rem 1.5rem;
}
dialog.parish-confirm .parish-confirm-danger {
  background: var(--color-liturgical-red, #8c2f2f);
  border-color: var(--color-liturgical-red, #8c2f2f);
  color: #fff;
}
`;

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = STYLE;
  document.head.appendChild(el);
}

/**
 * Ask the question. Resolves true only if the person chose the
 * confirming button; Escape, the cancel button and the backdrop all
 * resolve false.
 *
 * Falls back to window.confirm only where <dialog> is unsupported,
 * which in practice means a browser old enough that the native box is
 * the honest option.
 */
export function confirmAction(options: ConfirmOptions | string): Promise<boolean> {
  const opts: ConfirmOptions = typeof options === "string" ? { message: options } : options;
  const message = opts.message;
  const confirmLabel = opts.confirmLabel ?? "Yes, go ahead";
  const cancelLabel = opts.cancelLabel ?? "Cancel";

  if (typeof document === "undefined" || typeof HTMLDialogElement === "undefined") {
    return Promise.resolve(window.confirm(message));
  }

  ensureStyle();

  const dialog = document.createElement("dialog");
  dialog.className = "parish-confirm";

  const body = document.createElement("div");
  body.className = "parish-confirm-body";
  const text = document.createElement("p");
  text.textContent = message;
  body.appendChild(text);

  const actions = document.createElement("div");
  actions.className = "parish-confirm-actions";

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "btn btn-secondary";
  cancel.textContent = cancelLabel;

  const ok = document.createElement("button");
  ok.type = "button";
  ok.className = `btn btn-primary${opts.danger ? " parish-confirm-danger" : ""}`;
  ok.textContent = confirmLabel;

  actions.append(cancel, ok);
  dialog.append(body, actions);
  dialog.setAttribute("aria-label", message.slice(0, 120));
  document.body.appendChild(dialog);

  return new Promise<boolean>((resolve) => {
    let answered = false;

    const finish = (answer: boolean) => {
      if (answered) return;
      answered = true;
      // close() fires the "close" event, which cleans the node up.
      dialog.dataset.answer = answer ? "yes" : "no";
      dialog.close();
      resolve(answer);
    };

    ok.addEventListener("click", () => finish(true));
    cancel.addEventListener("click", () => finish(false));

    // Escape dismisses a <dialog> on its own; treat that as no.
    dialog.addEventListener("cancel", (ev) => {
      ev.preventDefault();
      finish(false);
    });

    // A click on the backdrop lands on the dialog element itself.
    dialog.addEventListener("click", (ev) => {
      if (ev.target === dialog) finish(false);
    });

    dialog.addEventListener("close", () => {
      dialog.remove();
      // Anything that closed it without going through finish() — a
      // stray form submit, say — still has to settle the promise.
      finish(false);
    });

    dialog.showModal();
    // The safe option holds focus, so Return never confirms by accident.
    cancel.focus();
  });
}
