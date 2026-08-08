// Requires jsdom (dev-only test tool — NOT a dependency of the actual app,
// which stays pure vanilla JS/HTML/CSS). Install once with:
//   npm install --no-save jsdom
// then run from the project root with:
//   node tests/chunk4-control-panel.test.mjs

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

// --- Build a real DOM from the actual control-panel.html file -------------
const html = fs.readFileSync(path.join(PROJECT_DIR, "control-panel.html"), "utf8");
const dom = new JSDOM(html, { url: "https://example.org/control-panel.html" });

globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;
globalThis.FileReader = dom.window.FileReader;
globalThis.File = dom.window.File;

// Mock confirm() so we control its return value per test
let confirmReturnValue = true;
const confirmCalls = [];
dom.window.confirm = (message) => {
  confirmCalls.push(message);
  return confirmReturnValue;
};

const doc = dom.window.document;

// --- Import the REAL project modules in production script order -----------
await import(path.join(PROJECT_DIR, "js/comms.js"));
const state = await import(path.join(PROJECT_DIR, "js/state.js"));
const settings = await import(path.join(PROJECT_DIR, "js/settings.js"));
await import(path.join(PROJECT_DIR, "js/control-panel.js")); // self-initializes on import, like in production

// ---------------------------------------------------------------------
// PART A — calling a ticket via the real form submit flow
// ---------------------------------------------------------------------
const ticketInput = doc.getElementById("ticket-number");
const counterSelect = doc.getElementById("counter-select");
const messageInput = doc.getElementById("custom-message");
const callForm = doc.getElementById("call-form");
const nowShowingValue = doc.getElementById("now-showing-value");
const historyList = doc.getElementById("history-list");
const historyEmpty = doc.getElementById("history-empty");

check("Counter dropdown pre-populated from default settings (4 counters)", counterSelect.options.length === 4);
check("Ticket input is auto-focused on load", doc.activeElement === ticketInput);
check("History starts empty", !historyEmpty.hidden && historyList.children.length === 0);

ticketInput.value = "b015";
counterSelect.value = "2";
callForm.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));

check("callTicket() actually ran — state has the ticket", state.getState().current?.ticketNumber === "B015");
check("Form normalizes lowercase input to uppercase before calling", state.getState().current?.ticketNumber === "B015");
check("'Now showing' readout updates after Call", nowShowingValue.textContent === "B015 → Counter 2");
check("Ticket field clears after a successful Call (ready for next ticket)", ticketInput.value === "");
check("History list gains one entry", historyList.children.length === 1 && historyEmpty.hidden);

// ---------------------------------------------------------------------
// PART B — the ticket-format warning UI was removed per user feedback;
// confirm it's actually gone rather than just unused
// ---------------------------------------------------------------------
check("Ticket format warning element no longer exists in the DOM", doc.getElementById("ticket-hint") === null);

// ---------------------------------------------------------------------
// PART C — history recall populates the form without auto-calling
// ---------------------------------------------------------------------
counterSelect.value = "3";
messageInput.value = "";
ticketInput.value = "a002";
callForm.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
// history is now [A002 (counter 3), B015 (counter 2)], newest first

check("Second call adds a second history entry", historyList.children.length === 2);

const secondHistoryButton = historyList.children[1].querySelector("button");
secondHistoryButton.dispatchEvent(new dom.window.Event("click", { bubbles: true }));

check("Clicking an older history item loads it into the form", ticketInput.value === "B015" && counterSelect.value === "2");
check("Recall does NOT immediately re-call it (current ticket unchanged)", state.getState().current.ticketNumber === "A002");
ticketInput.value = "";

// ---------------------------------------------------------------------
// PART D — Clear Display, gated by confirm()
// ---------------------------------------------------------------------
const clearButton = doc.getElementById("clear-button");
confirmReturnValue = false;
clearButton.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
check("Clear Display does nothing if the operator cancels the confirm dialog", state.getState().current !== null);

confirmReturnValue = true;
clearButton.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
check("Clear Display works after confirming", state.getState().current === null);
check("'Now showing' readout resets to placeholder", nowShowingValue.textContent === "—");
check("A confirmation dialog was actually shown before clearing", confirmCalls.length === 2);

// ---------------------------------------------------------------------
// PART E — Settings form round-trip through the real DOM
// ---------------------------------------------------------------------
const settingsForm = doc.getElementById("settings-form");
const officeNameInput = doc.getElementById("office-name-input");
const counterCountInput = doc.getElementById("counter-count-input");
const themeColorInput = doc.getElementById("theme-color-input");
const themeColorText = doc.getElementById("theme-color-text");
const savedNote = doc.getElementById("settings-saved-note");

officeNameInput.value = "Cebu Normal University";
counterCountInput.value = "6";
themeColorInput.value = "#0b7a3e";
themeColorInput.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
check("Theme color swatch change syncs to the hex text field", themeColorText.value === "#0b7a3e");

settingsForm.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));

check("Settings form submit actually calls saveSettings()", settings.getSettings().officeName === "Cebu Normal University");
check("Counter count from the form is respected", settings.getSettings().counterCount === 6);
check("Counter dropdown regenerates to match new counterCount (6 options)", counterSelect.options.length === 6);
check("'Saved.' confirmation note appears after saving", savedNote.hidden === false);

// ---------------------------------------------------------------------
// PART F — Reset to Defaults, also gated by confirm()
// ---------------------------------------------------------------------
const resetButton = doc.getElementById("reset-settings-button");
confirmReturnValue = true;
resetButton.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
check("Reset to Defaults restores office name", settings.getSettings().officeName === "Office Name");
check("Reset to Defaults restores counter count, and dropdown updates", counterCountInput.value === "4" && counterSelect.options.length === 4);

// ---------------------------------------------------------------------
// PART G — Logo upload (real jsdom File + FileReader)
// ---------------------------------------------------------------------
const logoInput = doc.getElementById("logo-input");
const logoPreview = doc.getElementById("logo-preview");
const removeLogoButton = doc.getElementById("remove-logo-button");

const fakeFile = new dom.window.File(["fake-png-bytes"], "logo.png", { type: "image/png" });
Object.defineProperty(logoInput, "files", { value: [fakeFile], configurable: true });
logoInput.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
await wait(50); // FileReader is async

check("Logo preview appears after selecting a file", logoPreview.hidden === false);
check("Remove logo button appears once a logo is staged", removeLogoButton.hidden === false);

settingsForm.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
check("Logo is actually persisted to settings after Save", settings.getSettings().officeLogo.startsWith("data:"));

removeLogoButton.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
check("Remove logo button clears the preview immediately (pending, not yet saved)", logoPreview.hidden === true);
settingsForm.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
check("Removing the logo then saving actually clears it from settings", settings.getSettings().officeLogo === "");

// ---------------------------------------------------------------------
// PART H — pure helper functions (edge cases, no DOM needed)
// ---------------------------------------------------------------------
const cp = await import(path.join(PROJECT_DIR, "js/control-panel.js") + "?helpers");
check("normalizeTicket trims and uppercases", cp.normalizeTicket("  b015  ") === "B015");
check("normalizeTicket handles empty/undefined safely", cp.normalizeTicket(undefined) === "" && cp.normalizeTicket("") === "");
check("looksLikeValidTicket accepts standard formats", cp.looksLikeValidTicket("B015") && cp.looksLikeValidTicket("P003") && cp.looksLikeValidTicket("AB22"));
check("looksLikeValidTicket rejects nonsense", !cp.looksLikeValidTicket("HELLO") && !cp.looksLikeValidTicket("123"));
check("computeCounterOptions produces the right count", cp.computeCounterOptions(5).length === 5 && cp.computeCounterOptions(5)[4] === "5");
check("computeCounterOptions floors to at least 1", cp.computeCounterOptions(0).length === 1 && cp.computeCounterOptions(-3).length === 1);
check("formatRelativeTime handles 'just now'", cp.formatRelativeTime(Date.now() - 2000) === "just now");
check("formatRelativeTime handles minutes", cp.formatRelativeTime(Date.now() - 5 * 60 * 1000) === "5m ago");

// ---------------------------------------------------------------------
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
process.exit(failed.length > 0 ? 1 : 0);
