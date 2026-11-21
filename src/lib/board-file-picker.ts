/**
 * The "Attach a file" button under a post box.
 *
 * A file uploads the moment it is picked, so the person sees it was
 * accepted, and is attached to the post when they press Submit (the
 * post routes take the list from ids()). Same shape as the photo
 * picker next to it.
 *
 * Each file is either kept, or removed automatically 30 days after it
 * is posted. The choice is made when the file is picked.
 */

import { boardFetch, errorDetail } from "./board-ui";

const MAX_FILES = 6;

export interface FilePicker {
  /** The files waiting to go on the post. */
  ids(): string[];
  /** True while one is still uploading. */
  busy(): boolean;
  /** The post went through; forget them without deleting anything. */
  clear(): void;
  /** Cancelled; delete whatever was uploaded and never posted. */
  discard(): Promise<void>;
}

type Item = { id: string; name: string; size: string; expires: boolean };

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/** The name without its ending ("November.pdf" -> "November"). */
function bare(name: string): string {
  return name.replace(/\.[A-Za-z][A-Za-z0-9]{0,4}$/, "");
}

/** Ask what a file should be called. Resolves to the new name, or null if cancelled. */
export function askFileName(current: string): Promise<string | null> {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "bb-help-dialog";
    dialog.innerHTML = `
      <h2>Rename the file</h2>
      <label class="bb-help-label" for="file-new-name">The name people will see</label>
      <input id="file-new-name" type="text" maxlength="200" autocomplete="off" />
      <div class="bb-help-actions">
        <button type="button" id="file-name-save" class="bb-btn bb-btn-strong">Save</button>
        <button type="button" id="file-name-cancel" class="bb-btn">Cancel</button>
      </div>`;
    document.body.appendChild(dialog);
    const input = dialog.querySelector("input") as HTMLInputElement;
    input.value = bare(current);
    const done = (value: string | null) => {
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    const save = () => {
      const v = input.value.trim();
      if (v) done(v);
      else input.focus();
    };
    dialog.querySelector("#file-name-save")?.addEventListener("click", save);
    dialog.querySelector("#file-name-cancel")?.addEventListener("click", () => done(null));
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      done(null);
    });
    dialog.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        save();
      }
    });
    dialog.showModal();
    input.select();
  });
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * @param existing how many files the post already has (when editing),
 *                 so the limit counts them too.
 */
export function attachFilePicker(mount: HTMLElement, existing = 0): FilePicker {
  const items: Item[] = [];
  let working = 0;
  let maxBytes = 5 * 1024 * 1024;
  let maxLabel = "5 MB";

  mount.classList.add("bb-picker", "bb-file-picker");
  mount.innerHTML = `
    <button type="button" class="bb-btn bb-file-add">Attach a file</button>
    <input type="file" class="bb-file-input" hidden multiple />
    <span class="bb-file-keep">
      <label><input type="radio" name="keep-${Math.random().toString(36).slice(2, 8)}" value="forever" checked /> Keep it</label>
      <label><input type="radio" value="30" /> Remove it after 30 days</label>
    </span>
    <span class="bb-picker-note bb-file-note" role="status">PDFs, Word and Excel files, pictures and text files.</span>
    <ul class="bb-file-list"></ul>`;

  const addButton = mount.querySelector(".bb-file-add") as HTMLButtonElement;
  const input = mount.querySelector(".bb-file-input") as HTMLInputElement;
  const note = mount.querySelector(".bb-file-note") as HTMLElement;
  const list = mount.querySelector(".bb-file-list") as HTMLElement;
  const radios = [...mount.querySelectorAll('input[type="radio"]')] as HTMLInputElement[];
  // The two radios share a name made per picker, so two pickers on one
  // page don't switch each other's choice.
  const groupName = radios[0].name;
  radios[1].name = groupName;

  // What this person is allowed to attach. Quiet if it can't be asked.
  boardFetch("/api/board/file?limits=1", { method: "GET" })
    .then(async (res) => {
      if (!res || !res.ok) return;
      const j = await res.json();
      if (typeof j.maxBytes === "number") {
        maxBytes = j.maxBytes;
        maxLabel = j.maxLabel || sizeLabel(j.maxBytes);
        note.textContent = `PDFs, Word and Excel files, pictures and text files, up to ${maxLabel} each.`;
      }
    })
    .catch(() => {});

  function draw() {
    list.innerHTML = items
      .map(
        (it) => `
        <li data-id="${it.id}">
          <input class="bb-file-name-input" type="text" maxlength="200" value="${esc(bare(it.name))}" aria-label="Name people will see for this file" />
          <span class="bb-file-size">${esc(it.size)}${it.expires ? ", removed after 30 days" : ""}</span>
          <button type="button" class="bb-picker-remove bb-file-remove" aria-label="Remove ${esc(it.name)}" title="Remove">&times;</button>
        </li>`,
      )
      .join("");
    addButton.disabled = existing + items.length + working >= MAX_FILES;
  }

  addButton.addEventListener("click", () => input.click());

  input.addEventListener("change", async () => {
    const files = [...(input.files ?? [])];
    input.value = "";
    const expires = (mount.querySelector(`input[name="${groupName}"]:checked`) as HTMLInputElement | null)?.value === "30";

    for (const file of files) {
      if (existing + items.length + working >= MAX_FILES) {
        note.textContent = `That's ${MAX_FILES} files, the most a post can carry.`;
        break;
      }
      if (file.size > maxBytes) {
        note.textContent = `${file.name} is ${sizeLabel(file.size)}, and the most you can attach is ${maxLabel}.`;
        continue;
      }

      working += 1;
      draw();
      note.textContent = `Adding ${file.name}…`;
      try {
        const form = new FormData();
        form.append("file", file, file.name);
        form.append("keep", expires ? "30" : "forever");
        const res = await boardFetch("/api/board/file", { method: "POST", body: form });
        if (!res) return;
        if (!res.ok) {
          note.textContent = (await errorDetail(res)) || `Couldn't add ${file.name} (${res.status}).`;
          continue;
        }
        const j = await res.json();
        items.push({ id: j.id, name: j.name ?? file.name, size: sizeLabel(j.bytes ?? file.size), expires });
        note.textContent = "Added. It goes up when you press Submit.";
      } catch {
        note.textContent = `${file.name} wouldn't upload. Check your connection and try again.`;
      } finally {
        working -= 1;
        draw();
      }
    }
  });

  list.addEventListener("click", async (event) => {
    const button = (event.target as HTMLElement).closest(".bb-file-remove");
    const id = (button?.closest("li") as HTMLElement | null)?.dataset.id;
    if (!id) return;
    const at = items.findIndex((it) => it.id === id);
    if (at < 0) return;
    items.splice(at, 1);
    draw();
    await boardFetch(`/api/board/file?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  });

  // A name changed in the box is saved straight away.
  list.addEventListener("change", async (event) => {
    const input = event.target as HTMLInputElement;
    if (!input.classList.contains("bb-file-name-input")) return;
    const row = input.closest("li") as HTMLElement | null;
    const item = items.find((it) => it.id === row?.dataset.id);
    if (!item) return;
    const name = input.value.trim();
    if (!name) {
      input.value = bare(item.name);
      return;
    }
    const res = await boardFetch("/api/board/file", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: item.id, name }),
    });
    if (res && res.ok) {
      item.name = name;
      note.textContent = "Name saved.";
    } else {
      input.value = bare(item.name);
      note.textContent = (res && (await errorDetail(res))) || "Couldn't save that name.";
    }
  });

  draw();

  return {
    ids: () => items.map((it) => it.id),
    busy: () => working > 0,
    clear() {
      items.length = 0;
      draw();
    },
    async discard() {
      const gone = items.splice(0);
      draw();
      for (const it of gone) {
        await boardFetch(`/api/board/file?id=${encodeURIComponent(it.id)}`, { method: "DELETE" });
      }
    },
  };
}
