// Weight journal logic shared by the Telegram bot, the Claude tools, and the morning text.
// Days are Arizona calendar days (UTC-7, no daylight saving). One weigh-in per day.
// deno-lint-ignore-file no-explicit-any

export function azToday(now = new Date()): string {
  return new Date(now.getTime() - 7 * 3600_000).toISOString().slice(0, 10);
}

function shiftDay(day: string, delta: number): string {
  const d = new Date(day + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

// Reads "172.4", "172", "172.4 lbs", "w 172.4". Returns null if it is not a sane body weight.
export function parseLbs(s: string): number | null {
  const m = s.trim().match(/^(?:w\s*)?(\d{2,3}(?:\.\d)?)\s*(?:lbs?|pounds?)?$/i);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 50 && n <= 600 ? n : null;
}

export async function logWeight(db: any, owner: string, lbs: number, source: string, day = azToday()) {
  const { error } = await db.from("weigh_ins")
    .upsert({ user_id: owner, day, lbs, source, created_at: new Date().toISOString() }, { onConflict: "user_id,day" });
  if (error) throw new Error(error.message);
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sign = (n: number) => (n > 0 ? "+" : "") + n.toFixed(1);

// A short progress summary. Daily weight swings 1 to 3 lbs from water and food, so the
// 7-day average is the number that actually shows the trend.
export async function weightSummary(db: any, owner: string, showDays = 7): Promise<string> {
  const { data, error } = await db.from("weigh_ins").select("day, lbs")
    .eq("user_id", owner).order("day", { ascending: true });
  if (error) throw new Error(error.message);
  const rows = (data ?? []).map((r: any) => ({ day: r.day as string, lbs: Number(r.lbs) }));
  if (!rows.length) return "No weigh-ins yet. Text /w 172.4 (your weight) to log one.";

  const today = azToday();
  const last = rows[rows.length - 1];
  const prev = rows.length > 1 ? rows[rows.length - 2] : null;
  const first = rows[0];
  const lines: string[] = [];

  lines.push(`Latest: ${last.lbs.toFixed(1)} lbs (${last.day === today ? "today" : last.day})` +
    (prev ? `, ${sign(last.lbs - prev.lbs)} vs ${prev.day}` : ""));

  const wk = rows.filter((r) => r.day > shiftDay(today, -7));
  const prevWk = rows.filter((r) => r.day > shiftDay(today, -14) && r.day <= shiftDay(today, -7));
  if (wk.length) {
    let s = `7-day average: ${avg(wk.map((r) => r.lbs)).toFixed(1)} lbs (${wk.length} weigh-in${wk.length > 1 ? "s" : ""})`;
    if (prevWk.length) s += `, ${sign(avg(wk.map((r) => r.lbs)) - avg(prevWk.map((r) => r.lbs)))} vs the week before`;
    lines.push(s);
  }
  if (rows.length > 1) {
    const days = Math.max(1, Math.round((Date.parse(last.day) - Date.parse(first.day)) / 86400_000));
    lines.push(`Since ${first.day}: ${sign(last.lbs - first.lbs)} lbs over ${days} day${days > 1 ? "s" : ""}` +
      (days >= 14 ? ` (${sign(((last.lbs - first.lbs) / days) * 7)} per week)` : ""));
  }
  lines.push(`Logged ${rows.length} day${rows.length > 1 ? "s" : ""} total.`);

  const recent = rows.slice(-showDays).reverse();
  lines.push("", "Recent:");
  for (const r of recent) lines.push(`${r.day}  ${r.lbs.toFixed(1)}`);
  return lines.join("\n");
}

export async function loggedToday(db: any, owner: string): Promise<number | null> {
  const { data } = await db.from("weigh_ins").select("lbs").eq("user_id", owner).eq("day", azToday()).maybeSingle();
  return data ? Number(data.lbs) : null;
}
