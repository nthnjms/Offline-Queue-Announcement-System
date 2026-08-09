/* ==========================================================================
   settings.js — CHUNK 3 (implemented)

   Loads/saves operator settings (office name, logo, counter count, theme
   color, speech rate/volume, footer message) to localStorage, with a
   validated/clamped shape and safe defaults if a stored value is missing
   or corrupted.

   Also handles:
     - export/import as a .json file (backup, or copying config to a
       second machine — see the project's stated "expand later" goal)
     - a size warning when the logo image pushes localStorage usage high
     - cross-tab sync, the same pattern as state.js: this tab's save
       writes to the shared localStorage AND broadcasts via comms.js so
       an already-open second tab (e.g. Display, showing the theme color
       or footer message) updates instantly without a refresh.

   Exports:
     - getSettings()
     - saveSettings(partial)        -> { settings, warning }
     - resetToDefaults()             -> { settings, warning }
     - subscribe(callback)
     - applyTheme(settings?)          apply --color-accent to the page
     - getExportPayload()              JSON string of current settings
     - exportSettings()                 triggers a browser file download
     - importSettingsFromJSON(json)      core import logic, pure/testable
     - importSettingsFromFile(file)       browser File -> FileReader wrapper

   Depends on: comms.js (to broadcast settings changes to the other page).
   Depended on by: control-panel.js (settings form), display.js (reads
   office name/logo/theme/footer).
   ========================================================================== */

import { send, onMessage, onTransportReady, getNetworkConfig } from "./comms.js";

const STORAGE_KEY = "queue-system:settings";

// Soft warning threshold for the logo's base64 size. localStorage quota
// is commonly 5-10MB TOTAL for the whole origin (shared with state.js's
// history too), so a single multi-MB logo is worth flagging early rather
// than letting the operator discover it when a save silently fails.
const LOGO_WARNING_BYTES = 1_000_000; // ~1MB

const COUNTER_COUNT_MIN = 1;
const COUNTER_COUNT_MAX = 20;
const RATE_MIN = 0.5;
const RATE_MAX = 2;
const VOLUME_MIN = 0;
const VOLUME_MAX = 1;

export const DEFAULT_SETTINGS = Object.freeze({
  officeName: "Office Name",
  officeLogo: "", // base64 data URL, or "" for none
  counterCount: 4,
  themeColor: "#1a56db", // matches --color-accent in css/base.css
  speechRate: 1,
  speechVolume: 1,
  footerMessage: "",
});

function clamp(value, min, max, fallback) {
  const num = Number(value);
  if (Number.isNaN(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

/** Merge a possibly-partial/possibly-corrupt object onto DEFAULT_SETTINGS,
 *  validating and clamping every field. Never throws — always returns a
 *  usable settings object even if `input` is garbage. */
function sanitize(input) {
  const src = input && typeof input === "object" ? input : {};
  return {
    officeName:
      typeof src.officeName === "string" && src.officeName.trim()
        ? src.officeName.trim()
        : DEFAULT_SETTINGS.officeName,
    officeLogo: typeof src.officeLogo === "string" ? src.officeLogo : DEFAULT_SETTINGS.officeLogo,
    counterCount: Math.round(
      clamp(src.counterCount, COUNTER_COUNT_MIN, COUNTER_COUNT_MAX, DEFAULT_SETTINGS.counterCount)
    ),
    themeColor:
      typeof src.themeColor === "string" && /^#[0-9a-fA-F]{6}$/.test(src.themeColor)
        ? src.themeColor
        : DEFAULT_SETTINGS.themeColor,
    speechRate: clamp(src.speechRate, RATE_MIN, RATE_MAX, DEFAULT_SETTINGS.speechRate),
    speechVolume: clamp(src.speechVolume, VOLUME_MIN, VOLUME_MAX, DEFAULT_SETTINGS.speechVolume),
    footerMessage: typeof src.footerMessage === "string" ? src.footerMessage : DEFAULT_SETTINGS.footerMessage,
  };
}

/** Rough byte-size estimate of a base64 string (3 bytes per 4 chars). */
function estimateBase64Bytes(base64) {
  if (!base64) return 0;
  const commaIndex = base64.indexOf(",");
  const dataPart = commaIndex >= 0 ? base64.slice(commaIndex + 1) : base64;
  return Math.round((dataPart.length * 3) / 4);
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return sanitize(JSON.parse(raw));
  } catch (err) {
    console.error("[settings.js] Failed to load saved settings, using defaults:", err);
    return { ...DEFAULT_SETTINGS };
  }
}

let settings = loadSettings();
const subscribers = new Set();

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    return true;
  } catch (err) {
    console.error("[settings.js] Failed to persist settings (localStorage may be full):", err);
    return false;
  }
}

function notify() {
  subscribers.forEach((callback) => {
    try {
      callback(settings);
    } catch (err) {
      console.error("[settings.js] subscriber threw:", err);
    }
  });
}

export function getSettings() {
  return settings;
}

/**
 * Subscribe to settings changes (from this tab OR a synced update from
 * the other tab). Fires immediately with current settings.
 * @param {(settings: typeof DEFAULT_SETTINGS) => void} callback
 * @returns {() => void} unsubscribe function
 */
export function subscribe(callback) {
  subscribers.add(callback);
  callback(settings);
  return () => subscribers.delete(callback);
}

/**
 * Save a partial or full settings update. Validates/clamps every field,
 * persists, notifies local subscribers, and broadcasts to the other page.
 * @param {Partial<typeof DEFAULT_SETTINGS>} partial
 * @returns {{ settings: typeof DEFAULT_SETTINGS, warning: string|null }}
 */
export function saveSettings(partial) {
  settings = sanitize({ ...settings, ...partial });
  persist();
  notify();
  send("settings-updated", settings);

  let warning = null;
  const logoBytes = estimateBase64Bytes(settings.officeLogo);
  if (logoBytes > LOGO_WARNING_BYTES) {
    warning = `Logo is about ${(logoBytes / 1_000_000).toFixed(1)}MB — large logos can slow saving or hit browser storage limits. Consider a smaller image.`;
    console.warn("[settings.js]", warning);
  }

  return { settings, warning };
}

/** Reset every setting back to DEFAULT_SETTINGS. */
export function resetToDefaults() {
  settings = { ...DEFAULT_SETTINGS };
  persist();
  notify();
  send("settings-updated", settings);
  return { settings, warning: null };
}

/** Apply the theme color to the page by setting the --color-accent CSS
 *  variable (see css/base.css). Safe to call in non-browser contexts —
 *  it just no-ops if `document` isn't available. */
export function applyTheme(target = settings) {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty("--color-accent", target.themeColor);
}

/** JSON string of the current settings, for exportSettings() or for
 *  tests to check the payload without needing a real browser download. */
export function getExportPayload() {
  return JSON.stringify(settings, null, 2);
}

/** Triggers a browser download of the current settings as a .json file.
 *  No-ops with a console warning outside a browser (e.g. in tests). */
export function exportSettings() {
  if (typeof document === "undefined" || typeof Blob === "undefined") {
    console.warn("[settings.js] exportSettings() requires a browser environment.");
    return;
  }
  const blob = new Blob([getExportPayload()], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const dateStamp = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `queue-settings-${dateStamp}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Core import logic: parse + validate a JSON string and save it as the
 * new settings. Pure function (no File/FileReader dependency), so it's
 * fully testable without a browser.
 * @param {string} jsonString
 * @returns {{ success: boolean, settings?: typeof DEFAULT_SETTINGS, warning?: string|null, error?: string }}
 */
export function importSettingsFromJSON(jsonString) {
  let parsed;
  try {
    parsed = JSON.parse(jsonString);
  } catch (err) {
    return { success: false, error: "That file isn't valid JSON." };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { success: false, error: "That file doesn't contain a settings object." };
  }
  const { settings: saved, warning } = saveSettings(parsed);
  return { success: true, settings: saved, warning };
}

/**
 * Browser convenience wrapper: read a File (e.g. from an <input
 * type="file">) and import it. Wraps importSettingsFromJSON with the
 * async file-reading step.
 * @param {File} file
 * @returns {Promise<ReturnType<typeof importSettingsFromJSON>>}
 */
export function importSettingsFromFile(file) {
  return new Promise((resolve) => {
    if (typeof FileReader === "undefined") {
      resolve({ success: false, error: "File reading isn't available in this environment." });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(importSettingsFromJSON(String(reader.result)));
    reader.onerror = () => resolve({ success: false, error: "Couldn't read that file." });
    reader.readAsText(file);
  });
}

// --- Cross-tab sync --------------------------------------------------------
onMessage("settings-updated", (incoming) => {
  settings = sanitize(incoming);
  persist();
  notify();
  // Always persisting (not just in same-machine mode): on a networked
  // second machine, this browser's localStorage is entirely separate
  // from the sender's, so skipping this would silently lose the update
  // on next reload. The extra write is harmless on the same machine too.
});

// --- Cross-MACHINE sync (Network Sync mode only) ---------------------------
// Same pattern as state.js — see its equivalent section for the full
// explanation. Never fires in local/offline mode.

onMessage("request-sync", () => {
  send("settings-sync", settings);
});

onMessage("settings-sync", (payload) => {
  settings = sanitize(payload);
  persist();
  notify();
});

onTransportReady(() => {
  if (getNetworkConfig().enabled) send("request-sync", {});
});

if (typeof window !== "undefined") {
  window.__queueSettings = {
    getSettings,
    saveSettings,
    resetToDefaults,
    subscribe,
    applyTheme,
    exportSettings,
    getExportPayload,
    importSettingsFromJSON,
    importSettingsFromFile,
  };
}

console.log("[settings.js] ready — current settings:", {
  ...settings,
  officeLogo: settings.officeLogo ? `[${estimateBase64Bytes(settings.officeLogo)} bytes]` : "",
});
