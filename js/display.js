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

import { onMessage, startHeartbeat } from "./comms.js";
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

  function handleLiveAnnouncement(entry) {
    playBell();
    flashTicket();
    announceTicket(entry);
  }

  onMessage("ticket-called", handleLiveAnnouncement);
  onMessage("ticket-repeat", handleLiveAnnouncement);
  onMessage("display-cleared", () => clearSpeechQueue());

  // Many browsers block audio until the page has received a user gesture.
  // A public display often won't get one before its first real
  // announcement, so "prime" playback silently on the first tap/click
  // anywhere on the page (e.g. a projector's touch surface, or whoever
  // sets the machine up walking over and clicking once).
  function primeAudioOnce() {
    el.bell
      .play()
      ?.then(() => {
        el.bell.pause();
        el.bell.currentTime = 0;
      })
      .catch(() => {
        /* still blocked — will simply try again on the next real bell */
      });
  }
  document.addEventListener("click", primeAudioOnce, { once: true });

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
}

initDisplay();

console.log("[display.js] ready");
