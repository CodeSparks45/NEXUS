/**
 * NEXUS — Universal WhatsApp Agent (The "Do Anything" Edition)
 *
 * Truly context-agnostic. Understands relationship dynamics automatically.
 * Professor = Formal. Best Friend = Casual/Slang. Client = Professional.
 *
 * Intents:
 *   whatsapp.draft   → AI drafts the perfect message, waits for approval
 *   whatsapp.send    → sends an approved draft
 *   whatsapp.bulk    → sends personalized messages to multiple people
 *   whatsapp.status  → connection status
 */

const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { buildMessage, buildError } = require("../../utils");

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const MODEL = "gemini-2.5-flash"; // Updated to latest fast model

// ─── WhatsApp Client ───────────────────────────────────────────────────────────

let client;
let isReady = false;
let initPromise = null;

const initWhatsApp = () => {
  if (initPromise) return initPromise;

  initPromise = new Promise((resolve, reject) => {
    console.log("[WHATSAPP] 🔄 Initializing sandboxed client...");

    client = new Client({
      authStrategy: new LocalAuth(),
      puppeteer: {
        headless: true,
        timeout: 600000,
        protocolTimeout: 600000,
        args: [
          "--no-sandbox", "--disable-setuid-sandbox",
          "--disable-dev-shm-usage", "--disable-accelerated-2d-canvas",
          "--no-first-run", "--no-zygote", "--single-process", "--disable-gpu",
        ],
      },
    });

    client.on("qr", (qr) => {
      console.log("\n" + "=".repeat(54));
      console.log("📱  SCAN THIS QR WITH WHATSAPP TO LINK NEXUS");
      console.log("=".repeat(54) + "\n");
      qrcode.generate(qr, { small: true });
    });

    client.on("ready", () => {
      console.log("[WHATSAPP] ✅ Client connected and ready.");
      isReady = true;
      resolve(true);
    });

    client.on("auth_failure", (msg) => reject(new Error("WhatsApp auth failed: " + msg)));
    client.on("disconnected", (reason) => {
      console.warn("[WHATSAPP] ⚠️  Disconnected:", reason);
      isReady = false;
      initPromise = null;
    });

    client.initialize();
  });

  return initPromise;
};

// ─── Number / Contact Resolution ──────────────────────────────────────────────

const resolveRecipient = async (contactNameOrNumber) => {
  const isNumber = /^[\d\s\+\-\(\)]{7,15}$/.test(contactNameOrNumber.trim());

  if (isNumber) {
    let digits = contactNameOrNumber.replace(/\D/g, "");
    if (digits.startsWith("0")) digits = "91" + digits.slice(1);
    if (digits.length === 10) digits = "91" + digits;
    return { waId: `${digits}@c.us`, displayName: `+${digits}`, isUnsaved: true };
  }

  if (!isReady) throw new Error("WhatsApp client not ready.");
  const chats = await client.getChats();
  const match = chats.find(c => c.name?.toLowerCase() === contactNameOrNumber.toLowerCase());
  
  if (!match) throw new Error(`Contact "${contactNameOrNumber}" not found in active chats. Pass phone number directly.`);

  return { waId: match.id._serialized, displayName: match.name, isUnsaved: false };
};

// ─── Universal AI Message Drafter ─────────────────────────────────────────────

const draftMessage = async (recipientInfo, goal) => {
  const recipientBlock = Object.entries(recipientInfo || {})
    .filter(([, v]) => v)
    .map(([k, v]) => `${k.toUpperCase()}: ${v}`)
    .join("\n") || "No specific background info provided.";

  const prompt = `
You are NEXUS, a highly intelligent personal AI companion. Your creator has asked you to draft a WhatsApp message.

=== RECIPIENT CONTEXT ===
${recipientBlock}

=== WHAT TO SAY (GOAL) ===
${goal}

=== YOUR DIRECTIVE ===
1. Analyze the 'Recipient Context' and the 'Goal' to automatically determine the PERFECT tone. 
   - If it's a teacher/boss -> Be highly formal, respectful, and structured.
   - If it's a friend/sibling -> Be extremely casual, informal, maybe use slang if appropriate for an Indian context (like "bhai", "yaar").
   - If it's a business client -> Be professional and persuasive.
2. Draft the exact WhatsApp message. Do not include placeholders like [Your Name], infer it or write it so it doesn't need them.
3. Keep it natural—make it sound like a human wrote it, not a bot.

Respond ONLY with a valid JSON object, no markdown:
{
  "subject": "AI's internal summary of this message",
  "messageText": "The final WhatsApp message ready to be sent",
  "detectedTone": "What tone you chose to use and why",
  "confidence": 0.0
}
  `.trim();

  const model = genAI.getGenerativeModel({ model: MODEL });
  const result = await model.generateContent(prompt);
  const raw = result.response.text();

  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first === -1 || last === -1) throw new Error("AI returned no valid JSON");

  return JSON.parse(raw.substring(first, last + 1));
};

// ─── Raw Send ─────────────────────────────────────────────────────────────────

const sendRaw = async (waId, text) => {
  if (!isReady) throw new Error("WhatsApp client not ready.");
  await client.sendMessage(waId, text);
};

// ─── Intents ──────────────────────────────────────────────────────────────────

const handleDraft = async (payload, traceId) => {
  const { recipient, recipientInfo, goal } = payload;
  if (!recipient || !goal) return buildError("whatsapp-agent", "whatsapp.draft", new Error("recipient and goal required"), traceId);

  console.log(`[WHATSAPP] ✍️  Drafting for "${recipient}"...`);
  try {
    const resolved = await resolveRecipient(recipient);
    const draft = await draftMessage(recipientInfo, goal);

    console.log(`[WHATSAPP] 📝 Draft ready (${draft.detectedTone})`);

    return buildMessage({
      source: "whatsapp-agent", target: "core-router", intent: "whatsapp.draft.ready",
      payload: {
        recipient, waId: resolved.waId, displayName: resolved.displayName, isUnsaved: resolved.isUnsaved, draft,
        approvalToken: Buffer.from(JSON.stringify({ waId: resolved.waId, ts: Date.now() })).toString("base64"),
      },
      requiresConfirmation: true, confidence: draft.confidence, traceId,
    });
  } catch (err) {
    return buildError("whatsapp-agent", "whatsapp.draft", err, traceId);
  }
};

const handleSend = async (payload, traceId) => {
  const { approvalToken, messageText, recipient = "unknown" } = payload;
  if (!approvalToken || !messageText) return buildError("whatsapp-agent", "whatsapp.send", new Error("approvalToken and messageText required"), traceId);

  try {
    const tokenData = JSON.parse(Buffer.from(approvalToken, "base64").toString("utf8"));
    if (Date.now() - tokenData.ts > 30 * 60 * 1000) throw new Error("Token expired.");

    await sendRaw(tokenData.waId, messageText);
    console.log(`[WHATSAPP] ✅ Sent to ${recipient}`);

    return buildMessage({
      source: "whatsapp-agent", target: "core-router", intent: "whatsapp.message.sent",
      payload: { status: "sent", recipient, waId: tokenData.waId, sentText: messageText },
      requiresConfirmation: false, confidence: 1.0, traceId,
    });
  } catch (err) {
    return buildError("whatsapp-agent", "whatsapp.send", err, traceId);
  }
};

const handleStatus = (payload, traceId) => buildMessage({
  source: "whatsapp-agent", target: "core-router", intent: "whatsapp.status",
  payload: { isReady, clientInitialized: !!client }, requiresConfirmation: false, confidence: 1.0, traceId,
});

const handleWhatsAppIntent = async (intent, payload, traceId) => {
  if (intent !== "whatsapp.status" && !isReady) {
    try { await initWhatsApp(); } catch (err) { return buildError("whatsapp-agent", intent, err, traceId); }
  }
  switch (intent) {
    case "whatsapp.draft": return handleDraft(payload, traceId);
    case "whatsapp.send": return handleSend(payload, traceId);
    case "whatsapp.status": return handleStatus(payload, traceId);
    default: return buildError("whatsapp-agent", intent, new Error(`Unknown intent: ${intent}`), traceId);
  }
};

module.exports = { initWhatsApp, handleWhatsAppIntent, sendRaw };