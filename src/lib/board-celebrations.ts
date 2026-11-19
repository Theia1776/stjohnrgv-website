/**
 * Name days, baptism days and birthdays: working out who has one today
 * and in the coming week. Month and day only, in Texas time.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { mentionLabels } from "./board-mentions.ts";

export interface Celebration {
  name: string;
  what: string;
  /** "Today", or "Thursday, Feb 19". */
  when: string;
}

/** A real day of the year? (Feb 29 is allowed.) */
export function validDay(month: number, day: number): boolean {
  if (!Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(2024, month, 0).getDate();
}

/** [month, day, weekday label] for today and the next `ahead` days, Texas time. */
function upcomingDays(ahead: number): Array<{ month: number; day: number; label: string }> {
  const out: Array<{ month: number; day: number; label: string }> = [];
  const start = Date.now();
  for (let i = 0; i <= ahead; i++) {
    const when = new Date(start + i * 24 * 60 * 60 * 1000);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      month: "numeric",
      day: "numeric",
    }).formatToParts(when);
    const month = Number(parts.find((p) => p.type === "month")?.value);
    const day = Number(parts.find((p) => p.type === "day")?.value);
    const label =
      i === 0
        ? "Today"
        : new Intl.DateTimeFormat("en-US", {
            timeZone: "America/Chicago",
            weekday: "long",
            month: "short",
            day: "numeric",
          }).format(when);
    out.push({ month, day, label });
  }
  return out;
}

export async function celebrationsAhead(
  supabase: SupabaseClient,
  ahead = 7,
): Promise<Celebration[]> {
  const { data } = await supabase.from("board_celebrations").select("*");
  if (!data?.length) return [];
  const labels = await mentionLabels(supabase);
  const days = upcomingDays(ahead);

  const out: Celebration[] = [];
  for (const d of days) {
    for (const r of data) {
      const name = labels.get(r.user_id as string);
      if (!name) continue;
      if (r.name_day_month === d.month && r.name_day_day === d.day) {
        out.push({
          name,
          what: r.name_day_saint ? `name day (${r.name_day_saint})` : "name day",
          when: d.label,
        });
      }
      if (r.baptism_month === d.month && r.baptism_day === d.day) {
        out.push({ name, what: "baptism anniversary", when: d.label });
      }
      if (r.birthday_month === d.month && r.birthday_day === d.day) {
        out.push({ name, what: "birthday", when: d.label });
      }
    }
  }
  return out;
}
