// Requires jsdom (dev-only test tool — see chunk4-control-panel.test.mjs
// for install instructions). Run from the project root:
//   node tests/chunk5-display.test.mjs

import { JSDOM } from "jsdom";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.resolve(__dirname, "..");

const results = [];
function check(label, condition) {
  results.push({ label, pass: !!condition });
  console.log(`${condition ? "PASS" : "FAIL"} — ${label}`);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// --- Fake Speech Synthesis (same shape as chunk2's test mock) --------------
class FakeUtterance {
  constructor(text) {
    this.text = text;
    this.rate = 1;
    this.volume = 1;
    this.voice = null;
    this.onend = null;
    this.onerror = null;
  }
}
class FakeSpeechSynthesis {
  constructor(voices = []) {
    this._voices = voices;
    this._listeners = {};
    this.spokenOrder = [];
  }
  getVoices() {
    return this._voices;
  }
  addEventListener(evt, cb) {
    (this._listeners[evt] ??= []).push(cb);
  }
  speak(utterance) {
    this.spokenOrder.push(utterance.text);
    setTimeout(() => utterance.onend && utterance.onend(), 10);
  }
  cancel() {
    this.spokenOrder.push("__CANCELLED__");
  }
}

// --- Pre-seed localStorage with an EXISTING ticket, simulating the
// Display page being opened/refreshed after a ticket was already called.
// The whole point of this test is confirming that recovery does NOT
// trigger bell/flash/speech — only a live comms event should. -------------
const PRESEEDED_STATE = {
  current: { ticketNumber: "B015", counter: 2, message: "", calledAt: Date.now() - 5000 },
  history: [{ ticketNumber: "B015", counter: 2, message: "", calledAt: Date.now() - 5000 }],
};

const html = fs.readFileSync(path.join(PROJECT_DIR, "display.html"), "utf8");
const dom = new JSDOM(html, { url: "https://example.org/display.html" });

globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;
// Note: NOT overriding globalThis.navigator — Node 22+ has its own
// built-in read-only `navigator` global. That's actually fine for this
// test: it naturally lacks `wakeLock`, which is exactly the
// unsupported-API path display.js needs to handle gracefully.
globalThis.speechSynthesis = new FakeSpeechSynthesis([{ name: "Eng", lang: "en-US", voiceURI: "e1" }]);
globalThis.SpeechSynthesisUtterance = FakeUtterance;

localStorage.setItem("queue-system:state", JSON.stringify(PRESEEDED_STATE));

const doc = dom.window.document;

// --- Import in production order --------------------------------------------
await import(path.join(PROJECT_DIR, "js/comms.js"));
const state = await import(path.join(PROJECT_DIR, "js/state.js"));
const settings = await import(path.join(PROJECT_DIR, "js/settings.js"));
await import(path.join(PROJECT_DIR, "js/speech.js"));
await import(path.join(PROJECT_DIR, "js/display.js")); // self-initializes on import

// A genuinely SEPARATE comms.js instance = a real second tab (Control Panel)
const controlComms = await import(path.join(PROJECT_DIR, "js/comms.js") + "?realm=control");

const ticketNumberEl = doc.getElementById("ticket-number");
const counterLabelEl = doc.getElementById("counter-label");
const lastCalledList = doc.getElementById("last-called-list");
const lastCalledEmpty = doc.getElementById("last-called-empty");
const bellEl = doc.getElementById("bell-sound");
const officeNameEl = doc.getElementById("office-name");
const officeLogoEl = doc.getElementById("office-logo");
const footerEl = doc.getElementById("scrolling-footer");
const footerTextEl = doc.getElementById("scrolling-footer-text");
const clockEl = doc.getElementById("clock");

// Spy on bell playback (jsdom's real HTMLMediaElement.play() isn't implemented)
let bellPlayCount = 0;
bellEl.play = () => {
  bellPlayCount++;
  return Promise.resolve();
};
bellEl.pause = () => {};

// ---------------------------------------------------------------------
// PART A — recovery on load must NOT trigger bell/flash/speech
// ---------------------------------------------------------------------
check("Recovered ticket renders on screen immediately", ticketNumberEl.textContent === "B015");
check("Recovered counter label renders correctly", counterLabelEl.textContent === "PLEASE PROCEED TO COUNTER 2");
check("Recovered history renders in the last-called list", lastCalledList.children.length === 1);
check("Loading a page with an existing ticket does NOT ring the bell", bellPlayCount === 0);
check("Loading a page with an existing ticket does NOT speak", globalThis.speechSynthesis.spokenOrder.length === 0);
check(
  "Loading a page with an existing ticket does NOT apply the flash animation",
  !ticketNumberEl.classList.contains("flash")
);

// ---------------------------------------------------------------------
// PART B — a LIVE 'ticket-called' event DOES trigger bell + flash + speech
// ---------------------------------------------------------------------
controlComms.send("ticket-called", { ticketNumber: "A004", counter: 3, message: "" });
await wait(30);

check("Live ticket-called event updates the ticket number on screen", ticketNumberEl.textContent === "A004");
check("Live ticket-called event updates the counter label", counterLabelEl.textContent === "PLEASE PROCEED TO COUNTER 3");
check("Live ticket-called event rings the bell", bellPlayCount === 1);
check("Live ticket-called event applies the flash animation class", ticketNumberEl.classList.contains("flash"));
check(
  "Live ticket-called event speaks the auto-generated phrase",
  globalThis.speechSynthesis.spokenOrder.includes("Ticket A004, please proceed to Counter 3.")
);

// ---------------------------------------------------------------------
// PART C — ticket-repeat also triggers bell + speech (re-announce)
// ---------------------------------------------------------------------
const spokenCountBefore = globalThis.speechSynthesis.spokenOrder.length;
controlComms.send("ticket-repeat", { ticketNumber: "A004", counter: 3, message: "" });
await wait(30);
check("Repeat also rings the bell again", bellPlayCount === 2);
check("Repeat speaks again", globalThis.speechSynthesis.spokenOrder.length === spokenCountBefore + 1);

// ---------------------------------------------------------------------
// PART D — display-cleared cancels any in-progress/queued speech
// ---------------------------------------------------------------------
controlComms.send("display-cleared", {});
await wait(30);
check("display-cleared broadcasts trigger a speech cancel", globalThis.speechSynthesis.spokenOrder.includes("__CANCELLED__"));

// ---------------------------------------------------------------------
// PART E — settings drive office identity, theme, and footer live
//
// NOTE: same module-caching caveat as chunk1/chunk3's tests — a second
// settings.js instance would secretly share display.js's internal
// comms.js singleton (since settings.js's own `import "./comms.js"` is
// unparameterized), so it can't be used to simulate "a real second tab"
// sending a broadcast. Instead, send the 'settings-updated' event
// directly through `controlComms` (already a genuinely separate
// instance from Part B) with a complete settings object — exactly what
// a real Control Panel tab's saveSettings() would actually broadcast.
// ---------------------------------------------------------------------
controlComms.send("settings-updated", {
  ...settings.DEFAULT_SETTINGS,
  officeName: "Cebu Normal University",
  officeLogo: "data:image/png;base64,AAAA",
  themeColor: "#0b7a3e",
  footerMessage: "Please have your ID ready.",
});
await wait(30);

check("Live settings change updates the office name on screen", officeNameEl.textContent === "Cebu Normal University");
check("Live settings change shows the logo when one is set", officeLogoEl.hidden === false);
check("Live settings change shows the footer when a message is set", footerEl.hidden === false && footerTextEl.textContent === "Please have your ID ready.");
check("Theme color is applied as a CSS variable on the page", doc.documentElement.style.getPropertyValue("--color-accent") === "#0b7a3e");

controlComms.send("settings-updated", { ...settings.DEFAULT_SETTINGS, footerMessage: "" });
await wait(30);
check("Clearing the footer message hides the footer bar", footerEl.hidden === true);

controlComms.send("settings-updated", { ...settings.DEFAULT_SETTINGS, officeLogo: "" });
await wait(30);
check("Clearing the logo hides the logo image", officeLogoEl.hidden === true);

// ---------------------------------------------------------------------
// PART F — clock renders something plausible
// ---------------------------------------------------------------------
check("Clock renders a non-empty time string on load", clockEl.textContent.length > 0);

// ---------------------------------------------------------------------
// PART G — graceful no-ops for unsupported browser APIs (no throw)
// ---------------------------------------------------------------------
const fullscreenButton = doc.getElementById("fullscreen-button");
let fullscreenClickThrew = false;
try {
  fullscreenButton.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
} catch (err) {
  fullscreenClickThrew = true;
}
check("Fullscreen button click doesn't throw when Fullscreen API is unavailable in jsdom", !fullscreenClickThrew);

// ---------------------------------------------------------------------
// PART H — audio unlock overlay (replaces the old silent priming trick)
// ---------------------------------------------------------------------
const audioOverlay = doc.getElementById("audio-unlock-overlay");
check("Audio unlock overlay exists and starts visible", audioOverlay !== null && !audioOverlay.classList.contains("is-hidden"));

let overlayPlayCalled = false;
bellEl.play = () => {
  overlayPlayCalled = true;
  return Promise.resolve();
};
audioOverlay.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
await wait(20);
check("Clicking the overlay attempts to play/unlock the bell", overlayPlayCalled);
check("Clicking the overlay hides it", audioOverlay.classList.contains("is-hidden"));


const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
process.exit(failed.length > 0 ? 1 : 0);
