// capture: save a thought to Sage's Open Brain from Siri, the iPhone Share button, or any
// trusted tool. Protected by a private passcode (BRAIN_CAPTURE_KEY) sent in the
// x-brain-key header. Saves as Sage (OWNER_USER_ID) using the server-only service role key,
// which never leaves Supabase.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CAPTURE_KEY = Deno.env.get("BRAIN_CAPTURE_KEY") ?? "";
const OWNER = Deno.env.get("OWNER_USER_ID") ?? "";

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Compare passcodes without leaking timing information.
function sameKey(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return reply(405, { ok: false, error: "Use POST" });
  if (!CAPTURE_KEY || !OWNER) return reply(500, { ok: false, error: "Server not configured" });
  if (!sameKey(req.headers.get("x-brain-key") ?? "", CAPTURE_KEY)) {
    return reply(401, { ok: false, error: "Wrong passcode" });
  }

  let body: { text?: string; source?: string } = {};
  try {
    body = await req.json();
  } catch {
    return reply(400, { ok: false, error: "Send JSON like {\"text\": \"...\"}" });
  }

  const text = String(body.text ?? "").trim();
  if (!text) return reply(400, { ok: false, error: "Nothing to save" });
  if (text.length > 200000) return reply(413, { ok: false, error: "Too long" });

  const source = ["siri", "share", "shortcut"].includes(String(body.source)) ? String(body.source) : "shortcut";
  const urlMatch = text.match(/https?:\/\/\S+/);
  const label = source === "siri" ? "🗣️ Siri: " : source === "share" ? "📤 Shared: " : "";
  const metadata: Record<string, unknown> = { source };
  if (urlMatch) metadata.url = urlMatch[0];

  const { data, error } = await db
    .from("thoughts")
    .insert({ content: label + text, user_id: OWNER, metadata })
    .select("id")
    .single();

  if (error) return reply(500, { ok: false, error: error.message });
  return reply(200, { ok: true, id: data.id, message: "Saved to your brain" });
});
