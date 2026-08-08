const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.window = globalThis;

const results = [];
function check(label, condition) {
  results.push({ label, pass: !!condition });
  console.log(`${condition ? "PASS" : "FAIL"} — ${label}`);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------
// PART A — defaults, validation, clamping
// ---------------------------------------------------------------------
const s = await import("../js/settings.js?scenario=a");

check("Loads DEFAULT_SETTINGS when localStorage is empty", s.getSettings().officeName === "Office Name");
check("Default theme color matches base.css --color-accent", s.getSettings().themeColor === "#1a56db");

s.saveSettings({ counterCount: 999 });
check("counterCount clamped to max (20)", s.getSettings().counterCount === 20);

s.saveSettings({ counterCount: -5 });
check("counterCount clamped to min (1)", s.getSettings().counterCount === 1);

s.saveSettings({ speechRate: 10, speechVolume: -3 });
check("speechRate clamped to max (2)", s.getSettings().speechRate === 2);
check("speechVolume clamped to min (0)", s.getSettings().speechVolume === 0);

s.saveSettings({ themeColor: "not-a-color" });
check("Invalid theme color falls back to previous valid value", s.getSettings().themeColor === "#1a56db");

s.saveSettings({ themeColor: "#ff8800" });
check("Valid hex theme color is accepted", s.getSettings().themeColor === "#ff8800");

s.saveSettings({ officeName: "   " });
check("Blank office name falls back to default rather than saving whitespace", s.getSettings().officeName === "Office Name");

s.saveSettings({ officeName: "Barangay Calunangan" });
check("Partial save only touches the given field (others untouched)", s.getSettings().speechRate === 2 && s.getSettings().officeName === "Barangay Calunangan");

const { settings: afterReset } = s.resetToDefaults();
check("resetToDefaults restores every field", afterReset.officeName === "Office Name" && afterReset.counterCount === 4 && afterReset.themeColor === "#1a56db");

// ---------------------------------------------------------------------
// PART B — persistence survives a fresh "page load"
// ---------------------------------------------------------------------
s.saveSettings({ officeName: "CNU Registrar", counterCount: 6 });
const reloaded = await import("../js/settings.js?scenario=b-reload");
check(
  "Freshly-imported instance recovers persisted settings from localStorage",
  reloaded.getSettings().officeName === "CNU Registrar" && reloaded.getSettings().counterCount === 6
);

// Simulate a corrupted localStorage value — must not throw, must fall back
store.set("queue-system:settings", "{ this is not valid json");
const corrupted = await import("../js/settings.js?scenario=b-corrupt");
check("Corrupted localStorage value falls back to defaults without throwing", corrupted.getSettings().officeName === "Office Name");

// ---------------------------------------------------------------------
// PART C — cross-tab sync via comms.js
//
// NOTE: we don't test this by importing settings.js twice under
// different query strings and expecting them to "hear" each other —
// settings.js's OWN internal `import "./comms.js"` (no query string)
// always resolves to the same cached module in Node, so two such
// instances would secretly share one BroadcastChannel object, which
// (correctly, per spec) never delivers a message back to itself. That's
// a Node-only module-caching quirk — two real browser tabs have fully
// separate JS realms and don't have this problem. See the identical
// note in chunk1-comms-state.test.mjs for the full explanation.
//
// Instead: import settings.js ONCE (the "page under test"), and use a
// genuinely separate comms.js instance as a spy to confirm exactly what
// gets broadcast — i.e. what a real second tab would actually receive.
// ---------------------------------------------------------------------
store.clear();
const spyComms = await import("../js/comms.js?scenario=c-spy");
const pageUnderTest = await import("../js/settings.js?scenario=c-page");

let spyHeard = null;
spyComms.onMessage("settings-updated", (payload) => (spyHeard = payload));
pageUnderTest.saveSettings({ officeName: "Cebu Normal University", themeColor: "#0b7a3e" });
await wait(30);
check(
  "saveSettings broadcasts 'settings-updated' with the new values (what a real 2nd tab receives)",
  spyHeard?.officeName === "Cebu Normal University" && spyHeard?.themeColor === "#0b7a3e"
);

// ---------------------------------------------------------------------
// PART D — logo size warning
// ---------------------------------------------------------------------
const s2 = await import("../js/settings.js?scenario=d");
const smallLogo = "data:image/png;base64," + "A".repeat(1000); // small, no warning expected
const { warning: noWarning } = s2.saveSettings({ officeLogo: smallLogo });
check("Small logo produces no warning", noWarning === null);

const bigLogo = "data:image/png;base64," + "A".repeat(2_000_000); // ~1.5MB decoded, over threshold
const { warning: bigWarning } = s2.saveSettings({ officeLogo: bigLogo });
check("Oversized logo returns a warning string", typeof bigWarning === "string" && bigWarning.includes("MB"));

// ---------------------------------------------------------------------
// PART E — export / import round-trip
// ---------------------------------------------------------------------
const s3 = await import("../js/settings.js?scenario=e-export");
s3.saveSettings({ officeName: "ARAL Program", counterCount: 3, footerMessage: "Please wait for your number to be called." });
const payload = s3.getExportPayload();
check("getExportPayload produces valid JSON", (() => { try { JSON.parse(payload); return true; } catch { return false; } })());
check("Exported payload contains the saved office name", JSON.parse(payload).officeName === "ARAL Program");

const s4 = await import("../js/settings.js?scenario=e-import");
const importResult = s4.importSettingsFromJSON(payload);
check("Import succeeds with a valid exported payload", importResult.success === true);
check("Imported settings match what was exported", s4.getSettings().officeName === "ARAL Program" && s4.getSettings().counterCount === 3);

const badImport = s4.importSettingsFromJSON("not json at all {{{");
check("Importing garbage JSON fails gracefully with an error message, doesn't throw", badImport.success === false && typeof badImport.error === "string");

const arrayImport = s4.importSettingsFromJSON("[1,2,3]");
check("Importing a JSON array (wrong shape) is rejected, not silently accepted", arrayImport.success === false);

// exportSettings() in a non-browser environment should warn, not throw
let exportThrew = false;
try {
  s4.exportSettings();
} catch {
  exportThrew = true;
}
check("exportSettings() doesn't throw outside a browser (no document/Blob)", !exportThrew);

// importSettingsFromFile() without FileReader should resolve gracefully
const fileResult = await s4.importSettingsFromFile({});
check("importSettingsFromFile() resolves gracefully without FileReader", fileResult.success === false);

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
process.exit(failed.length > 0 ? 1 : 0);
