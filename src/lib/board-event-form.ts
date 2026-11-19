/**
 * The event form, shared by "New event" in the Events room and "Edit
 * event" on an event's topic. It draws the fields into a container,
 * reads them back out, and fills them in for an edit.
 */

export interface EventData {
  title: string;
  hosting: boolean;
  date: string;
  start: string;
  end: string | null;
  place: string;
  address: string | null;
  contact: string | null;
  gift: string | null;
  details?: string;
  items: Array<{ id: string | null; label: string }>;
}

const FIELD =
  "block w-full border border-border-soft bg-cream-bg px-3 py-2";
const LABEL = "block text-xs uppercase tracking-widest text-text-secondary mb-1";

function el<T extends HTMLElement>(root: HTMLElement, id: string): T {
  return root.querySelector(`#${id}`) as T;
}

export function renderEventForm(root: HTMLElement, opts: { rsvp: boolean }): void {
  root.innerHTML = `
    <fieldset class="flex flex-wrap gap-4">
      <legend class="${LABEL}">Are you hosting?</legend>
      <label class="flex items-center gap-2 text-sm font-semibold"><input type="radio" name="ev-host" value="host" id="ev-host" class="h-4 w-4" /> Hosting</label>
      <label class="flex items-center gap-2 text-sm font-semibold"><input type="radio" name="ev-host" value="post" id="ev-post" class="h-4 w-4" checked /> Just posting</label>
    </fieldset>

    <label class="block"><span class="${LABEL}">Event name</span>
      <input id="ev-title" type="text" maxlength="160" required spellcheck="true" autocapitalize="words" class="${FIELD}" /></label>

    <div class="grid gap-3 sm:grid-cols-3">
      <label class="block"><span class="${LABEL}">Date</span>
        <input id="ev-date" type="date" required class="${FIELD}" /></label>
      <label class="block"><span class="${LABEL}">Starts</span>
        <input id="ev-start" type="time" required class="${FIELD}" /></label>
      <label class="block"><span class="${LABEL}">Ends (optional)</span>
        <input id="ev-end" type="time" class="${FIELD}" /></label>
    </div>

    <label class="block"><span class="${LABEL}">Where (name of the place)</span>
      <input id="ev-place" type="text" maxlength="160" required spellcheck="true" class="${FIELD}" /></label>
    <label class="block"><span class="${LABEL}">Address (optional)</span>
      <input id="ev-address" type="text" maxlength="200" autocomplete="street-address" class="${FIELD}" /></label>
    <label class="block"><span class="${LABEL}">Phone or email for questions and RSVP (optional)</span>
      <input id="ev-contact" type="text" maxlength="120" class="${FIELD}" /></label>

    <label class="block"><span class="${LABEL}">Does anyone need to bring a gift?</span>
      <select id="ev-gift" class="${FIELD}">
        <option value="">No gift needed</option>
        <option value="boy">A gift for a boy</option>
        <option value="girl">A gift for a girl</option>
        <option value="man">A gift for a man</option>
        <option value="woman">A gift for a woman</option>
        <option value="anyone">A gift (anyone)</option>
      </select></label>

    <label class="block"><span class="${LABEL}">Details: what it is for, how to dress, anything people should know</span>
      <textarea id="ev-details" rows="5" maxlength="5000" required spellcheck="true" autocapitalize="sentences" class="${FIELD}"></textarea></label>

    <div id="ev-items-box" class="hidden border border-border-soft p-3 space-y-2">
      <p class="${LABEL}" style="margin-bottom:0">What do you need people to bring?</p>
      <p class="text-xs text-text-secondary">One thing per line. Each shows on the event with an "I'll bring this" button, so people can see what's still needed.</p>
      <div id="ev-items" class="space-y-2"></div>
      <button id="ev-add-item" type="button" class="bb-btn">Add item</button>
    </div>

    ${opts.rsvp ? `<label class="flex items-center gap-2 text-sm font-semibold"><input id="ev-rsvp" type="checkbox" class="h-4 w-4" checked /> Ask people to RSVP (Yes, Maybe, No, with names shown)</label>` : ""}
  `;

  const box = el<HTMLElement>(root, "ev-items-box");
  const list = el<HTMLElement>(root, "ev-items");
  const sync = () => box.classList.toggle("hidden", !el<HTMLInputElement>(root, "ev-host").checked);
  root.querySelectorAll('input[name="ev-host"]').forEach((r) => r.addEventListener("change", sync));

  const addItem = (label = "", id: string | null = null) => {
    const row = document.createElement("div");
    row.className = "flex gap-2";
    if (id) row.dataset.id = id;
    row.innerHTML = `<input type="text" maxlength="80" placeholder="For example: cups, plates and napkins" aria-label="Something to bring" class="${FIELD}" /><button type="button" class="bb-btn ev-remove" aria-label="Remove this item">Remove</button>`;
    (row.querySelector("input") as HTMLInputElement).value = label;
    row.querySelector(".ev-remove")?.addEventListener("click", () => row.remove());
    list.appendChild(row);
  };
  el<HTMLButtonElement>(root, "ev-add-item").addEventListener("click", () => {
    if (list.children.length < 15) addItem();
  });
  // Starts with one empty item, as asked.
  addItem();
  (root as HTMLElement & { _addItem?: typeof addItem })._addItem = addItem;
  sync();
}

export function fillEventForm(root: HTMLElement, ev: EventData & { details: string }): void {
  const set = (id: string, v: string | null | undefined) => {
    (el<HTMLInputElement>(root, id)).value = v ?? "";
  };
  (ev.hosting ? el<HTMLInputElement>(root, "ev-host") : el<HTMLInputElement>(root, "ev-post")).checked = true;
  set("ev-title", ev.title);
  set("ev-date", ev.date);
  set("ev-start", ev.start);
  set("ev-end", ev.end);
  set("ev-place", ev.place);
  set("ev-address", ev.address);
  set("ev-contact", ev.contact);
  set("ev-gift", ev.gift);
  set("ev-details", ev.details);
  el<HTMLElement>(root, "ev-items-box").classList.toggle("hidden", !ev.hosting);

  const list = el<HTMLElement>(root, "ev-items");
  list.innerHTML = "";
  const add = (root as HTMLElement & { _addItem?: (l?: string, i?: string | null) => void })._addItem;
  if (add) {
    if (ev.items.length) ev.items.forEach((i) => add(i.label, i.id));
    else add();
  }
}

export function readEventForm(root: HTMLElement): Record<string, unknown> {
  const val = (id: string) => el<HTMLInputElement>(root, id).value.trim();
  const hosting = el<HTMLInputElement>(root, "ev-host").checked;
  const items = [...el<HTMLElement>(root, "ev-items").children]
    .map((row) => ({
      id: (row as HTMLElement).dataset.id ?? null,
      label: ((row.querySelector("input") as HTMLInputElement).value ?? "").trim(),
    }))
    .filter((i) => i.label);
  const rsvp = root.querySelector("#ev-rsvp") as HTMLInputElement | null;
  return {
    title: val("ev-title"),
    hosting,
    date: val("ev-date"),
    start: val("ev-start"),
    end: val("ev-end"),
    place: val("ev-place"),
    address: val("ev-address"),
    contact: val("ev-contact"),
    gift: val("ev-gift"),
    details: val("ev-details"),
    items: hosting ? items : [],
    rsvp: rsvp ? rsvp.checked : true,
  };
}

/** An .ics file for "Add to my calendar". Times are the parish's own, no zone. */
export function eventIcs(ev: EventData, url: string): string {
  const ymd = ev.date.replace(/-/g, "");
  const hm = (t: string) => t.replace(":", "") + "00";
  let end = ev.end;
  if (!end) {
    const [h, m] = ev.start.split(":").map(Number);
    end = `${String((h + 2) % 24).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/[,;]/g, (c) => "\\" + c).replace(/\n/g, "\\n");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//St. John of Kronstadt//Parish Board//EN",
    "BEGIN:VEVENT",
    `UID:${ymd}-${hm(ev.start)}-${esc(ev.title).slice(0, 20)}@stjohnrgv.org`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`,
    `DTSTART:${ymd}T${hm(ev.start)}`,
    `DTEND:${ymd}T${hm(end)}`,
    `SUMMARY:${esc(ev.title)}`,
    `LOCATION:${esc(`${ev.place}${ev.address ? ", " + ev.address : ""}`)}`,
    `DESCRIPTION:${esc(url)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}
