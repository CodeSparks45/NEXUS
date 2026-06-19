"""
NEXUS Voice Module — nexus_voice.py
=====================================
Real companion-level voice interface.

What this does vs the old voice_test.py:
  OLD: 5s fixed recording → tiny Whisper → raw text to backend → done
  NEW: Continuous listen → VAD (silence detection) → base Whisper
       → OpenRouter NLU maps speech to intent → backend executes
       → OpenRouter generates a natural spoken reply → TTS speaks it back

Requirements:
  pip install sounddevice scipy numpy openai-whisper requests pyttsx3 webrtcvad python-dotenv

For ElevenLabs TTS (premium voice):
  pip install elevenlabs
  Set ELEVEN_API_KEY in .env
"""

import os
import sys
import json
import time
import queue
import struct
import threading
import warnings
import tempfile

import numpy as np
import sounddevice as sd
import scipy.io.wavfile as wav
import requests
import whisper
import pyttsx3

warnings.filterwarnings("ignore")
from dotenv import load_dotenv
load_dotenv()

# ─── Config ────────────────────────────────────────────────────────────────────

BACKEND_URL     = os.getenv("NEXUS_BACKEND_URL", "http://localhost:3000/api/nexus/input")
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
ELEVEN_API_KEY  = os.getenv("ELEVEN_API_KEY", "")   # optional, for premium voice
ELEVEN_VOICE_ID = os.getenv("ELEVEN_VOICE_ID", "")

SAMPLE_RATE     = 16000
CHANNELS        = 1
CHUNK_DURATION  = 0.03          # 30ms chunks — standard for VAD
SILENCE_TIMEOUT = 1.8           # seconds of silence before processing
MIN_SPEECH_SECS = 0.6           # ignore clips shorter than this (noise)
WHISPER_MODEL   = "base"        # tiny=fastest/worst, base=good balance, small=better, medium=best

WAKE_WORDS      = ["nexus", "hey nexus", "ok nexus", "boss", "bhai"]   # any of these activates
WAKE_REQUIRED   = False         # True = must say wake word first; False = always listening

# Amplitude threshold for voice activity (tune this if your mic is noisy)
# Lower = more sensitive, Higher = less sensitive
VOICE_THRESHOLD = 300

# ─── Colors (terminal UI) ──────────────────────────────────────────────────────

C = {
    "reset":  "\033[0m",
    "cyan":   "\033[96m",
    "green":  "\033[92m",
    "yellow": "\033[93m",
    "red":    "\033[91m",
    "purple": "\033[95m",
    "bold":   "\033[1m",
    "dim":    "\033[2m",
}

def log(tag, msg, color="cyan"):
    ts = time.strftime("%H:%M:%S")
    print(f"{C[color]}[{ts}][{tag}]{C['reset']} {msg}")

def banner():
    print(f"""
{C['purple']}{C['bold']}
  ███╗   ██╗███████╗██╗  ██╗██╗   ██╗███████╗
  ████╗  ██║██╔════╝╚██╗██╔╝██║   ██║██╔════╝
  ██╔██╗ ██║█████╗   ╚███╔╝ ██║   ██║███████╗
  ██║╚██╗██║██╔══╝   ██╔██╗ ██║   ██║╚════██║
  ██║ ╚████║███████╗██╔╝ ██╗╚██████╔╝███████║
  ╚═╝  ╚═══╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚══════╝
{C['reset']}{C['cyan']}        🧠 Sentient Developer Companion — Voice Interface
{C['dim']}        Say anything. NEXUS is always listening.
{C['reset']}""")

# ─── OpenRouter (Llama-3 Free) Setup ──────────────────────────────────────────

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

def ask_llm(prompt: str) -> str:
    """Helper to call OpenRouter API using free Llama-3 model."""
    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "NexusCompanion",
        "Content-Type": "application/json"
    }
    data = {
       "model": "google/gemma-4-26b-a4b-it:free",
        "messages": [{"role": "user", "content": prompt}]
    }
    resp = requests.post(OPENROUTER_URL, headers=headers, json=data, timeout=20)
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]

# ─── TTS Setup ─────────────────────────────────────────────────────────────────

_tts_engine = None

def get_tts():
    global _tts_engine
    if _tts_engine is None:
        _tts_engine = pyttsx3.init()
        _tts_engine.setProperty("rate", 165)    # speed
        _tts_engine.setProperty("volume", 1.0)
        # Try to set a male voice (sounds better for NEXUS)
        voices = _tts_engine.getProperty("voices")
        for v in voices:
            if "male" in v.name.lower() or "david" in v.name.lower() or "mark" in v.name.lower():
                _tts_engine.setProperty("voice", v.id)
                break
    return _tts_engine

def speak(text: str):
    """Speak text aloud. Tries ElevenLabs first (premium), falls back to pyttsx3."""
    log("NEXUS", f"🔊 {text}", "purple")

    if ELEVEN_API_KEY and ELEVEN_VOICE_ID:
        _speak_elevenlabs(text)
    else:
        _speak_local(text)

def _speak_local(text: str):
    engine = get_tts()
    engine.say(text)
    engine.runAndWait()

def _speak_elevenlabs(text: str):
    try:
        from elevenlabs import ElevenLabs, VoiceSettings
        client_el = ElevenLabs(api_key=ELEVEN_API_KEY)
        audio = client_el.text_to_speech.convert(
            voice_id=ELEVEN_VOICE_ID,
            text=text,
            model_id="eleven_turbo_v2",
            voice_settings=VoiceSettings(stability=0.5, similarity_boost=0.8),
        )
        # Play audio bytes
        import io
        import soundfile as sf
        data, samplerate = sf.read(io.BytesIO(b"".join(audio)))
        sd.play(data, samplerate)
        sd.wait()
    except Exception as e:
        log("TTS", f"ElevenLabs failed ({e}), falling back to local", "yellow")
        _speak_local(text)

# ─── Whisper Setup ─────────────────────────────────────────────────────────────

log("NEXUS", f"Loading Whisper ({WHISPER_MODEL}) — one moment...", "yellow")
_whisper = whisper.load_model(WHISPER_MODEL)
log("NEXUS", "Whisper ready.", "green")

def transcribe(audio_np: np.ndarray) -> str:
    """Convert numpy audio array to text via Whisper."""
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        fname = f.name
    wav.write(fname, SAMPLE_RATE, audio_np.astype(np.int16))
    result = _whisper.transcribe(fname, language="en", fp16=False)
    try:
        os.unlink(fname)
    except Exception:
        pass
    return result["text"].strip()

# ─── NLU — Natural Language → NEXUS Intent ────────────────────────────────────

KNOWN_INTENTS = [
    "schedule.update",
    "schedule.view",
    "schedule.clear",
    "whatsapp.draft",
    "whatsapp.send",
    "whatsapp.status",
    "deepwork.enter",
    "deepwork.exit",
    "fatigue.flag",
    "sentinel.status",
    "nexus.chitchat",       # casual conversation — handled locally, no backend call
    "nexus.unknown",        # couldn't figure it out
]

NLU_PROMPT = """
You are the NLU (Natural Language Understanding) engine inside NEXUS, a developer AI companion.

Your job: Map the user's spoken text to a structured JSON intent that NEXUS's backend understands.

KNOWN INTENTS:
- schedule.update     → User wants to add/update a task or schedule something
- schedule.view       → User asks what's on their schedule today
- schedule.clear      → User wants to clear today's schedule
- whatsapp.draft      → User wants to send a WhatsApp message to someone
- whatsapp.send       → User confirms they want to send a previously drafted message
- whatsapp.status     → User asks if WhatsApp is connected
- deepwork.enter      → User is starting a focused work/study session
- deepwork.exit       → User is done with focused session
- fatigue.flag        → User expresses tiredness, burnout, frustration
- sentinel.status     → User asks about their focus stats / burnout level
- nexus.chitchat      → Casual conversation, greeting, small talk, joke, general question
- nexus.unknown       → Cannot determine intent

EXAMPLES:
"schedule DSA for 3 hours"           → schedule.update, payload: {task: "DSA", duration: "3 hours"}
"what do I have today"               → schedule.view
"send a message to Priya"            → whatsapp.draft, payload: {recipient: "Priya", goal: "..."}
"WhatsApp open karo"                 → whatsapp.draft, payload: {recipient: null, goal: null}
"open whatsapp and message 9876543210 about my project" → whatsapp.draft, payload: {recipient: "9876543210", goal: "about my project"}
"I'm starting to code now"           → deepwork.enter
"I need a break"                     → fatigue.flag
"how are you"                        → nexus.chitchat
"hello nexus"                        → nexus.chitchat
"yaar bahut thak gaya hun"           → fatigue.flag
"bhai schedule dikha"                → schedule.view
"3 ghante DSA krna hai"              → schedule.update, payload: {task: "DSA", duration: "3 hours"}

SPOKEN TEXT TO CLASSIFY:
"{{ SPOKEN_TEXT }}"

Respond ONLY with valid JSON, no markdown:
{
  "intent": "string (from KNOWN_INTENTS)",
  "payload": {},
  "confidence": 0.0,
  "reasoning": "one line — why you chose this intent"
}
"""

def nlu_parse(spoken_text: str) -> dict:
    """Use OpenRouter to classify spoken text into a NEXUS intent + payload."""
    prompt = NLU_PROMPT.replace("{{ SPOKEN_TEXT }}", spoken_text)
    try:
        raw = ask_llm(prompt).strip()
        first = raw.find("{")
        last = raw.rfind("}")
        if first == -1 or last == -1:
            raise ValueError("No JSON in NLU response")
        parsed = json.loads(raw[first:last+1])
        log("NLU", f"Intent: {parsed.get('intent')} (conf: {parsed.get('confidence', '?')}) — {parsed.get('reasoning', '')}", "yellow")
        return parsed
    except Exception as e:
        log("NLU", f"Parse failed: {e}", "red")
        return {"intent": "nexus.unknown", "payload": {}, "confidence": 0, "reasoning": str(e)}

# ─── Response Generator — OpenRouter writes the spoken reply ──────────────────────

RESPONSE_PROMPT = """
You are NEXUS, a highly intelligent, sentient developer companion. 
You just executed an action. Generate a SHORT spoken reply to tell the user what happened.

Rules:
- Max 2 sentences. This is spoken audio — NOT a text message.
- Sound like a real intelligent companion, not a corporate bot.
- Match the user's energy: casual if they're casual, direct if they're in a hurry.
- Never say "I am an AI" or "As an AI language model".
- If the action required confirmation, ask for it naturally.
- Use the user's context and the action result to be specific — not generic.

USER SAID: "{{ SPOKEN_TEXT }}"
ACTION TAKEN: {{ INTENT }}
BACKEND RESULT: {{ RESULT }}

Respond with just the spoken reply text. No JSON, no quotes, no formatting.
"""

def generate_response(spoken_text: str, intent: str, backend_result: dict) -> str:
    """Generate a natural spoken reply for what just happened."""
    prompt = (RESPONSE_PROMPT
              .replace("{{ SPOKEN_TEXT }}", spoken_text)
              .replace("{{ INTENT }}", intent)
              .replace("{{ RESULT }}", json.dumps(backend_result, indent=2)[:800]))
    try:
        return ask_llm(prompt).strip()
    except Exception as e:
        log("RESPONSE", f"Failed: {e}", "red")
        return "Done. But I had trouble formulating a response — check the terminal."

# ─── Chitchat Handler (no backend call needed) ────────────────────────────────

CHITCHAT_PROMPT = """
You are NEXUS, a sentient developer AI companion. The user is talking to you casually.

Respond naturally, briefly (1-3 sentences), like a smart colleague who's also a friend.
Be real, not robotic. A little personality is good.
If they're greeting you, greet back and offer to help.
If they ask how you are, give a brief, witty reply.
Adapt to Hinglish if they're using it.

USER SAID: "{{ TEXT }}"

Respond with just the spoken reply. No formatting.
"""

def handle_chitchat(text: str) -> str:
    prompt = CHITCHAT_PROMPT.replace("{{ TEXT }}", text)
    try:
        return ask_llm(prompt).strip()
    except Exception:
        return "Hey! What's up? How can I help?"

# ─── Backend Call ─────────────────────────────────────────────────────────────

def call_backend(intent: str, payload: dict) -> dict:
    """Send intent + payload to NEXUS Node.js backend."""
    try:
        body = {
            "source": "voice-module",
            "intent": intent,
            "payload": payload,
        }
        log("BACKEND", f"POST {BACKEND_URL} | intent: {intent}", "dim")
        r = requests.post(BACKEND_URL, json=body, timeout=30)
        r.raise_for_status()
        result = r.json()
        log("BACKEND", f"Response: {result.get('intent', 'ok')}", "green")
        return result
    except requests.exceptions.ConnectionError:
        log("BACKEND", "Node.js server not running! Start it with: npm run dev", "red")
        return {"error": "backend_offline", "message": "NEXUS backend is not running."}
    except Exception as e:
        log("BACKEND", f"Error: {e}", "red")
        return {"error": str(e)}

# ─── Wake Word Detection ───────────────────────────────────────────────────────

def contains_wake_word(text: str) -> bool:
    t = text.lower()
    return any(w in t for w in WAKE_WORDS)

def strip_wake_word(text: str) -> str:
    t = text
    for w in WAKE_WORDS:
        t = t.replace(w, "").replace(w.capitalize(), "").strip(" ,.")
    return t if t else text

# ─── VAD (Voice Activity Detection) — amplitude based ─────────────────────────

def is_speech(chunk: np.ndarray) -> bool:
    """Simple amplitude-based VAD. Fast, no extra deps."""
    return np.abs(chunk).mean() > VOICE_THRESHOLD

# ─── Core: Process one utterance ─────────────────────────────────────────────

def process_utterance(audio_np: np.ndarray):
    """
    Full pipeline for one utterance:
    Audio → Whisper → NLU → Backend/Chitchat → LLM reply → TTS
    """
    # 1. Transcribe
    log("VOICE", "Transcribing...", "dim")
    text = transcribe(audio_np)

    if not text or len(text) < 3:
        log("VOICE", "Too short / empty, ignoring.", "dim")
        return

    log("USER", f"'{text}'", "bold")

    # 2. Wake word check (if required)
    if WAKE_REQUIRED and not contains_wake_word(text):
        log("NEXUS", "Wake word not detected, staying silent.", "dim")
        return

    clean_text = strip_wake_word(text) if WAKE_REQUIRED else text

    # 3. NLU — classify intent
    parsed = nlu_parse(clean_text)
    intent  = parsed.get("intent", "nexus.unknown")
    payload = parsed.get("payload", {})

    # 4. Handle chitchat locally (no backend needed)
    if intent in ("nexus.chitchat", "nexus.unknown"):
        reply = handle_chitchat(clean_text)
        speak(reply)
        return

    # 5. Special: if WhatsApp draft payload is incomplete, ask for missing info
    if intent == "whatsapp.draft":
        if not payload.get("recipient"):
            speak("Sure! Who do you want to message? Tell me the name or number.")
            return
        if not payload.get("goal"):
            speak(f"Got it — messaging {payload['recipient']}. What should I say?")
            return
        # Also need businessContext only if it's an outreach message
        # For personal messages, we can just use recipientInfo + goal
        if not payload.get("recipientInfo"):
            payload["recipientInfo"] = {}

    # 6. Call backend
    result = call_backend(intent, payload)

    # 7. Check if confirmation needed
    if result.get("requiresConfirmation"):
        # Generate a confirmation-asking reply
        draft = result.get("payload", {}).get("draft", {})
        draft_text = draft.get("messageText", "")
        if draft_text:
            reply = generate_response(clean_text, intent, result)
            speak(reply)
            speak(f"Here's the draft: {draft_text[:200]}")
            speak("Should I send it? Say yes to confirm or no to cancel.")
        else:
            reply = generate_response(clean_text, intent, result)
            speak(reply)
        return

    # 8. Generate natural reply and speak it
    reply = generate_response(clean_text, intent, result)
    speak(reply)

# ─── Continuous Listening Loop ─────────────────────────────────────────────────

class ContinuousListener:
    """
    Listens to mic continuously using VAD.
    When speech is detected → collects audio → silence detected → process.
    """

    def __init__(self):
        self.audio_queue   = queue.Queue()
        self.recording     = []
        self.speaking      = False
        self.silence_start = None
        self.is_processing = False   # don't listen while NEXUS is speaking

    def _audio_callback(self, indata, frames, time_info, status):
        """Called by sounddevice for every audio chunk."""
        if self.is_processing:
            return
        chunk = indata[:, 0].copy()  # mono
        self.audio_queue.put(chunk)

    def run(self):
        log("NEXUS", "Continuous listening started. Speak naturally.", "green")
        log("NEXUS", f"Voice threshold: {VOICE_THRESHOLD} | Silence timeout: {SILENCE_TIMEOUT}s", "dim")

        chunk_size = int(SAMPLE_RATE * CHUNK_DURATION)

        with sd.InputStream(
            samplerate=SAMPLE_RATE,
            channels=CHANNELS,
            blocksize=chunk_size,
            dtype="int16",
            callback=self._audio_callback,
        ):
            print(f"\n{C['green']}● NEXUS is listening...{C['reset']}\n")

            while True:
                try:
                    chunk = self.audio_queue.get(timeout=0.1)
                except queue.Empty:
                    continue

                speech_detected = is_speech(chunk)

                if speech_detected:
                    if not self.speaking:
                        self.speaking = True
                        self.recording = []
                        log("VOICE", "▶ Speech detected", "cyan")
                    self.recording.append(chunk)
                    self.silence_start = None

                elif self.speaking:
                    self.recording.append(chunk)  # keep a bit of trailing silence
                    if self.silence_start is None:
                        self.silence_start = time.time()
                    elif time.time() - self.silence_start > SILENCE_TIMEOUT:
                        # Silence long enough — process the utterance
                        audio = np.concatenate(self.recording)
                        duration = len(audio) / SAMPLE_RATE

                        self.speaking = False
                        self.recording = []
                        self.silence_start = None

                        if duration < MIN_SPEECH_SECS:
                            log("VOICE", f"Too short ({duration:.1f}s), ignoring.", "dim")
                            continue

                        log("VOICE", f"◼ Captured {duration:.1f}s of speech", "cyan")
                        self.is_processing = True
                        try:
                            process_utterance(audio)
                        except Exception as e:
                            log("ERROR", str(e), "red")
                        finally:
                            self.is_processing = False
                            print(f"\n{C['green']}● Listening...{C['reset']}\n")

# ─── Entry Point ───────────────────────────────────────────────────────────────

def main():
    if not OPENROUTER_API_KEY:
        log("ERROR", "OPENROUTER_API_KEY not set in environment! Check your .env", "red")
        sys.exit(1)

    banner()

    log("CONFIG", f"Backend: {BACKEND_URL}", "dim")
    log("CONFIG", f"Whisper model: {WHISPER_MODEL}", "dim")
    log("CONFIG", f"Wake word required: {WAKE_REQUIRED}", "dim")
    if WAKE_REQUIRED:
        log("CONFIG", f"Wake words: {WAKE_WORDS}", "dim")

    # Greeting
    speak("NEXUS is online. I'm listening — what do you need?")

    listener = ContinuousListener()
    try:
        listener.run()
    except KeyboardInterrupt:
        print(f"\n{C['yellow']}[NEXUS] Shutting down. See you, boss.{C['reset']}\n")

if __name__ == "__main__":
    main()