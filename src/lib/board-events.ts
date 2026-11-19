/**
 * Events: checking what the form sent, and writing the post from it.
 */

export const GIFTS = ["boy", "girl", "man", "woman", "anyone"] as const;
export const MAX_ITEMS = 15;

export interface EventFields {
  title: string;
  hosting: boolean;
  date: string; // YYYY-MM-DD
  start: string; // HH:MM
  end: string | null;
  place: string;
  address: string;
  contact: string;
  gift: string | null;
  details: string;
  items: Array<{ id: string | null; label: string }>;
  rsvp: boolean;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;

function realDate(s: string): boolean {
  if (!DATE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
function realTime(s: string): boolean {
  if (!TIME.test(s)) return false;
  const [h, m] = s.split(":").map(Number);
  return h >= 0 && h < 24 && m >= 0 && m < 60;
}

export function parseEvent(raw: unknown): { ok: true; value: EventFields } | { ok: false; error: string } {
  const o = (raw ?? {}) as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

  const title = str(o.title, 160);
  const date = str(o.date, 10);
  const start = str(o.start, 5);
  const endRaw = str(o.end, 5);
  const place = str(o.place, 160);
  const details = str(o.details, 5000);
  const giftRaw = str(o.gift, 10);

  if (!title) return { ok: false, error: "Give the event a name." };
  if (!realDate(date)) return { ok: false, error: "Pick the date." };
  if (!realTime(start)) return { ok: false, error: "Pick the time it starts." };
  if (endRaw && !realTime(endRaw)) return { ok: false, error: "That end time isn't a time." };
  if (!place) return { ok: false, error: "Say where it is." };
  if (details.length < 20) {
    return { ok: false, error: "Write at least a sentence about what the event is, so people know what to expect." };
  }
  if (giftRaw && !(GIFTS as readonly string[]).includes(giftRaw)) {
    return { ok: false, error: "Pick who the gift is for from the list." };
  }

  const hosting = o.hosting === true;
  const items = hosting && Array.isArray(o.items)
    ? (o.items as unknown[])
        .map((i) => {
          const it = i as { id?: unknown; label?: unknown };
          return {
            id: typeof it.id === "string" && it.id ? it.id : null,
            label: typeof it.label === "string" ? it.label.trim().slice(0, 80) : "",
          };
        })
        .filter((i) => i.label)
        .slice(0, MAX_ITEMS)
    : [];

  return {
    ok: true,
    value: {
      title,
      hosting,
      date,
      start,
      end: endRaw || null,
      place,
      address: str(o.address, 200),
      contact: str(o.contact, 120),
      gift: giftRaw || null,
      details,
      items,
      rsvp: o.rsvp !== false,
    },
  };
}

function time12(t: string): string {
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** "Saturday, December 12, 2026, 2:00 PM to 5:00 PM" */
export function whenText(date: string, start: string, end: string | null): string {
  const [y, m, d] = date.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  return `${day}, ${time12(start)}${end ? ` to ${time12(end)}` : ""}`;
}

/** The first post of an event topic, written from the form. */
export function eventBody(e: EventFields, who: string): string {
  const lines = [
    `[b]When:[/b] ${whenText(e.date, e.start, e.end)}`,
    `[b]Where:[/b] ${e.place}${e.address ? `, ${e.address}` : ""}`,
  ];
  if (e.contact) lines.push(`[b]RSVP / questions:[/b] ${e.contact}`);
  if (e.gift) {
    lines.push(`[b]Gift:[/b] ${e.gift === "anyone" ? "A gift is needed." : `A gift is needed for a ${e.gift}.`}`);
  }
  lines.push(e.hosting ? `[b]Host:[/b] ${who}` : `[b]Shared by:[/b] ${who}`);
  return `${lines.join("\n")}\n\n${e.details}`;
}
