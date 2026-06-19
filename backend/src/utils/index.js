/**
 * NEXUS — Shared Utilities
 * Message contract builder + trace logger + confidence gate.
 */

const { v4: uuidv4 } = require("uuid");
const { logAction } = require("../memory");

// ─── Agent Message Contract ───────────────────────────────────────────────────
// Every inter-agent message MUST go through this builder.
// Schema matches AGENTS.md §4.

const buildMessage = ({
  source,
  target,
  intent,
  payload = {},
  requiresConfirmation = false,
  confidence = 1.0,
  traceId = null,
}) => {
  const msg = {
    messageId: uuidv4(),
    timestamp: new Date().toISOString(),
    source,
    target,
    intent,
    payload,
    // Directive: confidence < 0.6 forces confirmation regardless of agent setting
    requiresConfirmation: confidence < 0.6 ? true : requiresConfirmation,
    confidence,
    traceId: traceId || uuidv4(),
  };
  return msg;
};

// ─── Trace Logger ─────────────────────────────────────────────────────────────

const traceLog = async (msg, unlogged = false) => {
  const tag = unlogged ? "⚠️ UNLOGGED" : "📝";
  console.log(
    `[TRACE ${tag}] ${msg.source} → ${msg.target} | intent: ${msg.intent} | trace: ${msg.traceId}`
  );
  await logAction(msg.traceId, msg.source, msg.intent, msg.payload, unlogged);
};

// ─── Error response ───────────────────────────────────────────────────────────

const buildError = (source, intent, error, traceId) =>
  buildMessage({
    source,
    target: "core-router",
    intent: `${intent}.error`,
    payload: { error: error.message || String(error) },
    requiresConfirmation: false,
    confidence: 0,
    traceId,
  });

module.exports = { buildMessage, traceLog, buildError };