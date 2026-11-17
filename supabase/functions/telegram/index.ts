// telegram: Sage texts a Telegram bot, the message lands in the Open Brain.
// Security:
//  1. Telegram must send the webhook secret (TELEGRAM_WEBHOOK_SECRET) in its header, so random
//     callers on the internet cannot post fake messages here.
//  2. Only messages from Sage's own Telegram account (TELEGRAM_OWNER_ID) are saved. Anyone else
//     who finds the bot gets told their ID and nothing is saved.
// Saves as OWNER_USER_ID with the server-only service role key.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const HOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") ?? "";
const TG_OWNER = Deno.env.get("TELEGRAM_OWNER_ID") ?? "";
const OWNER = Deno.env.get("OWNER_USER_ID") ?? "";

async function send(chatId: number, text: string) {
  if (!BOT_TOKEN) return;
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch (e) {
    console.error("telegram send failed", e);
  }
}

function sameKey(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// deno-lint-ignore no-explicit-any
async function recent(chatId: number) {
  const { data, error } = await db.from("thoughts").select("content, created_at")
    .eq("user_id", OWNER).order("created_at", { ascending: false }).limit(5);
  if (error) return send(chatId, "Could not load: " + error.message);
  if (!data?.length) return send(chatId, "Your brain is empty so far.");
  return send(chatId, data.map((t, i) => `${i + 1}. ${t.content.slice(0, 200)}`).join("\n\n"));
}

async function search(chatId: number, q: string) {
  const safe = q.replace(/[%_,()]/g, " ").trim();
  if (!safe) return send(chatId, "Usage: /search word");
  const { data, error } = await db.from("thoughts").select("content, created_at")
    .eq("user_id", OWNER).ilike("content", `%${safe}%`)
    .order("created_at", { ascending: false }).limit(5);
  if (error) return send(chatId, "Search failed: " + error.message);
  if (!data?.length) return send(chatId, `Nothing found for "${q}".`);
  return send(chatId, data.map((t, i) => `${i + 1}. ${t.content.slice(0, 200)}`).join("\n\n"));
}

Deno.serve(async (req) => {
  // Always answer Telegram with 200 so it does not retry forever; problems go back as a reply.
  const ok = () => new Response("ok");
  if (req.method !== "POST") return new Response("Use POST", { status: 405 });
  if (!HOOK_SECRET || !sameKey(req.headers.get("x-telegram-bot-api-secret-token") ?? "", HOOK_SECRET)) {
    return new Response("Forbidden", { status: 403 });
  }

  // deno-lint-ignore no-explicit-any
  let update: any;
  try { update = await req.json(); } catch { return ok(); }
  const msg = update.message ?? update.edited_message;
  if (!msg) return ok();
  const chatId: number = msg.chat.id;
  const fromId = String(msg.from?.id ?? "");

  if (!TG_OWNER || fromId !== TG_OWNER) {
    await send(chatId, `This is a private brain. Your Telegram ID is ${fromId}. If this is Sage, give that number to Claude to finish setup.`);
    return ok();
  }

  const text: string = (msg.text ?? msg.caption ?? "").trim();
  if (msg.voice || msg.audio) {
    await send(chatId, "Voice notes are not supported yet. Tap the mic on your keyboard and dictate a text instead.");
    return ok();
  }
  if (!text) {
    await send(chatId, "I can only save text and links right now.");
    return ok();
  }

  if (text === "/start" || text === "/help") {
    await send(chatId, "Text me anything and I save it to your brain.\n/recent shows your last 5 thoughts.\n/search word finds thoughts.");
    return ok();
  }
  if (text === "/recent") { await recent(chatId); return ok(); }
  if (text.startsWith("/search")) { await search(chatId, text.slice(7)); return ok(); }

  const metadata: Record<string, unknown> = { source: "telegram" };
  const url = text.match(/https?:\/\/\S+/);
  if (url) metadata.url = url[0];

  const { error } = await db.from("thoughts").insert({ content: "💬 Telegram: " + text, user_id: OWNER, metadata });
  await send(chatId, error ? "✗ Not saved: " + error.message : "✓ Saved to your brain");
  return ok();
});
