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

// Use a harmless unreachable local address — we're testing that the FORM
// correctly saves/reflects config, not the live connection itself (that's
// already covered by the real relay-server integration test).
const FAKE_SERVER_URL = "ws://localhost:19999";

// ===========================================================================
// PART A — Control Panel's Network Sync form
// ===========================================================================
{
  const html = fs.readFileSync(path.join(PROJECT_DIR, "control-panel.html"), "utf8");
  const dom = new JSDOM(html, { url: "https://example.org/control-panel.html" });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.FileReader = dom.window.FileReader;
  globalThis.File = dom.window.File;
  dom.window.confirm = () => true;

  await import(path.join(PROJECT_DIR, "js/comms.js"));
  await import(path.join(PROJECT_DIR, "js/state.js"));
  await import(path.join(PROJECT_DIR, "js/settings.js"));
  await import(path.join(PROJECT_DIR, "js/control-panel.js"));

  const doc = dom.window.document;
  const enabledCheckbox = doc.getElementById("network-sync-enabled");
  const urlInput = doc.getElementById("network-sync-url");
  const statusEl = doc.getElementById("network-sync-status");
  const form = doc.getElementById("network-sync-form");

  check("Network Sync section exists on Control Panel", form !== null);
  check("Starts unchecked (local-only) by default", enabledCheckbox.checked === false);

  // Invalid URL should be rejected with a clear message, not silently enabled
  enabledCheckbox.checked = true;
  urlInput.value = "not-a-valid-url";
  form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  await wait(30);
  check(
    "Invalid server address is rejected (checkbox reverts, error shown)",
    enabledCheckbox.checked === false && statusEl.textContent.toLowerCase().includes("valid")
  );

  // Valid ws:// URL should be accepted and saved
  enabledCheckbox.checked = true;
  urlInput.value = FAKE_SERVER_URL;
  form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  await wait(30);
  check("Valid ws:// address is accepted", enabledCheckbox.checked === true);

  const comms = await import(path.join(PROJECT_DIR, "js/comms.js") + "?verify");
  // Note: config lives in localStorage, readable by any comms.js instance
  check(
    "Saved config is actually persisted (readable by a fresh comms.js instance)",
    comms.getNetworkConfig().enabled === true && comms.getNetworkConfig().serverUrl === FAKE_SERVER_URL
  );

  // Turning it back off should work cleanly
  enabledCheckbox.checked = false;
  form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  await wait(30);
  check("Can be turned back off", enabledCheckbox.checked === false);
  check(
    "Status text reflects local-only mode when off",
    statusEl.textContent.toLowerCase().includes("this computer only")
  );
}

// ===========================================================================
// PART B — Display's minimal Network Sync gear panel
// ===========================================================================
{
  const html = fs.readFileSync(path.join(PROJECT_DIR, "display.html"), "utf8");
  const dom = new JSDOM(html, { url: "https://example.org/display.html" });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.speechSynthesis = { getVoices: () => [], addEventListener: () => {} };
  globalThis.SpeechSynthesisUtterance = function () {};

  await import(path.join(PROJECT_DIR, "js/comms.js") + "?display");
  await import(path.join(PROJECT_DIR, "js/state.js") + "?display");
  await import(path.join(PROJECT_DIR, "js/settings.js") + "?display");
  await import(path.join(PROJECT_DIR, "js/speech.js") + "?display");
  await import(path.join(PROJECT_DIR, "js/display.js") + "?display");

  const doc = dom.window.document;
  const gearButton = doc.getElementById("network-sync-button");
  const panel = doc.getElementById("network-sync-panel");
  const closeButton = doc.getElementById("network-sync-panel-close");
  const enabledCheckbox = doc.getElementById("network-sync-panel-enabled");
  const urlInput = doc.getElementById("network-sync-panel-url");

  check("Gear button and panel exist on Display", gearButton !== null && panel !== null);
  check("Panel starts hidden", panel.hidden === true);

  gearButton.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
  check("Clicking the gear button opens the panel", panel.hidden === false);

  closeButton.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
  check("Close button hides the panel again", panel.hidden === true);

  check("Panel form reflects local-only default on a fresh machine", enabledCheckbox.checked === false && urlInput.value === "");
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
process.exit(failed.length > 0 ? 1 : 0);
