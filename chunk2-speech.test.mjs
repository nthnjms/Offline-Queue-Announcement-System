// Fakes the browser Speech Synthesis API closely enough to exercise the
// two real bugs speech.js exists to fix: async voice loading, and
// overlapping/out-of-order announcements.

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
  constructor(initialVoices = []) {
    this._voices = initialVoices;
    this._listeners = {};
    this.spokenOrder = [];
    this.utterances = [];
  }
  getVoices() {
    return this._voices;
  }
  addEventListener(evt, cb) {
    (this._listeners[evt] ??= []).push(cb);
  }
  fireVoicesChanged(voices) {
    this._voices = voices;
    (this._listeners["voiceschanged"] || []).forEach((cb) => cb());
  }
  speak(utterance) {
    this.spokenOrder.push(utterance.text);
    this.utterances.push(utterance);
    // Simulate real async completion — onend fires on a later tick,
    // not synchronously. This is what would silently break a naive
    // isSpeaking-flag-only implementation.
    setTimeout(() => utterance.onend && utterance.onend(), 15);
  }
  cancel() {
    this.spokenOrder.push("__CANCELLED__");
  }
}

const results = [];
function check(label, condition) {
  results.push({ label, pass: !!condition });
  console.log(`${condition ? "PASS" : "FAIL"} — ${label}`);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

globalThis.SpeechSynthesisUtterance = FakeUtterance;
globalThis.window = globalThis;

// --- Scenario A: voices available immediately ---
globalThis.speechSynthesis = new FakeSpeechSynthesis([
  { name: "English (US)", lang: "en-US", voiceURI: "en-us-1" },
  { name: "Français", lang: "fr-FR", voiceURI: "fr-1" },
]);
const speechA = await import("../js/speech.js?scenario=a");
check(
  "Filters to English voices only when voices are ready immediately",
  speechA.getAvailableEnglishVoices().length === 1 &&
    speechA.getAvailableEnglishVoices()[0].voiceURI === "en-us-1"
);

// --- Scenario B: voices NOT ready immediately (the actual Chrome bug) ---
const fakeB = new FakeSpeechSynthesis([]); // empty on first getVoices() call
globalThis.speechSynthesis = fakeB;
const speechB = await import("../js/speech.js?scenario=b");
check(
  "Before voiceschanged fires, English voice list is correctly empty (not crashed)",
  speechB.getAvailableEnglishVoices().length === 0
);
fakeB.fireVoicesChanged([{ name: "English (UK)", lang: "en-GB", voiceURI: "en-gb-1" }]);
check(
  "After voiceschanged fires, cached voice list updates",
  speechB.getAvailableEnglishVoices().length === 1 &&
    speechB.getAvailableEnglishVoices()[0].voiceURI === "en-gb-1"
);

// --- Scenario C: FIFO queue, no overlap ---
const fakeC = new FakeSpeechSynthesis([{ name: "Eng", lang: "en-US", voiceURI: "e1" }]);
globalThis.speechSynthesis = fakeC;
const speechC = await import("../js/speech.js?scenario=c");
speechC.announce("first");
speechC.announce("second");
speechC.announce("third");
check("Only the first announcement starts immediately (no overlap)", 
  fakeC.spokenOrder.length === 1 && fakeC.spokenOrder[0] === "first");
check("Queue length reflects 2 waiting + 1 speaking", speechC.getQueueLength() === 3);
await wait(80);
check(
  "All three eventually speak, strictly in FIFO order",
  fakeC.spokenOrder.join(",") === "first,second,third"
);
check("Queue drains to 0 once done", speechC.getQueueLength() === 0);

// --- Scenario D: announceTicket phrasing (default vs custom) ---
const fakeD = new FakeSpeechSynthesis([{ name: "Eng", lang: "en-US", voiceURI: "e1" }]);
globalThis.speechSynthesis = fakeD;
const speechD = await import("../js/speech.js?scenario=d");
speechD.announceTicket({ ticketNumber: "B015", counter: 2, message: "" });
check(
  "Default phrasing matches spec exactly",
  fakeD.spokenOrder[0] === "Ticket B015, please proceed to Counter 2."
);
await wait(30);
speechD.announceTicket({ ticketNumber: "A001", counter: 1, message: "  Please see the information desk.  " });
check(
  "Custom message used verbatim (trimmed) instead of auto-generated text",
  fakeD.spokenOrder[1] === "Please see the information desk."
);

// --- Scenario E: rate/volume clamping actually reaches the utterance ---
const fakeE = new FakeSpeechSynthesis([{ name: "Eng", lang: "en-US", voiceURI: "e1" }]);
globalThis.speechSynthesis = fakeE;
const speechE = await import("../js/speech.js?scenario=e");
speechE.setRate(5); // above max
speechE.setVolume(-3); // below min
speechE.announce("clamped test");
const utt = fakeE.utterances[0];
check("Rate clamped to max (2)", utt.rate === 2);
check("Volume clamped to min (0)", utt.volume === 0);
await wait(30);
speechE.setRate(0.1); // below min
speechE.setVolume(9); // above max
speechE.announce("clamped test 2");
const utt2 = fakeE.utterances[1];
check("Rate clamped to min (0.5)", utt2.rate === 0.5);
check("Volume clamped to max (1)", utt2.volume === 1);

// --- Scenario F: clearQueue stops immediately and discards pending items ---
const fakeF = new FakeSpeechSynthesis([{ name: "Eng", lang: "en-US", voiceURI: "e1" }]);
globalThis.speechSynthesis = fakeF;
const speechF = await import("../js/speech.js?scenario=f");
speechF.announce("a"); // starts speaking synchronously
speechF.announce("b"); // queued, never gets to speak
speechF.clearQueue();
check("clearQueue calls speechSynthesis.cancel()", fakeF.spokenOrder.includes("__CANCELLED__"));
check("Queued-but-not-started item never speaks", !fakeF.spokenOrder.includes("b"));
check("Queue length resets to 0 after clear", speechF.getQueueLength() === 0);
speechF.announce("c");
check("Module still works normally after a clear (not stuck)", fakeF.spokenOrder.includes("c"));

// --- Scenario G: graceful no-op when Speech Synthesis isn't supported at all ---
delete globalThis.speechSynthesis;
delete globalThis.SpeechSynthesisUtterance;
let threw = false;
try {
  const speechG = await import("../js/speech.js?scenario=g");
  speechG.announce("no speech api here");
  speechG.announceTicket({ ticketNumber: "X001", counter: 1, message: "" });
} catch (err) {
  threw = true;
  console.error(err);
}
check("Never throws when Speech Synthesis API is entirely unavailable", !threw);

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
process.exit(failed.length > 0 ? 1 : 0);
