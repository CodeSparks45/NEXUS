# 🧠 NEXUS: Sentient Developer Companion

> "Not just an OS. A proactive, context-aware digital ally that understands, schedules, and executes."

![NEXUS Version](https://img.shields.io/badge/Version-1.0.0--beta-blueviolet?style=for-the-badge)
![Tech Stack](https://img.shields.io/badge/Stack-Electron%20|%20Node.js%20|%20React-black?style=for-the-badge&logo=react)
![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)
![Status](https://img.shields.io/badge/Status-Active%20Development-orange?style=for-the-badge)
![Platform](https://img.shields.io/badge/Platform-Windows%20|%20macOS%20|%20Linux-lightgrey?style=for-the-badge)

<p align="center">
  <img src="https://via.placeholder.com/900x400/0d0d0d/8b5cf6?text=NEXUS+%7C+Demo+GIF+Coming+Soon" alt="NEXUS Demo Placeholder" width="80%">
</p>

<p align="center">
  <i>A locally-first AI companion that lives on your desktop, learns your rhythm, and acts on your behalf — without ever shipping your screen to the cloud.</i>
</p>

---

## 📑 Table of Contents
- [Why NEXUS Exists](#-why-nexus-exists)
- [Core Features](#-core-features)
- [System Architecture](#-system-architecture)
- [Technology Stack](#%EF%B8%8F-technology-stack)
- [How It Feels Day-to-Day](#-how-it-feels-day-to-day)
- [Roadmap](#-roadmap)
- [Installation & Setup](#-installation--setup)
- [Comparison: NEXUS vs Generic Assistants](#-comparison-nexus-vs-generic-assistants)
- [Contributing](#-contributing)
- [Author](#-author)

---

## 💡 Why NEXUS Exists

Most "AI productivity" tools are either a chatbot bolted onto a to-do list, or a cloud service that quietly farms your screen activity for telemetry. NEXUS is built on a different premise: **the most useful assistant is one that runs on your machine, knows your actual schedule, and only escalates to you when it truly matters.**

It's built by a developer, for developers — tuned around the specific chaos of deep-work coding sessions, exam prep, DSA grinding, and the constant context-switching between "build mode" and "life happens" interruptions.

---

## ✨ Core Features

### 🗓️ Dynamic Time-Mapping
Generates optimal, load-balanced study/work schedules using your historical focus patterns, not just a static calendar. Re-balances in real time when something disrupts the plan — a bank run, a sudden meeting, an emergency — and re-distributes the lost time across the rest of the day intelligently instead of just pushing everything back by a flat offset.

### 📡 Autonomous Communication (Agentic Actions)
Integrates with WhatsApp to professionally reply to mentors, managers, or peers without breaking your deep-work flow. Drafts are context-aware — they reflect what you're actually doing right now (e.g., "in the middle of a contest, will revert by 6 PM") rather than generic auto-replies.

### 🎯 Context & Emotion Awareness
Analyzes screen context and lightweight facial/posture signals locally to detect fatigue or frustration patterns, then intervenes constructively — a stretch reminder, a 2-minute puzzle, or simply dimming notifications rather than adding more noise.

### 🎙️ Human-Like Voice Interaction
Real-time conversational voice layer that's synced to actual clock time and task state — it knows whether it's morning or night, and whether you're heads-down or between tasks, and modulates tone accordingly.

### 🛡️ Burnout Guardrail *(new)*
Tracks rolling focus-hours and flags unsustainable patterns (e.g., 6+ hours of unbroken high-intensity coding) before they become a crash, rather than reacting only after frustration is detected.

### 🔌 Plugin-able Agent Slots *(new)*
Beyond WhatsApp, the Communication Agent is designed around a generic adapter interface so Discord, Slack, Email, or LinkedIn DMs can be added as new "channels" without touching the core router.

### 📊 Local Memory & Personal Analytics *(new)*
A local-only dashboard showing weekly focus trends, interruption frequency, and schedule-adherence — your own data, never leaving your machine unless you explicitly export it.

---

## 🏗️ System Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                          INPUT LAYER                              │
│   🎤 Voice (Whisper STT)   🖥️ Screen/Window Context   📷 Vision    │
│   ⌚ System Clock           📅 Calendar/Task Sources                │
└───────────────────────────────┬──────────────────────────────────┘
                                 ▼
                  ┌─────────────────────────────┐
                  │     🧠 CORE ROUTER ("Brain")  │
                  │  Intent classification +      │
                  │  agent dispatch + state log   │
                  └───────────┬─────────────────-┘
            ┌─────────────────┼──────────────────┐
            ▼                 ▼                  ▼
 ┌─────────────────┐ ┌──────────────────┐ ┌────────────────────┐
 │ 🗓️ Scheduling     │ │ 📡 Communication  │ │ 👁️ Sentinel          │
 │ Agent             │ │ Agent             │ │ Agent               │
 │ - Time blocks     │ │ - WhatsApp adapter│ │ - Fatigue detection │
 │ - Re-balancing     │ │ - Draft + send    │ │ - Idle/active state │
 │ - Goal tracking    │ │ - Channel plugins │ │ - Local-only vision │
 └────────┬──────────┘ └────────┬─────────-┘ └─────────┬──────────┘
          └────────────────────┼──────────────────────┘
                                ▼
                  ┌──────────────────────────────┐
                  │   🔊 Feedback / Voice Layer    │
                  │  Confirms actions, reports     │
                  │  status, speaks naturally       │
                  └──────────────────────────────┘
                                ▼
                        👤 USER (Closed Loop)
```

Every agent communicates through the Core Router only — agents never call each other directly. This keeps the system debuggable: one log line per decision, one place to add a new rule. Full message contract is defined in [`AGENTS.md`](./AGENTS.md).

---

## 🛠️ Technology Stack

| Layer | Tech | Why |
|---|---|---|
| **App Shell** | Electron.js / Tauri | Tauri preferred long-term for smaller binary + better sandboxing of the vision module |
| **Frontend** | React.js, Tailwind CSS | Sci-fi/dark minimalist UI, fast iteration |
| **Backend/Logic** | Node.js, Express.js | Same-language stack as frontend, easy agent orchestration |
| **AI/LLM Core** | LangChain, Local LLM / OpenAI API | Swappable model backend — local model for privacy-sensitive parsing, cloud for heavier reasoning |
| **Voice** | OpenAI Whisper (STT), ElevenLabs (TTS) | Low-latency, natural-sounding loop |
| **Automation** | Puppeteer / whatsapp-web.js | Sandboxed browser automation, no official API dependency |
| **Vision/Context** | OpenCV, MediaPipe | Lightweight, fully local emotion/fatigue signals |
| **Local Storage** | SQLite | Logs, memory, schedule history — never leaves the device by default |

---

## 🌗 How It Feels Day-to-Day

> **7:42 AM** — "Morning. You've got DSA practice blocked till 9, then your 9:30 class. Want me to skip the warm-up problem today since you slept late?"

> **2:15 PM** — *(deep work detected, notifications silenced)*

> **2:50 PM** — "Quick one: your mentor messaged about the PR. I drafted a reply saying you're mid-contest and will respond by 6 — want me to send it, or hold?"

> **4:30 PM** — "You've been at this for 3 hours straight. 5-minute breather + a quick logic puzzle, then back to it?"

This is the texture NEXUS is designed around — not a dashboard you check, but a presence that checks in on *you*, on your terms.

---

## 🗺️ Roadmap

- [x] Core Router + agent dispatch skeleton
- [x] Dynamic scheduling engine (v1, static re-balancing)
- [ ] WhatsApp Communication Agent (sandboxed session)
- [ ] Voice loop (Whisper → LangChain → ElevenLabs)
- [ ] Sentinel Agent — local MediaPipe fatigue detection
- [ ] Burnout guardrail with rolling focus-hour tracking
- [ ] Plugin interface for additional channels (Slack/Discord/Email)
- [ ] Local analytics dashboard
- [ ] Encrypted local memory store (SQLCipher)
- [ ] Public Alpha release

---

## 🚀 Installation & Setup
*(Instructions to be added during the Alpha release phase)*

```bash
# Planned setup flow
git clone https://github.com/<your-username>/nexus.git
cd nexus
npm install
npm run dev
```

---

## ⚖️ Comparison: NEXUS vs Generic Assistants

| | Generic Cloud Assistant | NEXUS |
|---|---|---|
| Screen/vision data | Often sent to cloud | Never leaves device |
| Schedule awareness | Static calendar sync | Dynamic, re-balances live |
| Messaging | Manual | Drafts + acts autonomously, reports back |
| Burnout detection | None | Built-in, local |
| Customization | Locked to vendor | Fully open, self-hosted |

---

## 🤝 Contributing

This project is in active early development. Issues, architecture suggestions, and PRs around the agent communication layer are especially welcome. See [`AGENTS.md`](./AGENTS.md) for the governing rules before proposing new agent behavior.

---

## 👨‍💻 Author
**Somwanshi Pawan Siddheshwar**
*Full-Stack Developer & Architect*