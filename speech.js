/* ==========================================================================
   speech.js — CHUNK 2 (implemented)

   Wraps the browser Speech Synthesis API and fixes the two problems the
   raw API doesn't solve for you:

   1. VOICE-LOADING RACE CONDITION
      speechSynthesis.getVoices() very often returns [] the first time
      it's called — voice lists load asynchronously (especially in
      Chrome) and aren't ready yet on page load. This module checks
      immediately, and if the list is empty, waits for the one-time
      'voiceschanged' event and caches the result. Every other function
      here reads from that cache, never calls getVoices() directly again.

   2. OVERLAPPING ANNOUNCEMENTS
      A single `isSpeaking` boolean is not enough — if two tickets get
      called in quick succession, a naive check would just DROP the
      second announcement. This module keeps a real FIFO queue: each
      call to announce() pushes text onto the queue, and the next item
      only starts speaking once the previous utterance's `onend` fires.

   Exports:
     - announce(text)              queue raw text to be spoken
     - announceTicket(entry)       build + queue the right announcement
                                    for a ticket entry from state.js
                                    (custom message if present, otherwise
                                    the auto-generated "Ticket X, please
                                    proceed to Counter Y." phrasing)
     - setRate(value)               0.5–2, clamped
     - setVolume(value)              0–1, clamped
     - setVoice(voiceURI)             pin a specific voice by URI
     - getAvailableEnglishVoices()     for populating a Settings dropdown
     - getQueueLength()                 how many announcements are waiting
     - clearQueue()                      stop immediately, drop anything queued
                                          (used when the operator hits Clear Display)

   Depends on: nothing (self-contained; testable standalone).
   Depended on by: display.js.
   ========================================================================== */

const RATE_MIN = 0.5;
const RATE_MAX = 2;
const VOLUME_MIN = 0;
const VOLUME_MAX = 1;

/** @type {string[]} */
const queue = [];
let isSpeaking = false;

/** @type {SpeechSynthesisVoice[]} */
let cachedVoices = [];
let preferredVoiceURI = null;

let rate = 1;
let volume = 1;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function supportsSpeech() {
  return typeof speechSynthesis !== "undefined" && typeof SpeechSynthesisUtterance !== "undefined";
}

function refreshVoiceCache() {
  const voices = speechSynthesis.getVoices();
  if (voices && voices.length > 0) {
    cachedVoices = voices;
  }
}

function initVoices() {
  if (!supportsSpeech()) {
    console.warn(
      "[speech.js] Speech Synthesis is not supported in this browser. " +
        "Voice announcements will be silently skipped."
    );
    return;
  }

  refreshVoiceCache();

  if (cachedVoices.length === 0) {
    // Not ready yet — this is the normal/expected case on first load in
    // many browsers. Wait for the one-time signal that the list is ready.
    speechSynthesis.addEventListener("voiceschanged", refreshVoiceCache, { once: true });
  }
}

/** English voices only, for populating a Settings > Voice dropdown. */
export function getAvailableEnglishVoices() {
  return cachedVoices.filter((v) => v.lang && v.lang.toLowerCase().startsWith("en"));
}

/** Pin a specific voice by its voiceURI (from a Settings dropdown). */
export function setVoice(voiceURI) {
  preferredVoiceURI = voiceURI || null;
}

/** Speech rate, 0.5 (slow) to 2 (fast). Out-of-range values are clamped. */
export function setRate(value) {
  rate = clamp(Number(value), RATE_MIN, RATE_MAX);
}

/** Speech volume, 0 (silent) to 1 (full). Out-of-range values are clamped. */
export function setVolume(value) {
  volume = clamp(Number(value), VOLUME_MIN, VOLUME_MAX);
}

/** How many announcements are currently waiting (including the one
 *  actively speaking) — useful for a small "queued" indicator in the UI. */
export function getQueueLength() {
  return queue.length + (isSpeaking ? 1 : 0);
}

function pickVoice() {
  if (preferredVoiceURI) {
    const pinned = cachedVoices.find((v) => v.voiceURI === preferredVoiceURI);
    if (pinned) return pinned;
  }
  const english = getAvailableEnglishVoices();
  return english[0] || cachedVoices[0] || null;
}

function processQueue() {
  if (isSpeaking) return;
  const text = queue.shift();
  if (text === undefined) return;
  speakNow(text);
}

function speakNow(text) {
  if (!supportsSpeech()) {
    console.warn("[speech.js] Skipped announcement (Speech Synthesis unavailable):", text);
    processQueue(); // don't let one unsupported browser stall the rest of the queue
    return;
  }

  isSpeaking = true;

  const utterance = new SpeechSynthesisUtterance(text);
  const voice = pickVoice();
  if (voice) utterance.voice = voice;
  utterance.rate = rate;
  utterance.volume = volume;

  utterance.onend = () => {
    isSpeaking = false;
    processQueue();
  };
  utterance.onerror = (event) => {
    console.error("[speech.js] Utterance error:", event);
    isSpeaking = false;
    processQueue();
  };

  speechSynthesis.speak(utterance);
}

/** Queue raw text to be spoken. Announcements always play in order, one
 *  at a time — never overlapping. */
export function announce(text) {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return;
  queue.push(trimmed);
  processQueue();
}

/**
 * Build and queue the spoken announcement for a ticket entry (the same
 * shape state.js's callTicket()/history produces). Uses the custom
 * message verbatim if one was provided; otherwise generates:
 * "Ticket B015, please proceed to Counter 2."
 * @param {{ ticketNumber: string, counter: string|number, message?: string }} entry
 */
export function announceTicket(entry) {
  const text =
    entry.message && entry.message.trim()
      ? entry.message.trim()
      : `Ticket ${entry.ticketNumber}, please proceed to Counter ${entry.counter}.`;
  announce(text);
}

/** Stop immediately and discard anything waiting in the queue. Used when
 *  the operator hits "Clear Display" — a stale announcement shouldn't
 *  keep playing after the screen's been cleared. */
export function clearQueue() {
  queue.length = 0;
  isSpeaking = false;
  if (supportsSpeech()) {
    speechSynthesis.cancel();
  }
}

initVoices();

if (typeof window !== "undefined") {
  window.__queueSpeech = {
    announce,
    announceTicket,
    setRate,
    setVolume,
    setVoice,
    getAvailableEnglishVoices,
    getQueueLength,
    clearQueue,
  };
}

console.log("[speech.js] ready");
