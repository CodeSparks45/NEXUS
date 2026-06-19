/**
 * NEXUS — Communication Agent
 * Drafts and executes outbound messages (WhatsApp / extensible to Slack, Email).
 *
 * Directive compliance:
 *   Rule 5 (Reversibility Bias)  — always drafts first, requiresConfirmation: true
 *   Rule 6 (Escalation Ceiling)  — never messages a first-time contact without approval
 *   Rule 4 (Autonomy Transparency) — post-action report logged
 */

const { GoogleGenerativeAI } = require("@google/generative-ai");
const { isContactApproved, approveContact } = require("../../memory");
const { buildMessage, buildError } = require("../../utils");
// NAYA IMPORT: WhatsApp module
const { initWhatsApp, sendWhatsAppMessage } = require("./whatsapp");

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const MODEL = "gemini-2.5-pro";

// ─── Draft a reply ─────────────────────────────────────────────────────────────

const handleMessageDraft = async (payload, traceId) => {
  const { contact, channel = "whatsapp", incomingMessage, currentTask } = payload;

  if (!contact || !incomingMessage) {
    return buildError(
      "communication-agent",
      "message.draft",
      new Error("contact and incomingMessage are required"),
      traceId
    );
  }

  // Rule 6: First-contact check
  const approved = await isContactApproved(contact, channel);
  if (!approved) {
    console.log(
      `[COMMUNICATION AGENT] 🔒 Contact "${contact}" not in allow-list. Requesting approval.`
    );
    return buildMessage({
      source: "communication-agent",
      target: "core-router",
      intent: "message.approval_required",
      payload: {
        contact,
        channel,
        reason: "first_contact",
        incomingMessage,
        action: `POST /api/nexus/contacts/approve with { contact, channel } to authorize.`,
      },
      requiresConfirmation: true,
      confidence: 1.0,
      traceId,
    });
  }

  const now = new Date().toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  });

  const prompt = `
You are NEXUS drafting a professional reply on behalf of a developer.
Current time: ${now}
Contact: ${contact} (via ${channel})
Their message: "${incomingMessage}"
User is currently doing: "${currentTask || "deep work"}"

Write a short, professional, friendly reply:
- Acknowledge their message.
- Give a realistic ETA based on what the user is doing.
- Don't promise anything the user can't deliver.
- Max 3 sentences.
- Tone: professional but warm (not corporate robotic).

Respond ONLY with a JSON object:
{
  "draftText": "string",
  "suggestedETA": "string",
  "confidence": 0.0
}
  `.trim();

  try {
    const model = genAI.getGenerativeModel({ model: MODEL });
    const result = await model.generateContent(prompt);
    const raw = result.response.text();

    const first = raw.indexOf("{");
    const last = raw.lastIndexOf("}");
    if (first === -1 || last === -1) throw new Error("No JSON in AI response");

    const aiData = JSON.parse(raw.substring(first, last + 1));

    console.log(
      `[COMMUNICATION AGENT] 📝 Draft ready for ${contact}: "${aiData.draftText}"`
    );

    // Rule 5: Always requires confirmation before send
    return buildMessage({
      source: "communication-agent",
      target: "core-router",
      intent: "message.draft.ready",
      payload: {
        contact,
        channel,
        draftText: aiData.draftText,
        suggestedETA: aiData.suggestedETA,
        incomingMessage,
      },
      requiresConfirmation: true, // Rule 5 — Reversibility Bias
      confidence: aiData.confidence || 0.88,
      traceId,
    });
  } catch (err) {
    console.error(`[COMMUNICATION AGENT] ❌ Draft error:`, err.message);
    return buildError("communication-agent", "message.draft", err, traceId);
  }
};

// ─── Confirm send (user approved the draft) ────────────────────────────────────

const handleMessageSend = async (payload, traceId) => {
  const { contact, channel = "whatsapp", draftText } = payload;

  if (!contact || !draftText) {
    return buildError(
      "communication-agent",
      "message.send",
      new Error("contact and draftText are required"),
      traceId
    );
  }

  try {
    if (channel === "whatsapp") {
      // 🔌 THE REAL DEAL: Sending via whatsapp-web.js
      console.log(`[COMMUNICATION AGENT] 📤 Sending to ${contact} via WhatsApp...`);
      await sendWhatsAppMessage(contact, draftText);
    } else {
      // Fallback for other channels if added later
      console.log(`[COMMUNICATION AGENT] 📤 [STUB] Sent to ${contact} via ${channel}: "${draftText}"`);
    }

    // Rule 4: Autonomous Transparency — always report what was done
    console.log(
      `[COMMUNICATION AGENT] 📋 Post-action report: Sent reply to ${contact}.`
    );

    return buildMessage({
      source: "communication-agent",
      target: "core-router",
      intent: "message.sent",
      payload: {
        status: "sent",
        contact,
        channel,
        sentText: draftText,
        reportSummary: `Sent reply to ${contact} via ${channel}.`,
      },
      requiresConfirmation: false,
      confidence: 1.0,
      traceId,
    });

  } catch (error) {
    console.error(`[COMMUNICATION AGENT] ❌ Failed to send message:`, error.message);
    return buildError("communication-agent", "message.send", error, traceId);
  }
};

// ─── Approve a new contact ────────────────────────────────────────────────────

const handleContactApprove = async (payload, traceId) => {
  const { contact, channel = "whatsapp" } = payload;
  await approveContact(contact, channel);

  return buildMessage({
    source: "communication-agent",
    target: "core-router",
    intent: "contact.approved",
    payload: { contact, channel },
    requiresConfirmation: false,
    confidence: 1.0,
    traceId,
  });
};

// ─── Main dispatcher ──────────────────────────────────────────────────────────

const handleCommunicationIntent = async (intent, payload, traceId) => {
  switch (intent) {
    case "message.draft":
      return handleMessageDraft(payload, traceId);
    case "message.send":
      return handleMessageSend(payload, traceId);
    case "contact.approve":
      return handleContactApprove(payload, traceId);
    default:
      return buildError(
        "communication-agent",
        intent,
        new Error(`Unknown communication intent: ${intent}`),
        traceId
      );
  }
};

// EXPORT UPDATE: Added initWhatsApp so Router can boot it
module.exports = { handleCommunicationIntent, initWhatsApp };