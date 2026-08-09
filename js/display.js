/* ==========================================================================
   display.js — CHUNK 5 (implemented)

   Wires up the Public Display page. The one rule this file has to get
   right: bell + flash + voice announcement fire ONLY on a live
   'ticket-called' / 'ticket-repeat' event from comms.js — never as a
   side effect of state.subscribe()'s initial callback. That callback
   also fires the instant this page loads (including on a refresh, or
   when opened after a ticket was already called — see state.js's
   header comment on recovery-on-load) — if bell/speech were wired to
   it directly, the display would re-announce whatever ticket happens
   to be on screen every single time the page loads. So rendering
   (what's on screen) and announcing (what gets said out loud) are
   deliberately two separate listeners fed by two separate sources.

   Depends on: comms.js, state.js, settings.js, speech.js.
   ========================================================================== */

import { onMessage, startHeartbeat, getNetworkConfig, setNetworkConfig, onTransportStatusChange } from "./comms.js";
import { subscribe as subscribeState } from "./state.js";
import { subscribe as subscribeSettings, applyTheme } from "./settings.js";
import { announceTicket, clearQueue as clearSpeechQueue } from "./speech.js";

function initDisplay() {
  const el = {
    officeLogo: document.getElementById("office-logo"),
    officeName: document.getElementById("office-name"),
    clock: document.getElementById("clock"),
    ticketNumber: document.getElementById("ticket-number"),
    counterLabel: document.getElementById("counter-label"),
    lastCalledList: document.getElementById("last-called-list"),
    lastCalledEmpty: document.getElementById("last-called-empty"),
    footer: document.getElementById("scrolling-footer"),
    footerText: document.getElementById("scrolling-footer-text"),
    fullscreenButton: document.getElementById("fullscreen-button"),
    bell: document.getElementById("bell-sound"),
    networkSyncButton: document.getElementById("network-sync-button"),
    networkSyncPanel: document.getElementById("network-sync-panel"),
    networkSyncForm: document.getElementById("network-sync-panel-form"),
    networkSyncEnabled: document.getElementById("network-sync-panel-enabled"),
    networkSyncUrl: document.getElementById("network-sync-panel-url"),
    networkSyncStatus: document.getElementById("network-sync-panel-status"),
    networkSyncClose: document.getElementById("network-sync-panel-close"),
  };

  // --- Clock -----------------------------------------------------------------

  function updateClock() {
    const now = new Date();
    el.clock.textContent = now.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    el.clock.dateTime = now.toISOString();
  }
  updateClock();
  setInterval(updateClock, 1000);

  // --- Settings-driven rendering (office identity, theme, footer) -----------

  function renderSettings(settings) {
    el.officeName.textContent = settings.officeName;

    if (settings.officeLogo) {
      el.officeLogo.src = settings.officeLogo;
      el.officeLogo.alt = `${settings.officeName} logo`;
      el.officeLogo.hidden = false;
    } else {
      el.officeLogo.hidden = true;
      el.officeLogo.src = "";
    }

    applyTheme(settings);

    const hasFooter = Boolean(settings.footerMessage && settings.footerMessage.trim());
    el.footer.hidden = !hasFooter;
    el.footerText.textContent = hasFooter ? settings.footerMessage.trim() : "";
  }
  subscribeSettings(renderSettings);

  // --- State-driven rendering (what's currently on screen) -------------------

  function renderState(state) {
    if (state.current) {
      el.ticketNumber.textContent = state.current.ticketNumber;
      el.counterLabel.textContent = `PLEASE PROCEED TO COUNTER ${state.current.counter}`;
    } else {
      el.ticketNumber.textContent = "—";
      el.counterLabel.textContent = "";
    }
    renderLastCalled(state.history);
  }

  function renderLastCalled(history) {
    el.lastCalledList.innerHTML = "";
    el.lastCalledEmpty.hidden = history.length > 0;
    history.forEach((entry) => {
      const li = document.createElement("li");
      li.textContent = `${entry.ticketNumber} → Counter ${entry.counter}`;
      el.lastCalledList.appendChild(li);
    });
  }

  subscribeState(renderState);

  // --- Live announcement effects (bell, flash, voice) -------------------------
  // Deliberately separate from renderState() — see file header comment.

  function playBell() {
    try {
      el.bell.currentTime = 0;
      el.bell.play()?.catch((err) => {
        console.warn(
          "[display.js] Bell playback was blocked — browsers require a user " +
            "interaction on this page before audio can autoplay. It should " +
            "work after the first click/tap anywhere on this page.",
          err
        );
      });
    } catch (err) {
      console.warn("[display.js] Bell playback failed:", err);
    }
  }

  function flashTicket() {
    el.ticketNumber.classList.remove("flash");
    void el.ticketNumber.offsetWidth; // force reflow so the animation can restart
    el.ticketNumber.classList.add("flash");
  }

  // Bell rings immediately; the voice announcement waits a beat so it
  // doesn't talk over the chime. Tweak ANNOUNCEMENT_DELAY_MS to taste.
  const ANNOUNCEMENT_DELAY_MS = 700;
  let pendingAnnouncementTimeout = null;

  function handleLiveAnnouncement(entry) {
    playBell();
    flashTicket();

    if (pendingAnnouncementTimeout) clearTimeout(pendingAnnouncementTimeout);
    pendingAnnouncementTimeout = setTimeout(() => {
      pendingAnnouncementTimeout = null;
      announceTicket(entry);
    }, ANNOUNCEMENT_DELAY_MS);
  }

  onMessage("ticket-called", handleLiveAnnouncement);
  onMessage("ticket-repeat", handleLiveAnnouncement);
  onMessage("display-cleared", () => {
    // If the display gets cleared while a voice announcement is still
    // waiting out its delay, cancel it — otherwise it would speak a
    // ticket that's no longer even on screen.
    if (pendingAnnouncementTimeout) {
      clearTimeout(pendingAnnouncementTimeout);
      pendingAnnouncementTimeout = null;
    }
    clearSpeechQueue();
  });

  // Many browsers block audio until the page has received a user gesture.
  // The Display page normally never gets clicked directly (the operator
  // works from Control Panel, not the TV), so without this, the first
  // real bell would silently fail with no indication why. This overlay
  // makes the one-time requirement visible instead of a silent trick.
  const audioOverlay = document.getElementById("audio-unlock-overlay");

  function unlockAudio() {
    el.bell
      .play()
      ?.then(() => {
        el.bell.pause();
        el.bell.currentTime = 0;
        audioOverlay.classList.add("is-hidden");
      })
      .catch(() => {
        // Still blocked for some reason — leave the overlay up so the
        // person can try tapping again.
      });
  }
  audioOverlay.addEventListener("click", unlockAudio);
  audioOverlay.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      unlockAudio();
    }
  });

  startHeartbeat();

  // --- Wake Lock: keep the screen from sleeping during idle periods ----------

  let wakeLock = null;
  async function requestWakeLock() {
    if (!("wakeLock" in navigator)) return;
    try {
      wakeLock = await navigator.wakeLock.request("screen");
    } catch (err) {
      console.warn("[display.js] Wake Lock request failed (non-fatal):", err);
    }
  }
  requestWakeLock();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && wakeLock === null) {
      requestWakeLock();
    }
  });

  // --- Fullscreen toggle -------------------------------------------------------

  el.fullscreenButton.addEventListener("click", () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch((err) => {
        console.warn("[display.js] Couldn't enter fullscreen:", err);
      });
    } else {
      document.exitFullscreen?.();
    }
  });

  // --- Network Sync (optional, multi-computer) --------------------------
  // Deliberately minimal here — full Settings (office name, logo, theme,
  // etc.) only ever lives in Control Panel. This is just enough for
  // someone setting up this specific machine to point it at the relay
  // server; see comms.js's file header for why this can't be synced.

  function renderNetworkSyncPanel(config) {
    el.networkSyncEnabled.checked = config.enabled;
    el.networkSyncUrl.value = config.serverUrl;
  }
  renderNetworkSyncPanel(getNetworkConfig());

  onTransportStatusChange((isReady) => {
    const config = getNetworkConfig();
    if (!config.enabled) {
      el.networkSyncStatus.textContent = "Off — using this computer only.";
      return;
    }
    el.networkSyncStatus.textContent = isReady ? "Connected." : "Not connected — retrying…";
  });

  el.networkSyncButton.addEventListener("click", () => {
    el.networkSyncPanel.hidden = !el.networkSyncPanel.hidden;
  });
  el.networkSyncClose.addEventListener("click", () => {
    el.networkSyncPanel.hidden = true;
  });

  el.networkSyncForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const requestedEnabled = el.networkSyncEnabled.checked; // capture BEFORE render resets it
    const applied = setNetworkConfig({
      enabled: requestedEnabled,
      serverUrl: el.networkSyncUrl.value,
    });
    renderNetworkSyncPanel(applied);
    if (requestedEnabled && !applied.enabled) {
      el.networkSyncStatus.textContent = "Address should start with ws:// or wss://";
    }
  });
}

initDisplay();

console.log("[display.js] ready");
