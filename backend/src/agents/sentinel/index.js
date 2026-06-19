/**
 * NEXUS — Sentinel Agent
 * Background monitor: fatigue detection, deep-work state, burnout guardrail.
 *
 * Directive compliance:
 *   Rule 1 (Deep Work Override) — manages silent mode
 *   Rule 3 (Empathetic Interruption) — constructive interventions only
 *   Rule 7 (Silence Timeout) — auto-lifts silent mode after configurable max
 */

const { buildMessage } = require("../../utils");

// ─── State ─────────────────────────────────────────────────────────────────────

const state = {
  deepWorkActive: false,
  deepWorkStartedAt: null,
  fatigueFlagCount: 0,
  lastFatigueFlag: null,
  focusHoursToday: 0,
  // Rule 7: 3 hours default max for deep work silence
  deepWorkMaxMs: (process.env.DEEP_WORK_MAX_HOURS || 3) * 60 * 60 * 1000,
};

// ─── Deep Work ─────────────────────────────────────────────────────────────────

const handleDeepWorkEnter = (payload, traceId) => {
  state.deepWorkActive = true;
  state.deepWorkStartedAt = Date.now();
  console.log(`[SENTINEL] 🎯 Deep work mode ON. Notifications suppressed.`);

  // Rule 7: schedule auto-lift
  setTimeout(() => {
    if (state.deepWorkActive) {
      state.deepWorkActive = false;
      console.log(
        `[SENTINEL] ⏰ Rule 7: Deep work silence auto-lifted after ${
          process.env.DEEP_WORK_MAX_HOURS || 3
        }h. Confirming with user.`
      );
    }
  }, state.deepWorkMaxMs);

  return buildMessage({
    source: "sentinel-agent",
    target: "core-router",
    intent: "deepwork.active",
    payload: { active: true, startedAt: new Date().toISOString() },
    requiresConfirmation: false,
    confidence: 1.0,
    traceId,
  });
};

const handleDeepWorkExit = (payload, traceId) => {
  const durationMs = state.deepWorkStartedAt
    ? Date.now() - state.deepWorkStartedAt
    : 0;
  const durationHours = durationMs / 3600000;

  state.deepWorkActive = false;
  state.deepWorkStartedAt = null;
  state.focusHoursToday += durationHours;

  console.log(
    `[SENTINEL] 🟢 Deep work mode OFF. Session: ${durationHours.toFixed(2)}h. Today total: ${state.focusHoursToday.toFixed(2)}h`
  );

  return buildMessage({
    source: "sentinel-agent",
    target: "core-router",
    intent: "deepwork.exited",
    payload: {
      sessionHours: durationHours.toFixed(2),
      totalFocusHoursToday: state.focusHoursToday.toFixed(2),
    },
    requiresConfirmation: false,
    confidence: 1.0,
    traceId,
  });
};

// ─── Fatigue Detection ─────────────────────────────────────────────────────────

const FATIGUE_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes base
const BURNOUT_THRESHOLD_HOURS = 6;

const handleFatigueFlag = (payload, traceId) => {
  const { confidence = 0.7, signals = [] } = payload;

  const now = Date.now();
  const timeSinceLast = state.lastFatigueFlag
    ? now - state.lastFatigueFlag
    : Infinity;

  // Exponential back-off for repeated low-confidence flags (AGENTS.md §5)
  const backoffMs = FATIGUE_COOLDOWN_MS * Math.pow(2, state.fatigueFlagCount);
  if (timeSinceLast < backoffMs) {
    console.log(
      `[SENTINEL] 🔁 Fatigue flag skipped (back-off: ${Math.round(backoffMs / 60000)}m remaining)`
    );
    return buildMessage({
      source: "sentinel-agent",
      target: "core-router",
      intent: "fatigue.suppressed",
      payload: { reason: "backoff", backoffMs },
      requiresConfirmation: false,
      confidence: 1.0,
      traceId,
    });
  }

  state.fatigueFlagCount += 1;
  state.lastFatigueFlag = now;

  // Burnout guardrail — 6+ hours continuous focus
  const burnoutRisk = state.focusHoursToday >= BURNOUT_THRESHOLD_HOURS;

  // Rule 3: Constructive intervention
  const interventions = [
    "Quick 5-min stretch — step away from the screen.",
    "Let's solve a 2-minute logic puzzle to reset your brain.",
    "Hydrate. Seriously. Then come back.",
    "Close your eyes for 60 seconds, then we continue.",
  ];
  const suggestion =
    interventions[Math.floor(Math.random() * interventions.length)];

  console.log(
    `[SENTINEL] 😮 Fatigue detected (flag #${state.fatigueFlagCount}). Burnout risk: ${burnoutRisk}. Intervening.`
  );

  return buildMessage({
    source: "sentinel-agent",
    target: "core-router",
    intent: "fatigue.intervention",
    payload: {
      flagCount: state.fatigueFlagCount,
      signals,
      burnoutRisk,
      suggestion,
      // Rule 3 compliant: never just "stop working"
      companionMessage: burnoutRisk
        ? `You've been at this for ${state.focusHoursToday.toFixed(1)} hours today. ${suggestion}`
        : `Looks like you need a reset. ${suggestion}`,
    },
    requiresConfirmation: false,
    confidence,
    traceId,
  });
};

// ─── Status ────────────────────────────────────────────────────────────────────

const handleStatusCheck = (payload, traceId) => {
  return buildMessage({
    source: "sentinel-agent",
    target: "core-router",
    intent: "sentinel.status",
    payload: {
      deepWorkActive: state.deepWorkActive,
      focusHoursToday: state.focusHoursToday.toFixed(2),
      fatigueFlagCount: state.fatigueFlagCount,
      burnoutRisk: state.focusHoursToday >= BURNOUT_THRESHOLD_HOURS,
    },
    requiresConfirmation: false,
    confidence: 1.0,
    traceId,
  });
};

// ─── Main dispatcher ──────────────────────────────────────────────────────────

const handleSentinelIntent = (intent, payload, traceId) => {
  switch (intent) {
    case "deepwork.enter":
      return handleDeepWorkEnter(payload, traceId);
    case "deepwork.exit":
      return handleDeepWorkExit(payload, traceId);
    case "fatigue.flag":
      return handleFatigueFlag(payload, traceId);
    case "sentinel.status":
      return handleStatusCheck(payload, traceId);
    default:
      return buildMessage({
        source: "sentinel-agent",
        target: "core-router",
        intent: "sentinel.unknown",
        payload: { error: `Unknown sentinel intent: ${intent}` },
        confidence: 0,
        traceId,
      });
  }
};

module.exports = { handleSentinelIntent, getSentinelState: () => ({ ...state }) };