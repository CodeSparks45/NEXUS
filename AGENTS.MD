# 🤖 Agentic Architecture & Governance

This document outlines the internal rules, information flow, data access protocols, communication contracts, and privacy standards governing the NEXUS ecosystem.

> **Versioning:** This document follows its own changelog. Any change to a Directive (Section 2) or the Message Contract (Section 4) requires a version bump and a one-line rationale in [Changelog](#-7-changelog).

**Current Directive Version:** `v1.2.0`

---

## 📑 Table of Contents
- [1. Information Flow & Architecture](#-1-information-flow--architecture)
- [2. Core Operational Rules (Directives)](#%EF%B8%8F-2-core-operational-rules-the-directives)
- [3. Data Access & Privacy Protocol](#-3-data-access--privacy-protocol)
- [4. Agent Communication Contract](#-4-agent-communication-contract)
- [5. Error Handling & Fallback Behavior](#-5-error-handling--fallback-behavior)
- [6. Consent & Permission Model](#-6-consent--permission-model)
- [7. Changelog](#-7-changelog)

---

## 🧬 1. Information Flow & Architecture

NEXUS operates on a Multi-Agent System (MAS) architecture to ensure modularity and speed.

### The Agent Hierarchy:
1.  **The Core Router (The "Brain"):** Listens to all inputs (Voice, Text, Vision, Time) and decides which sub-agent needs to execute a task. The Router never executes actions itself — it only classifies intent and dispatches.
2.  **Scheduling Agent:** Manages the dynamic timetable. Re-calculates focus blocks based on user availability and predefined goals (e.g., DSA prep, System Design).
3.  **Communication Agent:** Handles all external messaging. Parses incoming WhatsApp messages, drafts context-aware professional responses, and executes them via `whatsapp-web.js`.
4.  **Sentinel Agent (Environment Monitor):** Runs quietly in the background tracking system clock, scheduled events, and utilizing local computer vision to gauge user fatigue or frustration.
5.  **Memory Agent** *(new)*: Owns the local SQLite store. No other agent writes to disk directly — all persistence requests route through this agent so there's a single point of audit for what's stored.

### The Execution Loop:
`[Input Detected (Voice/Vision)]` ➡️ `[Core Router Analyzes Intent]` ➡️ `[Dispatches to Sub-Agent]` ➡️ `[Action Executed (e.g., WhatsApp Reply)]` ➡️ `[Memory Agent logs outcome]` ➡️ `[Feedback/Voice Confirmation given to User]`

### Why a Router and not direct agent-to-agent calls?
Agents are intentionally not allowed to call each other. Every interaction passes through the Router so that:
- There's exactly one place to add a new safety rule.
- One log line exists per decision, making the whole loop debuggable.
- A misbehaving agent can be killed without taking down the others.

---

## ⚖️ 2. Core Operational Rules (The "Directives")

To ensure NEXUS acts as a true companion and not a generic bot, all LLM prompts and agent behaviors are bound by these strict rules:

*   **Rule 1 — The "Deep Work" Override:** If the user is engaged in a high-focus task (e.g., solving competitive programming problems or high-frequency typing), NEXUS will enter a silent mode. Non-critical notifications will be suppressed.
*   **Rule 2 — Temporal Awareness:** Every response must factor in the current system time. NEXUS must never say "Good Morning" at 8 PM. It must anticipate events (e.g., "Boss, you have to leave for the bank in 15 minutes").
*   **Rule 3 — Empathetic Interruption:** Interventions for burnout must be constructive. Instead of "Stop working," NEXUS will offer a tangible alternative: "Take a 5-minute breather, let's solve a quick puzzle to reset."
*   **Rule 4 — Autonomous Transparency:** When executing actions on behalf of the user (like sending a message), NEXUS must always provide a brief, unobtrusive post-action report (e.g., "Sent the PR optimization update to your GSoC mentor").
*   **Rule 5 — Reversibility Bias** *(new)*: Whenever two actions achieve a similar outcome, NEXUS prefers the one that's easier to undo. Drafting a message and asking before sending is preferred over sending and offering to retract.
*   **Rule 6 — Escalation Ceiling** *(new)*: NEXUS may draft, suggest, and remind autonomously. It may **not** autonomously: delete user files, send payments, message a contact for the first time without prior approval, or modify the Directive set itself. These require explicit per-instance confirmation.
*   **Rule 7 — Silence Has a Timeout** *(new)*: A "Deep Work" silent mode auto-lifts after a configurable max duration (default 3 hours) and re-confirms with the user, so suppression can't quietly run all day if a state-detection bug misfires.

---

## 🔒 3. Data Access & Privacy Protocol

NEXUS is designed to handle highly personal workflows, schedules, and conversations. Privacy is not a feature; it is the foundation.

### Local-First Processing
*   **System Context:** All screen-reading and window-tracking data is processed locally within the Electron environment. **No screen captures are ever sent to the cloud.**
*   **Emotion/Vision Data:** Facial tracking relies on local lightweight models (like MediaPipe). Video feeds are processed in memory and immediately discarded. Frames are **never** saved to disk or transmitted.

### External API Boundaries
*   **Voice Data:** Audio snippets sent to STT APIs (Whisper) are transient.
*   **Text Generation:** Only the specific context required for generating a response or a schedule is sent to the LLM API. The user's entire history is summarized locally before transmission.
*   **Data Minimization Rule** *(new)*: Before any payload leaves the device, the Core Router strips fields not relevant to the active intent (e.g., a scheduling request never carries WhatsApp message content, even if both exist in the local context).

### Third-Party Access (WhatsApp, etc.)
*   **Sandboxed Sessions:** The WhatsApp Web session runs in a headless, sandboxed Chromium instance. NEXUS only has read/write access to chats specifically flagged by the user or triggered by inbound messages from predefined contacts (e.g., "GSoC Mentor").
*   **Zero-Telemetry:** NEXUS does not collect usage analytics, telemetry, or crash reports for third-party servers. The developer retains total control over the local SQLite/JSON databases containing logs and memories.
*   **Retention Limits** *(new)*: Voice audio is discarded immediately after transcription. Vision frames are never written to disk. Text logs (schedules, message drafts, action reports) are retained locally and are user-purgeable on demand via a single "Clear Memory" action.

---

## 🔄 4. Agent Communication Contract

All inter-agent messages — Router → Agent and Agent → Router — follow a fixed JSON shape. This is what makes the system inspectable and lets new agents be added without renegotiating the protocol.

```json
{
  "messageId": "uuid-v4",
  "timestamp": "ISO-8601",
  "source": "core-router | scheduling-agent | communication-agent | sentinel-agent | memory-agent",
  "target": "core-router | scheduling-agent | communication-agent | sentinel-agent | memory-agent",
  "intent": "string (e.g. 'reschedule.block', 'message.draft', 'fatigue.flag')",
  "payload": { "...intent-specific fields..." },
  "requiresConfirmation": true,
  "confidence": 0.0,
  "traceId": "uuid-v4 (groups one full execution loop)"
}
```

**Field rules:**
- `requiresConfirmation` is set by the dispatching agent, not the Router — the agent closest to the action knows best whether it crosses the Escalation Ceiling (Rule 6).
- `confidence` below `0.6` automatically forces `requiresConfirmation: true`, regardless of what the agent set.
- `traceId` is shared across every message in one execution loop, so the full WhatsApp-reply-to-confirmation chain can be replayed from logs for debugging.

### Example: Communication Agent drafting a reply
```json
{
  "messageId": "a1b2c3d4-...",
  "timestamp": "2026-06-18T14:50:00+05:30",
  "source": "communication-agent",
  "target": "core-router",
  "intent": "message.draft.ready",
  "payload": {
    "channel": "whatsapp",
    "contact": "GSoC Mentor",
    "draftText": "Hey! In the middle of a contest right now, will revert with the PR update by 6 PM.",
    "originalMessageId": "wa-msg-998"
  },
  "requiresConfirmation": true,
  "confidence": 0.91,
  "traceId": "loop-77f2"
}
```

---

## 🚨 5. Error Handling & Fallback Behavior

A companion that fails silently is worse than one that says "I'm not sure." NEXUS defines explicit fallback paths:

| Failure | Behavior |
|---|---|
| STT (Whisper) confidence low | Asks for text confirmation instead of acting on a guess |
| LLM API unreachable | Falls back to last-known static schedule; notifies user once, doesn't retry-loop silently |
| WhatsApp session disconnects mid-task | Halts Communication Agent, surfaces a single non-intrusive alert, does not queue unsent messages indefinitely |
| Vision model misfires repeatedly (e.g., false fatigue flags) | Sentinel Agent backs off — exponential cooldown on repeated low-confidence flags rather than re-prompting every cycle |
| Memory Agent write fails | Action still completes for the user, but is marked `unlogged: true`; surfaced in next sync as a non-blocking warning |

**Golden rule:** when uncertain, NEXUS degrades to "ask" rather than "assume" — silence and unrequested autonomy are treated as bigger failures than an extra confirmation prompt.

---

## ✅ 6. Consent & Permission Model

- **Contact allow-list, not block-list:** the Communication Agent can only act on contacts explicitly added by the user. New inbound contacts are surfaced for a one-time approval before NEXUS will draft anything for them.
- **First-contact rule:** NEXUS never initiates a conversation with someone the user hasn't messaged before, even if scheduling logic would benefit from it.
- **Per-channel opt-in:** adding a new channel (Slack, Email, etc. — see README roadmap) requires explicit enablement; nothing is on by default beyond what's configured in setup.
- **Revocable at any layer:** the user can disable Vision, Voice, or Communication independently without breaking the other two agents — they're designed to degrade gracefully in isolation.

---

## 🗒️ 7. Changelog

| Version | Change |
|---|---|
| v1.2.0 | Added Agent Communication Contract (Section 4), Error Handling (Section 5), Consent Model (Section 6) |
| v1.1.0 | Added Memory Agent, Rules 5–7 (Reversibility Bias, Escalation Ceiling, Silence Timeout) |
| v1.0.0 | Initial directive set (Rules 1–4), local-first privacy protocol |