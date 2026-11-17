// reminders-tick: called by the database timer (pg_cron).
//   default mode (every minute): text Sage any reminders that are due.
//   ?mode=morning (once a day): text Sage a morning summary.
// Protected by REMINDER_CRON_KEY in the x-cron-key header. Every run records itself in job_runs
// so a silent stop is visible (the morning brief checks it).
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { formatAz } from "../_shared/when.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const CHAT_ID = Deno.env.get("TELEGRAM_OWNER_ID") ?? ""; // a private chat id equals the user id
const OWNER = Deno.env.get("OWNER_USER_ID") ?? "";
const CRON_KEY = Deno.env.get("REMINDER_CRON_KEY") ?? "";

function sameKey(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function send(text: string): Promise<boolean> {
  try {
    const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CHAT_ID, text }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

async function record(job: string, status: string, detail: string) {
  await db.from("job_runs").upsert({ job, last_run: new Date().toISOString(), status, detail });
}

async function sendDue() {
  const { data, error } = await db.from("reminders").select("id, text")
    .eq("user_id", OWNER).is("sent_at", null).eq("cancelled", false)
    .lte("remind_at", new Date().toISOString()).order("remind_at").limit(20);
  if (error) throw new Error(error.message);
  let sent = 0, failed = 0;
  for (const r of data ?? []) {
    // Claim it first so two overlapping runs never double-send.
    const { data: claimed } = await db.from("reminders").update({ sent_at: new Date().toISOString() })
      .eq("id", r.id).is("sent_at", null).select("id");
    if (!claimed?.length) continue;
    if (await send(`⏰ Reminder: ${r.text}`)) sent++;
    else {
      failed++;
      await db.from("reminders").update({ sent_at: null }).eq("id", r.id); // retry next minute
    }
  }
  return { sent, failed };
}

async function morning() {
  const now = new Date();
  const az = new Date(now.getTime() - 7 * 3600_000);
  const dayStart = new Date(Date.UTC(az.getUTCFullYear(), az.getUTCMonth(), az.getUTCDate(), 7));
  const dayEnd = new Date(dayStart.getTime() + 86400_000);
  const since = new Date(now.getTime() - 26 * 3600_000);

  const { data: rem } = await db.from("reminders").select("text, remind_at")
    .eq("user_id", OWNER).is("sent_at", null).eq("cancelled", false)
    .gte("remind_at", dayStart.toISOString()).lt("remind_at", dayEnd.toISOString()).order("remind_at");
  const { data: thoughts } = await db.from("thoughts").select("content")
    .eq("user_id", OWNER).gte("created_at", since.toISOString()).order("created_at");

  const commit = /\b(i need to|i will|i'll|i have to|i should|remember to|don't forget|ask \w+|call \w+|text \w+|email \w+|finish|submit)\b/i;
  const commitments = (thoughts ?? []).map((t) => t.content.replace(/^\S+ \w+: /, ""))
    .filter((c) => commit.test(c)).slice(0, 5);

  const lines = ["☀️ Good morning, Sage."];
  if (rem?.length) {
    lines.push("", "Today:");
    for (const r of rem) lines.push(`• ${formatAz(new Date(r.remind_at)).split(", ").pop()}  ${r.text}`);
  }
  if (commitments.length) {
    lines.push("", "You said you would:");
    for (const c of commitments) lines.push(`• ${c.slice(0, 140)}`);
  }
  if (!rem?.length && !commitments.length) lines.push("", "Nothing scheduled yet. What is the one thing today?");
  lines.push("", "Run /morning-brief in Claude when you sit down. Eat breakfast. Start with God.");
  const ok = await send(lines.join("\n"));
  if (!ok) throw new Error("Telegram send failed");
  return { reminders: rem?.length ?? 0, commitments: commitments.length };
}

Deno.serve(async (req) => {
  if (!CRON_KEY || !sameKey(req.headers.get("x-cron-key") ?? "", CRON_KEY)) {
    return new Response("Forbidden", { status: 403 });
  }
  const mode = new URL(req.url).searchParams.get("mode") ?? "tick";
  const job = mode === "morning" ? "morning-text" : "reminders-tick";
  try {
    const result = mode === "morning" ? await morning() : await sendDue();
    const failed = (result as { failed?: number }).failed ?? 0;
    await record(job, failed ? "FAILED" : "ok", JSON.stringify(result));
    return new Response(JSON.stringify({ ok: !failed, ...result }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    await record(job, "FAILED", (e as Error).message);
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), { status: 500 });
  }
});
