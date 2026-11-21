import express from "express";
import crypto from "crypto";

const {
  VERIFY_TOKEN,
  APP_SECRET,
  IG_ACCESS_TOKEN,
  GEMINI_API_KEY,
  MODEL = "gemini-3.5-flash-lite",
  GRAPH_VERSION = "v21.0",
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  PORT = 3000,
} = process.env;

for (const [k, v] of Object.entries({ VERIFY_TOKEN, APP_SECRET, IG_ACCESS_TOKEN, GEMINI_API_KEY })) {
  if (!v) console.warn(`⚠️  Missing env var: ${k}`);
}

// ---------- Agent instructions ----------
const SYSTEM_PROMPT = `You are the assistant for Shakeeb, a freelance web developer. You reply to business owners on Instagram DMs after they respond to his first message.

GOAL: Understand their business, show value, and collect details so Shakeeb can close the deal on WhatsApp.

STYLE: Friendly, professional, short (2-3 lines max), 1-2 emojis. Focus on growth, customers, and sales. Never write long paragraphs.

PORTFOLIO: https://portfolio-1-c90q.onrender.com (share it once, early)

FLOW:
1. Thank them for replying. Ask if they already have a website.
2. Ask what matters most: more customers, online orders, or showing their menu/services.
3. Ask their timeline and rough budget.
4. Ask for their WhatsApp number so Shakeeb can send 3 package options and call.

RULES:
- Ask only ONE question per message.
- Never quote a final price or promise results. Say "Shakeeb will share packages on WhatsApp."
- If they say no or "not interested", reply politely once and stop.
- If they ask something you don't know, say Shakeeb will answer on WhatsApp.
- Reply in the language they write in.

WHEN LEAD IS READY (they gave WhatsApp number or budget + timeline), output:
LEAD: business name | need | timeline | budget | WhatsApp

SYSTEM FORMAT RULES (the server reads these):
- Always write your normal reply to the owner first. Then, only when the lead is ready, add the LEAD line on a new line at the very end.
- If the owner is not interested, write your polite reply and add [STOP] on a new line at the very end.
- Never mention LEAD or [STOP] in the reply text itself.`;

// ---------- In-memory state (resets when the server restarts) ----------
const chats = new Map(); // senderId -> { messages: [], done: false }
const seen = new Set();  // processed message ids, to avoid duplicates

function getChat(id) {
  if (!chats.has(id)) chats.set(id, { messages: [], done: false });
  return chats.get(id);
}

// ---------- Helpers ----------
async function askAI(messages) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": GEMINI_API_KEY,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: messages.map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        })),
        generationConfig: { maxOutputTokens: 800, temperature: 0.7 },
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  return parts.filter((p) => p.text && !p.thought).map((p) => p.text).join("\n");
}

async function sendInstagram(recipientId, text) {
  const res = await fetch(`https://graph.instagram.com/${GRAPH_VERSION}/me/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${IG_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({ recipient: { id: recipientId }, message: { text } }),
  });
  if (!res.ok) console.error("Instagram send failed:", res.status, await res.text());
}

async function notifyShakeeb(text) {
  console.log("🔔", text);
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text }),
    });
  } catch (e) {
    console.error("Telegram alert failed:", e.message);
  }
}

function validSignature(req) {
  const header = req.get("x-hub-signature-256");
  if (!header || !req.rawBody) return false;
  const expected =
    "sha256=" + crypto.createHmac("sha256", APP_SECRET).update(req.rawBody).digest("hex");
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- Core logic ----------
async function handleMessage(senderId, text) {
  const chat = getChat(senderId);
  if (chat.done) return; // already handed off or not interested: stay quiet

  // The AI needs alternating roles, so merge if the last message is also from the user
  const last = chat.messages[chat.messages.length - 1];
  if (last && last.role === "user") last.content += "\n" + text;
  else chat.messages.push({ role: "user", content: text });
  chat.messages = chat.messages.slice(-20);
  if (chat.messages[0].role !== "user") chat.messages.shift();

  const raw = await askAI(chat.messages);

  const leadMatch = raw.match(/^LEAD:.*$/m);
  const stopped = /\[STOP\]/.test(raw);
  const reply = raw.replace(/^LEAD:.*$/m, "").replace(/\[STOP\]/g, "").trim();

  if (reply) {
    chat.messages.push({ role: "assistant", content: reply });
    await sendInstagram(senderId, reply);
  }

  if (leadMatch) {
    chat.done = true;
    await notifyShakeeb(
      `🔥 New hot lead from Instagram\n${leadMatch[0]}\nInstagram user ID: ${senderId}\nOpen your Instagram inbox and continue on WhatsApp.`
    );
  } else if (stopped) {
    chat.done = true;
  }
}

// ---------- Server ----------
const app = express();
app.use(express.json({ verify: (req, _res, buf) => (req.rawBody = buf) }));

app.get("/", (_req, res) => res.send("Instagram DM agent is running ✅"));

// Meta calls this once to verify your webhook
app.get("/webhook", (req, res) => {
  if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === VERIFY_TOKEN) {
    return res.status(200).send(req.query["hub.challenge"]);
  }
  res.sendStatus(403);
});

// Meta sends every new DM here
app.post("/webhook", (req, res) => {
  if (!validSignature(req)) return res.sendStatus(401);
  res.sendStatus(200); // reply fast, process after

  const body = req.body;
  if (body.object !== "instagram") return;

  for (const entry of body.entry || []) {
    for (const ev of entry.messaging || []) {
      const msg = ev.message;
      if (!msg || msg.is_echo || !msg.text) continue; // skip your own messages, images, etc.
      if (msg.mid && seen.has(msg.mid)) continue;
      if (msg.mid) seen.add(msg.mid);
      if (seen.size > 5000) seen.clear();

      handleMessage(ev.sender.id, msg.text).catch((e) => console.error("Handler error:", e.message));
    }
  }
});

app.listen(PORT, () => console.log(`Listening on port ${PORT}`));
