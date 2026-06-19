/**
 * NEXUS — Scheduling Agent
 * Manages dynamic time blocks. Re-balances if user is interrupted.
 * Uses Gemini 2.0 Flash (stable v1beta endpoint).
 */

const { GoogleGenerativeAI } = require("@google/generative-ai");
const { logTaskToMemory, getSchedule } = require("../../memory");
const { buildMessage, buildError } = require("../../utils");

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

// ─── Model — use gemini-2.0-flash (stable & fast) ────────────────────────────
const MODEL = "gemini-2.5-pro";

// ─── Intent Handlers ──────────────────────────────────────────────────────────

const handleScheduleUpdate = async (payload, traceId) => {
  console.log(`[SCHEDULING AGENT] 🧠 Analyzing: "${payload.task}"`);

  // Pull today's existing schedule for context
  const existingSchedule = await getSchedule();
  const scheduleContext =
    existingSchedule.length > 0
      ? existingSchedule
          .map((s) => `• ${s.task_name} (${s.duration}) — ${s.status}`)
          .join("\n")
      : "No tasks scheduled yet today.";

  const now = new Date();
  const timeString = now.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  });

  const prompt = `
You are NEXUS, an advanced sentient developer companion built for engineers.
Current IST time: ${timeString}

User's existing schedule today:
${scheduleContext}

The user just requested: "${payload.task}"

Act like a real companion who knows the user is a developer balancing DSA, open-source, academics, and real life.
1. Understand the task type (deep work / study / admin / break).
2. Create a realistic, focused time block.
3. Design a break strategy (Pomodoro, or custom).
4. Give a short, natural voice response — 1-2 sentences, casual but smart, like a colleague who knows your workflow.
5. If there's a scheduling conflict with existing tasks, flag it in the response.

Respond ONLY with a valid JSON object, no markdown, no preamble:
{
  "optimizedTask": "string",
  "duration": "string",
  "breakStrategy": "string",
  "startSuggestion": "string (e.g. 'Start at 3:00 PM')",
  "conflictNote": "string or null",
  "companionResponse": "string"
}
  `.trim();

  try {
    const model = genAI.getGenerativeModel({ model: MODEL });
    const result = await model.generateContent(prompt);
    const raw = result.response.text();

    // Bulletproof JSON extraction
    const first = raw.indexOf("{");
    const last = raw.lastIndexOf("}");
    if (first === -1 || last === -1) throw new Error("No JSON in AI response");

    const aiData = JSON.parse(raw.substring(first, last + 1));

    console.log(`[SCHEDULING AGENT] 🎯 NEXUS: "${aiData.companionResponse}"`);
    if (aiData.conflictNote) {
      console.log(`[SCHEDULING AGENT] ⚠️  Conflict: ${aiData.conflictNote}`);
    }

    const memoryId = await logTaskToMemory(
      aiData.optimizedTask,
      aiData.duration,
      aiData.breakStrategy
    );

    return buildMessage({
      source: "scheduling-agent",
      target: "core-router",
      intent: "schedule.updated",
      payload: {
        status: "success",
        memoryId,
        schedule: aiData,
      },
      requiresConfirmation: false,
      confidence: 0.95,
      traceId,
    });
  } catch (err) {
    console.error(`[SCHEDULING AGENT] ❌ Error:`, err.message);

    // Fallback — static block so the user isn't left with nothing
    const fallbackTask = payload.task || "Focused work session";
    const memoryId = await logTaskToMemory(fallbackTask, "1 hour", "25 min work, 5 min break");

    return buildMessage({
      source: "scheduling-agent",
      target: "core-router",
      intent: "schedule.updated",
      payload: {
        status: "fallback",
        memoryId,
        schedule: {
          optimizedTask: fallbackTask,
          duration: "1 hour",
          breakStrategy: "25 min work, 5 min break (Pomodoro)",
          startSuggestion: "Start now",
          conflictNote: null,
          companionResponse:
            "AI is temporarily unavailable — scheduled a default 1-hour focus block for you.",
        },
        error: err.message,
      },
      requiresConfirmation: false,
      confidence: 0.5,
      traceId,
    });
  }
};

const handleScheduleView = async (payload, traceId) => {
  const schedule = await getSchedule();
  console.log(`[SCHEDULING AGENT] 📋 Fetched ${schedule.length} task(s) for today.`);

  return buildMessage({
    source: "scheduling-agent",
    target: "core-router",
    intent: "schedule.fetched",
    payload: { schedule },
    requiresConfirmation: false,
    confidence: 1.0,
    traceId,
  });
};

const handleScheduleClear = async (payload, traceId) => {
  const { clearSchedule } = require("../../memory");
  await clearSchedule();

  return buildMessage({
    source: "scheduling-agent",
    target: "core-router",
    intent: "schedule.cleared",
    payload: { status: "success" },
    requiresConfirmation: false,
    confidence: 1.0,
    traceId,
  });
};

// ─── Main dispatcher ──────────────────────────────────────────────────────────

const handleScheduleIntent = async (intent, payload, traceId) => {
  switch (intent) {
    case "schedule.update":
      return handleScheduleUpdate(payload, traceId);
    case "schedule.view":
      return handleScheduleView(payload, traceId);
    case "schedule.clear":
      return handleScheduleClear(payload, traceId);
    default:
      return buildError(
        "scheduling-agent",
        intent,
        new Error(`Unknown scheduling intent: ${intent}`),
        traceId
      );
  }
};

module.exports = { handleScheduleIntent };