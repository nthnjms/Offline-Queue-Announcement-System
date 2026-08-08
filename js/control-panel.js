/* ==========================================================================
   control-panel.js — CHUNK 4 (implemented)

   Wires up the Control Panel page. Pure/testable logic (validation,
   formatting) is exported as named functions at the top so it can be
   unit-tested without a DOM; everything below that is DOM wiring.

   Depends on: comms.js, state.js, settings.js.
   ========================================================================== */

import { onHeartbeat } from "./comms.js";
import { getState, subscribe as subscribeState, callTicket, repeatCurrent, clearDisplay } from "./state.js";
import {
  getSettings,
  subscribe as subscribeSettings,
  saveSettings,
  resetToDefaults,
  applyTheme,
  exportSettings,
  importSettingsFromFile,
} from "./settings.js";

// --- Pure helpers (exported for unit testing — no DOM required) -----------

/** Trim + uppercase a raw ticket number as typed. */
export function normalizeTicket(raw) {
  return (raw ?? "").trim().toUpperCase();
}

/** Loose format check — one or two letters followed by 2-4 digits (B015,
 *  P003, A22). This is a HINT, not a hard block: real ticket schemes
 *  vary, so an unusual-looking ticket can still be called. */
export function looksLikeValidTicket(value) {
  return /^[A-Z]{1,2}\d{2,4}$/.test(value);
}

/** Build the counter <option> values 1..count as an array of strings,
 *  used both to populate the dropdown and to validate a selection. */
export function computeCounterOptions(count) {
  const n = Math.max(1, Math.round(Number(count) || 1));
  return Array.from({ length: n }, (_, i) => String(i + 1));
}

/** Human-readable "how long ago" for a history timestamp. */
export function formatRelativeTime(timestampMs, now = Date.now()) {
  const diffSeconds = Math.max(0, Math.round((now - timestampMs) / 1000));
  if (diffSeconds < 5) return "just now";
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  const diffMinutes = Math.round(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.round(diffMinutes / 60);
  return `${diffHours}h ago`;
}

// --- DOM wiring -------------------------------------------------------------
// Module scripts are deferred by spec, so the DOM is guaranteed to exist
// by the time this code runs — no DOMContentLoaded wrapper needed.

function initControlPanel() {
  const el = {
    connectionStatus: document.getElementById("connection-status"),
    nowShowingValue: document.getElementById("now-showing-value"),

    callForm: document.getElementById("call-form"),
    ticketInput: document.getElementById("ticket-number"),
    ticketHint: document.getElementById("ticket-hint"),
    counterSelect: document.getElementById("counter-select"),
    messageInput: document.getElementById("custom-message"),
    repeatButton: document.getElementById("repeat-button"),
    clearButton: document.getElementById("clear-button"),

    historyList: document.getElementById("history-list"),
    historyEmpty: document.getElementById("history-empty"),

    settingsForm: document.getElementById("settings-form"),
    officeNameInput: document.getElementById("office-name-input"),
    logoInput: document.getElementById("logo-input"),
    logoPreview: document.getElementById("logo-preview"),
    removeLogoButton: document.getElementById("remove-logo-button"),
    counterCountInput: document.getElementById("counter-count-input"),
    themeColorInput: document.getElementById("theme-color-input"),
    themeColorText: document.getElementById("theme-color-text"),
    speechRateInput: document.getElementById("speech-rate-input"),
    speechRateReadout: document.getElementById("speech-rate-readout"),
    speechVolumeInput: document.getElementById("speech-volume-input"),
    speechVolumeReadout: document.getElementById("speech-volume-readout"),
    footerMessageInput: document.getElementById("footer-message-input"),
    settingsWarning: document.getElementById("settings-warning"),
    settingsSavedNote: document.getElementById("settings-saved-note"),
    resetSettingsButton: document.getElementById("reset-settings-button"),
    exportSettingsButton: document.getElementById("export-settings-button"),
    importSettingsButton: document.getElementById("import-settings-button"),
    importSettingsFile: document.getElementById("import-settings-file"),
  };

  // Holds the pending (not-yet-saved) logo, so switching a file doesn't
  // save until "Save Settings" is actually pressed — matches the rest
  // of the settings form's explicit-save behavior.
  let pendingLogo = null;

  // --- Call form ------------------------------------------------------------

  function renderNowShowing(state) {
    el.nowShowingValue.textContent = state.current
      ? `${state.current.ticketNumber} → Counter ${state.current.counter}`
      : "—";
  }

  function renderHistory(state) {
    el.historyList.innerHTML = "";
    el.historyEmpty.hidden = state.history.length > 0;

    state.history.forEach((entry) => {
      const li = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "history-item";
      button.setAttribute(
        "aria-label",
        `Recall ticket ${entry.ticketNumber} to Counter ${entry.counter} into the form`
      );

      const ticketSpan = document.createElement("span");
      ticketSpan.className = "history-item-ticket";
      ticketSpan.textContent = `${entry.ticketNumber} → Counter ${entry.counter}`;

      const metaSpan = document.createElement("span");
      metaSpan.className = "history-item-meta";
      metaSpan.textContent = formatRelativeTime(entry.calledAt);

      button.append(ticketSpan, metaSpan);
      button.addEventListener("click", () => recallEntryIntoForm(entry));
      li.appendChild(button);
      el.historyList.appendChild(li);
    });
  }

  function recallEntryIntoForm(entry) {
    el.ticketInput.value = entry.ticketNumber;
    el.counterSelect.value = String(entry.counter);
    el.messageInput.value = entry.message || "";
    updateTicketHint();
    el.ticketInput.focus();
  }

  function handleCallSubmit(event) {
    event.preventDefault();
    const ticketNumber = normalizeTicket(el.ticketInput.value);
    if (!ticketNumber) {
      el.ticketInput.focus();
      return;
    }
    callTicket({
      ticketNumber,
      counter: el.counterSelect.value,
      message: el.messageInput.value,
    });
    el.ticketInput.value = "";
    el.messageInput.value = "";
    el.ticketHint.hidden = true;
    el.ticketInput.focus();
  }

  el.callForm.addEventListener("submit", handleCallSubmit);
  el.ticketInput.addEventListener("input", updateTicketHint);

  // Enter-to-call from the ticket/counter fields (not the message
  // textarea, where Enter should insert a newline instead).
  [el.ticketInput, el.counterSelect].forEach((field) => {
    field.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        handleCallSubmit(event);
      }
    });
  });

  el.repeatButton.addEventListener("click", () => repeatCurrent());

  el.clearButton.addEventListener("click", () => {
    const state = getState();
    if (!state.current) return; // nothing to clear
    const confirmed = window.confirm(
      "Clear the display? The screen will show no ticket until the next call."
    );
    if (confirmed) clearDisplay();
  });

  subscribeState((state) => {
    renderNowShowing(state);
    renderHistory(state);
  });

  // --- Connection status ------------------------------------------------------

  onHeartbeat((connected) => {
    el.connectionStatus.textContent = connected ? "Display: Connected" : "Display: Not detected";
    el.connectionStatus.classList.toggle("is-connected", connected);
    el.connectionStatus.classList.toggle("is-disconnected", !connected);
  });

  // --- Settings form ------------------------------------------------------

  function renderCounterOptions(count, preserveValue) {
    const options = computeCounterOptions(count);
    const previousValue = preserveValue ?? el.counterSelect.value;
    el.counterSelect.innerHTML = "";
    options.forEach((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = `Counter ${value}`;
      el.counterSelect.appendChild(option);
    });
    el.counterSelect.value = options.includes(previousValue) ? previousValue : options[0];
  }

  function renderSettingsForm(settings) {
    el.officeNameInput.value = settings.officeName;
    el.counterCountInput.value = settings.counterCount;
    el.themeColorInput.value = settings.themeColor;
    el.themeColorText.value = settings.themeColor;
    el.speechRateInput.value = settings.speechRate;
    el.speechRateReadout.textContent = `${settings.speechRate.toFixed(1)}x`;
    el.speechVolumeInput.value = settings.speechVolume;
    el.speechVolumeReadout.textContent = `${Math.round(settings.speechVolume * 100)}%`;
    el.footerMessageInput.value = settings.footerMessage;

    const logoToShow = pendingLogo !== null ? pendingLogo : settings.officeLogo;
    el.logoPreview.hidden = !logoToShow;
    el.logoPreview.src = logoToShow || "";
    el.removeLogoButton.hidden = !logoToShow;

    renderCounterOptions(settings.counterCount);
    applyTheme(settings);
  }

  subscribeSettings(renderSettingsForm);

  el.speechRateInput.addEventListener("input", () => {
    el.speechRateReadout.textContent = `${Number(el.speechRateInput.value).toFixed(1)}x`;
  });
  el.speechVolumeInput.addEventListener("input", () => {
    el.speechVolumeReadout.textContent = `${Math.round(Number(el.speechVolumeInput.value) * 100)}%`;
  });
  el.themeColorInput.addEventListener("input", () => {
    el.themeColorText.value = el.themeColorInput.value;
  });
  el.themeColorText.addEventListener("change", () => {
    if (/^#[0-9a-fA-F]{6}$/.test(el.themeColorText.value)) {
      el.themeColorInput.value = el.themeColorText.value;
    }
  });

  el.logoInput.addEventListener("change", () => {
    const file = el.logoInput.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      pendingLogo = String(reader.result);
      el.logoPreview.hidden = false;
      el.logoPreview.src = pendingLogo;
      el.removeLogoButton.hidden = false;
    };
    reader.readAsDataURL(file);
  });

  el.removeLogoButton.addEventListener("click", () => {
    pendingLogo = "";
    el.logoInput.value = "";
    el.logoPreview.hidden = true;
    el.removeLogoButton.hidden = true;
  });

  function showSavedNote() {
    el.settingsSavedNote.hidden = false;
    setTimeout(() => {
      el.settingsSavedNote.hidden = true;
    }, 2000);
  }

  function gatherSettingsFormValues() {
    return {
      officeName: el.officeNameInput.value,
      officeLogo: pendingLogo !== null ? pendingLogo : getSettings().officeLogo,
      counterCount: el.counterCountInput.value,
      themeColor: el.themeColorInput.value,
      speechRate: el.speechRateInput.value,
      speechVolume: el.speechVolumeInput.value,
      footerMessage: el.footerMessageInput.value,
    };
  }

  el.settingsForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const { warning } = saveSettings(gatherSettingsFormValues());
    pendingLogo = null;
    el.settingsWarning.hidden = !warning;
    el.settingsWarning.textContent = warning || "";
    showSavedNote();
  });

  el.resetSettingsButton.addEventListener("click", () => {
    const confirmed = window.confirm("Reset every setting back to its default value?");
    if (!confirmed) return;
    pendingLogo = null;
    resetToDefaults();
    showSavedNote();
  });

  el.exportSettingsButton.addEventListener("click", () => {
    // Export should reflect what's on screen, so save first.
    saveSettings(gatherSettingsFormValues());
    pendingLogo = null;
    exportSettings();
  });

  el.importSettingsButton.addEventListener("click", () => el.importSettingsFile.click());

  el.importSettingsFile.addEventListener("change", async () => {
    const file = el.importSettingsFile.files?.[0];
    if (!file) return;
    const result = await importSettingsFromFile(file);
    el.importSettingsFile.value = "";
    if (!result.success) {
      el.settingsWarning.hidden = false;
      el.settingsWarning.textContent = `Import failed: ${result.error}`;
      return;
    }
    pendingLogo = null;
    el.settingsWarning.hidden = !result.warning;
    el.settingsWarning.textContent = result.warning || "";
    showSavedNote();
  });

  // --- Initial focus ---------------------------------------------------------
  el.ticketInput.focus();
}

initControlPanel();

console.log("[control-panel.js] ready");
