/**
 * NEXUS — Core Router ("The Brain")
 * Single dispatch point. No agent calls another agent directly.
 * Every decision is logged with a traceId for full replay.
 *
 * AGENTS.md Execution Loop:
 * Input → Router classifies intent → dispatches to agent
 * → Memory Agent logs outcome → Feedback to user
 */
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");

const { initDB, purgeAll, approveContact } = require("../memory");
const { traceLog } = require("../utils");
const { handleScheduleIntent } = require("../agents/scheduling");
const { handleCommunicationIntent } = require("../agents/communication");
const { handleSentinelIntent, getSentinelState } = require("../agents/sentinel");
// 👇 Yahan correctly WhatsApp Agent ko uski dedicated file se import kiya hai
const { handleWhatsAppIntent, initWhatsApp } = require("../agents/communication/whatsapp");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ─── Intent → Agent Routing Table ─────────────────────────────────────────────

const INTENT_MAP = {
  // Scheduling Agent
  "schedule.update": "scheduling-agent",
  "schedule.view":   "scheduling-agent",
  "schedule.clear":  "scheduling-agent",

  // Communication Agent
  "message.draft":   "communication-agent",
  "message.send":    "communication-agent",
  "contact.approve": "communication-agent",

  // Sentinel Agent
  "deepwork.enter":  "sentinel-agent",
  "deepwork.exit":   "sentinel-agent",
  "fatigue.flag":    "sentinel-agent",
  "sentinel.status": "sentinel-agent",

  // 🚀 Universal WhatsApp Agent (Ye add kiya)
  "whatsapp.draft":  "whatsapp-agent",
  "whatsapp.send":   "whatsapp-agent",
  "whatsapp.bulk":   "whatsapp-agent",
  "whatsapp.status": "whatsapp-agent",
};

// ─── Dispatcher ────────────────────────────────────────────────────────────────

const dispatchToAgent = async (intent, payload, traceId) => {
  const agentName = INTENT_MAP[intent];

  if (!agentName) {
    console.log(`[ROUTER] ⚠️  Unknown intent: "${intent}"`);
    return {
      messageId: uuidv4(),
      timestamp: new Date().toISOString(),
      source: "core-router",
      target: "client",
      intent: "error.unknown_intent",
      payload: { error: `Intent "${intent}" is not recognized.`, knownIntents: Object.keys(INTENT_MAP) },
      requiresConfirmation: false,
      confidence: 0,
      traceId,
    };
  }

  console.log(`[ROUTER] ➡️  Dispatching "${intent}" → ${agentName}`);

  switch (agentName) {
    case "scheduling-agent":
      return handleScheduleIntent(intent, payload, traceId);
    case "communication-agent":
      return handleCommunicationIntent(intent, payload, traceId);
    case "sentinel-agent":
      return handleSentinelIntent(intent, payload, traceId);
    case "whatsapp-agent": // 👇 Dispatching to WhatsApp Agent
      return handleWhatsAppIntent(intent, payload, traceId);
  }
};

// ─── Main Input Endpoint ───────────────────────────────────────────────────────

/**
 * POST /api/nexus/input
 * Body: { source, intent, payload }
 */
app.post("/api/nexus/input", async (req, res) => {
  const { source = "unknown", intent, payload = {} } = req.body;

  if (!intent) {
    return res.status(400).json({ error: "intent is required." });
  }

  const traceId = uuidv4();
  console.log(`\n[NEXUS INPUT] source: ${source} | intent: ${intent} | trace: ${traceId}`);

  try {
    const response = await dispatchToAgent(intent, payload, traceId);
    await traceLog(response);
    return res.json(response);
  } catch (err) {
    console.error(`[ROUTER] ❌ Unhandled error:`, err.message);
    return res.status(500).json({ error: err.message, traceId });
  }
});

// ─── Schedule Endpoints ────────────────────────────────────────────────────────

app.get("/api/nexus/schedule", async (req, res) => {
  const traceId = uuidv4();
  const response = await dispatchToAgent("schedule.view", {}, traceId);
  res.json(response);
});

// ─── Contact Approval Endpoint ─────────────────────────────────────────────────

/**
 * POST /api/nexus/contacts/approve
 * Body: { contact: "GSoC Mentor", channel: "whatsapp" }
 */
app.post("/api/nexus/contacts/approve", async (req, res) => {
  const { contact, channel = "whatsapp" } = req.body;
  if (!contact) return res.status(400).json({ error: "contact is required." });

  const traceId = uuidv4();
  const response = await dispatchToAgent("contact.approve", { contact, channel }, traceId);
  res.json(response);
});

// ─── Sentinel Status Endpoint ─────────────────────────────────────────────────

app.get("/api/nexus/sentinel/status", async (req, res) => {
  const traceId = uuidv4();
  const response = await dispatchToAgent("sentinel.status", {}, traceId);
  res.json(response);
});

// ─── Memory Purge Endpoint (User-triggered "Clear Memory") ────────────────────

app.delete("/api/nexus/memory", async (req, res) => {
  await purgeAll();
  res.json({ status: "success", message: "All local memory purged." });
});

// ─── Health Check ──────────────────────────────────────────────────────────────

app.get("/api/nexus/health", (req, res) => {
  res.json({
    status: "online",
    version: "1.0.0-beta",
    timestamp: new Date().toISOString(),
    sentinel: getSentinelState(),
    knownIntents: Object.keys(INTENT_MAP),
  });
});

// ─── 404 Catch-all ────────────────────────────────────────────────────────────

app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found.` });
});

// ─── Boot Sequence ─────────────────────────────────────────────────────────────

const bootNexus = async () => {
  await initDB();
  initWhatsApp(); // 🟢 WhatsApp sandbox initialized here
  
  app.listen(PORT, () => {
    console.log(`
  ╔══════════════════════════════════════════╗
  ║      🧠  NEXUS CORE ROUTER  ONLINE       ║
  ║      http://localhost:${PORT}               ║
  ╠══════════════════════════════════════════╣
  ║  POST  /api/nexus/input                  ║
  ║  GET   /api/nexus/schedule               ║
  ║  GET   /api/nexus/sentinel/status        ║
  ║  POST  /api/nexus/contacts/approve       ║
  ║  DELETE /api/nexus/memory                ║
  ║  GET   /api/nexus/health                 ║
  ╚══════════════════════════════════════════╝
    `);
  });
};

bootNexus();