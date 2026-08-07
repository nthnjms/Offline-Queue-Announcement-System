/* ==========================================================================
   state.js — CHUNK 1 (implemented)

   Single source of truth for the "current state" of the queue: the
   ticket currently on screen, and the last-5 call history. Persisted to
   localStorage under its own key, separate from comms.js's messaging.

   Why persistence lives here and not in comms.js: BroadcastChannel /
   its fallback only deliver events to tabs that are ALREADY OPEN. If the
   Display page is opened (or refreshed) after a ticket was called, it
   would never receive that event and would show a blank screen. Reading
   from localStorage on load fixes that — state.js is the recovery path,
   comms.js is the instant-push path. They work together:

     Control Panel calls a ticket
       -> state.js updates + persists to localStorage (recovery path)
       -> state.js tells comms.js to broadcast it (instant-push path)
     Display page (already open)
       -> hears the comms.js broadcast, updates instantly, no refresh
     Display page (opened afterwards / refreshed)
       -> loads state.js's persisted value on startup, shows the same
          ticket immediately, no broadcast needed

   ========================================================================== */

import { send, onMessage } from "./comms.js";

const STORAGE_KEY = "queue-system:state";
const MAX_HISTORY = 5;

const DEFAULT_STATE = {
  current: null, // { ticketNumber, counter, message, calledAt } | null
  history: [], // same shape as current, newest first, max MAX_HISTORY items
};

/** @type {typeof DEFAULT_STATE} */
let state = loadState();

/** @type {Set<(state: typeof DEFAULT_STATE) => void>} */
const subscribers = new Set();

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return cloneDefault();

    const parsed = JSON.parse(raw);
    // Defensive shape-check in case an older version of this app wrote a
    // different structure — never let a corrupted/old value crash the page.
    return {
      current: parsed && typeof parsed.current === "object" ? parsed.current : null,
      history: Array.isArray(parsed?.history) ? parsed.history.slice(0, MAX_HISTORY) : [],
    };
  } catch (err) {
    console.error("[state.js] Failed to load saved state, using defaults:", err);
    return cloneDefault();
  }
}

function cloneDefault() {
  return { current: null, history: [] };
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    // Most likely cause: localStorage quota exceeded (e.g. a huge logo
    // saved by settings.js in Chunk 3). Don't throw — just warn, so a
    // full call queue can't crash the app mid-service.
    console.error("[state.js] Failed to persist state:", err);
  }
}

function notify() {
  subscribers.forEach((callback) => {
    try {
      callback(state);
    } catch (err) {
      console.error("[state.js] subscriber threw:", err);
    }
  });
}

/** Returns the current state object (read-only by convention — always go
 *  through callTicket()/clearDisplay() to change it, never mutate directly). */
export function getState() {
  return state;
}

/**
 * Subscribe to state changes. Fires immediately with the current state,
 * so a subscriber added after the fact never "misses" the current ticket.
 * @param {(state: typeof DEFAULT_STATE) => void} callback
 * @returns {() => void} unsubscribe function
 */
export function subscribe(callback) {
  subscribers.add(callback);
  callback(state);
  return () => subscribers.delete(callback);
}

/**
 * Call a new ticket. Used by control-panel.js when the operator presses
 * "Call". Updates + persists state, adds to history, and broadcasts to
 * the Display page.
 * @param {{ ticketNumber: string, counter: string|number, message?: string }} input
 */
export function callTicket({ ticketNumber, counter, message }) {
  const entry = {
    ticketNumber: String(ticketNumber).trim().toUpperCase(),
    counter,
    message: message?.trim() || "",
    calledAt: Date.now(),
  };

  state = {
    current: entry,
    history: [entry, ...state.history].slice(0, MAX_HISTORY),
  };

  persist();
  notify();
  send("ticket-called", entry);

  return entry;
}

/**
 * Re-announce the current ticket without creating a new history entry.
 * Used by control-panel.js when the operator presses "Repeat".
 */
export function repeatCurrent() {
  if (!state.current) return;
  send("ticket-repeat", state.current);
}

/**
 * Clear the currently-displayed ticket (history is kept). Used by
 * control-panel.js when the operator presses "Clear Display".
 */
export function clearDisplay() {
  state = { ...state, current: null };
  persist();
  notify();
  send("display-cleared", {});
}

// --- Cross-tab sync -------------------------------------------------------
// These run in EVERY page that imports state.js (Control Panel included),
// so if two Control Panel tabs are accidentally open, both stay in sync
// too — see the multi-tab note in Chunk 6.

onMessage("ticket-called", (entry) => {
  state = {
    current: entry,
    history: [entry, ...state.history.filter((h) => h.calledAt !== entry.calledAt)].slice(
      0,
      MAX_HISTORY
    ),
  };
  persist();
  notify();
});

onMessage("display-cleared", () => {
  state = { ...state, current: null };
  persist();
  notify();
});

// Note: 'ticket-repeat' is intentionally NOT handled here — repeating a
// ticket doesn't change state (no new history entry, current ticket is
// unchanged), so there's nothing for state.js to update. display.js
// (Chunk 5) will listen for 'ticket-repeat' directly via comms.js to
// know when to re-trigger the bell/speech without re-running the
// call-in animation.

if (typeof window !== "undefined") {
  window.__queueState = { getState, subscribe, callTicket, repeatCurrent, clearDisplay };
}

console.log("[state.js] ready — current state:", state);
