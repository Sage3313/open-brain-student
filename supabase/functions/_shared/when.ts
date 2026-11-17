// Turn phrases like "3pm call Jack", "tomorrow 9am pray", "in 2h eat", "fri 6pm text Ryder",
// "11/20 10:30am exam" into a time and the reminder text. All times are Arizona time
// (America/Phoenix, UTC-7 all year, no daylight saving).
const OFFSET_H = 7;
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function azNow(now: Date) {
  return new Date(now.getTime() - OFFSET_H * 3600_000); // UTC getters now read Arizona wall time
}
function fromAz(y: number, m: number, d: number, h: number, min: number) {
  return new Date(Date.UTC(y, m, d, h + OFFSET_H, min));
}
function parseClock(tok: string): { h: number; m: number } | null {
  const t = tok.toLowerCase().replace(/\./g, "");
  if (t === "noon") return { h: 12, m: 0 };
  if (t === "midnight") return { h: 0, m: 0 };
  const m = t.match(/^(\d{1,2})(?::(\d{2}))?(am|pm|a|p)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ap = m[3];
  if (!ap && !m[2]) return null; // a bare number like "3" is too ambiguous
  if (min > 59) return null;
  if (ap) {
    if (h < 1 || h > 12) return null;
    if (ap.startsWith("p") && h !== 12) h += 12;
    if (ap.startsWith("a") && h === 12) h = 0;
  } else if (h > 23) return null;
  return { h, m: min };
}

export function parseWhen(input: string, now = new Date()): { at: Date; text: string } | { error: string } {
  const words = input.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return { error: "empty" };
  const az = azNow(now);
  let y = az.getUTCFullYear(), mo = az.getUTCMonth(), d = az.getUTCDate();
  let i = 0;

  // "in 2h", "in 30 min", "in 3 days"
  if (words[0].toLowerCase() === "in" && words.length >= 2) {
    let numTok = words[1].toLowerCase(), unitTok = "";
    const glued = numTok.match(/^(\d+(?:\.\d+)?)([a-z]+)$/);
    if (glued) { numTok = glued[1]; unitTok = glued[2]; i = 2; }
    else { unitTok = (words[2] ?? "").toLowerCase(); i = 3; }
    const n = Number(numTok);
    const unit = unitTok.startsWith("mi") || unitTok === "m" ? 60_000
      : unitTok.startsWith("h") ? 3600_000
      : unitTok.startsWith("d") ? 86400_000
      : unitTok.startsWith("w") ? 7 * 86400_000 : 0;
    if (!n || !unit) return { error: "time" };
    const text = words.slice(i).join(" ");
    if (!text) return { error: "text" };
    return { at: new Date(now.getTime() + n * unit), text };
  }

  // optional day word
  let dayGiven = false;
  const w0 = words[0].toLowerCase();
  if (w0 === "today" || w0 === "tonight") { dayGiven = true; i = 1; }
  else if (w0 === "tomorrow" || w0 === "tmrw" || w0 === "tmr") { d += 1; dayGiven = true; i = 1; }
  else if (DAYS.some((p) => w0.startsWith(p)) && /^[a-z]+$/.test(w0)) {
    const target = DAYS.findIndex((p) => w0.startsWith(p));
    let diff = (target - az.getUTCDay() + 7) % 7;
    if (diff === 0) diff = 7; // "friday" said on a Friday means next Friday
    d += diff; dayGiven = true; i = 1;
  } else {
    const md = w0.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
    if (md) {
      mo = Number(md[1]) - 1; d = Number(md[2]);
      if (md[3]) y = Number(md[3].length === 2 ? "20" + md[3] : md[3]);
      dayGiven = true; i = 1;
    }
  }

  // optional "at", then a clock time
  if ((words[i] ?? "").toLowerCase() === "at") i += 1;
  let clock = words[i] ? parseClock(words[i]) : null;
  if (!clock && words[i] && words[i + 1] && /^(am|pm)$/i.test(words[i + 1])) {
    clock = parseClock(words[i] + words[i + 1]);
    if (clock) i += 1;
  }
  if (!clock && w0 === "tonight" && /^\d{1,2}(:\d{2})?$/.test(words[i] ?? "")) {
    clock = parseClock(words[i] + "pm"); // "tonight 9" means 9pm
  }
  if (clock) i += 1;
  if (!clock && !dayGiven) return { error: "time" };
  if (!clock) clock = w0 === "tonight" ? { h: 20, m: 0 } : { h: 9, m: 0 };
  if (w0 === "tonight" && clock.h < 12) clock.h += 12;

  let at = fromAz(y, mo, d, clock.h, clock.m);
  if (!dayGiven && at.getTime() <= now.getTime()) at = fromAz(y, mo, d + 1, clock.h, clock.m);
  if (at.getTime() <= now.getTime() - 60_000) return { error: "past" };

  const text = words.slice(i).join(" ").replace(/^to\s+/i, "");
  if (!text) return { error: "text" };
  return { at, text };
}

export function formatAz(at: Date) {
  return at.toLocaleString("en-US", {
    timeZone: "America/Phoenix", weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}
