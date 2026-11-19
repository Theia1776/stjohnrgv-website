/**
 * The "Add photos" button under a post box.
 *
 * Every photo is shrunk here, in the browser, before it goes anywhere:
 * at most 1600 pixels on the long side, re-saved as a JPEG, with a
 * small thumbnail beside it. A 12 MB camera photo becomes a few
 * hundred KB, which is the whole reason the parish isn't buying
 * storage for this. Re-drawing the picture also drops everything
 * attached to the original file -- including the GPS location a phone
 * writes into it, which nobody meant to post.
 *
 * A photo uploads the moment it's picked, so the person sees it was
 * accepted, and is attached to the post when they press Submit (the
 * post routes take the list from ids()).
 */

import { boardFetch, errorDetail } from "./board-ui";

const MAX_PHOTOS = 4;
const FULL_EDGES = [1600, 1280, 1000];
const FULL_QUALITIES = [0.82, 0.7, 0.58];
const FULL_TARGET_BYTES = 700_000;
const THUMB_EDGE = 480;
const THUMB_QUALITY = 0.75;

export interface PhotoPicker {
  /** The photos waiting to go on the post. */
  ids(): string[];
  /** True while one is still being shrunk or sent. */
  busy(): boolean;
  /** The post went through; forget them without deleting anything. */
  clear(): void;
  /** Cancelled; delete whatever was uploaded and never posted. */
  discard(): Promise<void>;
}

type Item = { id: string; preview: string };

async function decode(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; done: () => void }> {
  try {
    // 'from-image' applies the phone's rotation, so a portrait photo
    // doesn't land on its side.
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { source: bitmap, width: bitmap.width, height: bitmap.height, done: () => bitmap.close() };
  } catch {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    await img.decode();
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      done: () => URL.revokeObjectURL(url),
    };
  }
}

function toJpeg(
  source: CanvasImageSource,
  width: number,
  height: number,
  edge: number,
  quality: number,
): Promise<{ blob: Blob; width: number; height: number }> {
  const scale = Math.min(1, edge / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("This browser can't resize photos."));

  // A transparent PNG would otherwise turn black as a JPEG.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(source, 0, 0, w, h);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve({ blob, width: w, height: h }) : reject(new Error("Couldn't resize that photo."))),
      "image/jpeg",
      quality,
    );
  });
}

async function shrink(file: File) {
  const picture = await decode(file);
  try {
    let full: { blob: Blob; width: number; height: number } | null = null;
    outer: for (const edge of FULL_EDGES) {
      for (const quality of FULL_QUALITIES) {
        full = await toJpeg(picture.source, picture.width, picture.height, edge, quality);
        if (full.blob.size <= FULL_TARGET_BYTES) break outer;
      }
    }
    if (!full) throw new Error("Couldn't resize that photo.");
    const thumb = await toJpeg(picture.source, picture.width, picture.height, THUMB_EDGE, THUMB_QUALITY);
    return { full, thumb };
  } finally {
    picture.done();
  }
}

/**
 * @param existing how many photos the post already has (when editing),
 *                 so the four-photo limit counts them too.
 */
export function attachPhotoPicker(mount: HTMLElement, existing = 0): PhotoPicker {
  const items: Item[] = [];
  let working = 0;

  mount.classList.add("bb-picker");
  mount.innerHTML = `
    <button type="button" class="bb-btn bb-picker-add">Add photos</button>
    <input type="file" class="bb-picker-input" accept="image/*" multiple hidden />
    <span class="bb-picker-note" role="status">Up to ${MAX_PHOTOS} per post. They're shrunk automatically, so any size is fine.</span>
    <div class="bb-picker-thumbs"></div>`;

  const addButton = mount.querySelector(".bb-picker-add") as HTMLButtonElement;
  const input = mount.querySelector(".bb-picker-input") as HTMLInputElement;
  const note = mount.querySelector(".bb-picker-note") as HTMLElement;
  const strip = mount.querySelector(".bb-picker-thumbs") as HTMLElement;

  function draw() {
    strip.innerHTML = items
      .map(
        (it) => `
        <span class="bb-picker-thumb" data-id="${it.id}">
          <img src="${it.preview}" alt="Photo you're adding" />
          <button type="button" class="bb-picker-remove" aria-label="Remove this photo" title="Remove">&times;</button>
        </span>`,
      )
      .join("");
    addButton.disabled = existing + items.length + working >= MAX_PHOTOS;
  }

  addButton.addEventListener("click", () => input.click());

  input.addEventListener("change", async () => {
    const files = [...(input.files ?? [])];
    input.value = "";

    for (const file of files) {
      if (existing + items.length + working >= MAX_PHOTOS) {
        note.textContent = `That's ${MAX_PHOTOS} photos, the most a post can carry.`;
        break;
      }
      if (!file.type.startsWith("image/")) {
        note.textContent = `${file.name} isn't a photo, so it was skipped.`;
        continue;
      }

      working += 1;
      draw();
      note.textContent = "Getting your photo ready…";
      try {
        const { full, thumb } = await shrink(file);

        const form = new FormData();
        form.append("full", full.blob, "full.jpg");
        form.append("thumb", thumb.blob, "thumb.jpg");
        form.append("width", String(full.width));
        form.append("height", String(full.height));

        const res = await boardFetch("/api/board/photo", { method: "POST", body: form });
        if (!res) return;
        if (!res.ok) {
          note.textContent = (await errorDetail(res)) || `Couldn't add that photo (${res.status}).`;
          continue;
        }
        const { id } = await res.json();
        items.push({ id, preview: URL.createObjectURL(thumb.blob) });
        note.textContent = `Added. It goes up when you press Submit.`;
      } catch (err) {
        note.textContent =
          err instanceof Error && err.message
            ? err.message
            : "That photo wouldn't open. Try a different one.";
      } finally {
        working -= 1;
        draw();
      }
    }
  });

  strip.addEventListener("click", async (event) => {
    const button = (event.target as HTMLElement).closest(".bb-picker-remove");
    const id = (button?.closest(".bb-picker-thumb") as HTMLElement | null)?.dataset.id;
    if (!id) return;
    const at = items.findIndex((it) => it.id === id);
    if (at < 0) return;
    const [gone] = items.splice(at, 1);
    URL.revokeObjectURL(gone.preview);
    draw();
    await boardFetch(`/api/board/photo?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  });

  return {
    ids: () => items.map((it) => it.id),
    busy: () => working > 0,
    clear() {
      for (const it of items) URL.revokeObjectURL(it.preview);
      items.length = 0;
      note.textContent = "";
      draw();
    },
    async discard() {
      const gone = items.splice(0);
      for (const it of gone) URL.revokeObjectURL(it.preview);
      draw();
      note.textContent = "";
      await Promise.all(
        gone.map((it) =>
          boardFetch(`/api/board/photo?id=${encodeURIComponent(it.id)}`, { method: "DELETE" }),
        ),
      );
    },
  };
}
