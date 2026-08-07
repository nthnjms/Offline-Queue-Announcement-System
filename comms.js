/* ==========================================================================
   comms.js — CHUNK 1 (implemented)

   The ONLY file in this project allowed to know about BroadcastChannel
   (or its localStorage-event fallback). Every other file talks to THIS
   module's send()/onMessage() functions — never to BroadcastChannel
   directly. That rule is what makes a future swap to a local WebSocket
   (for multi-computer support) a one-file change instead of a rewrite.

   Two things live here:
     1. A generic pub/sub messaging layer: send(type, payload) / onMessage(type, cb)
     2. A heartbeat helper so the Control Panel can show
        "Display: Connected" / "Not detected"

   NOTE on scope: comms.js only carries EVENTS between already-open tabs.
   It does NOT persist anything — a page opened after an event was sent
   will never see it. That's intentional; state.js is the module
   responsible for persisted, recoverable state (see state.js header).
   ========================================================================== */

const CHANNEL_NAME = "queue-system";
const FALLBACK_STORAGE_KEY = "queue-system:comms-fallback";

const HEARTBEAT_INTERVAL_MS = 3000;
const HEARTBEAT_TIMEOUT_MS = 7000; // no pulse within this window = "disconnected"

// type -> Set<callback>
const listeners = new Map();

let channel = null;
let usingFallback = false;

/** True if this browser supports BroadcastChannel. Old Safari doesn't. */
function supportsBroadcastChannel() {
  return typeof BroadcastChannel !== "undefined";
}

function dispatch(message) {
  if (!message || typeof message.type !== "string") return;
  const callbacks = listeners.get(message.type);
  if (!callbacks || callbacks.size === 0) return;
  callbacks.forEach((callback) => {
    try {
      callback(message.payload, message);
    } catch (err) {
      console.error(`[comms.js] listener for "${message.type}" threw:`, err);
    }
  });
}

function initTransport() {
  if (supportsBroadcastChannel()) {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.addEventListener("message", (event) => dispatch(event.data));
    return;
  }

  // Fallback: use the native 'storage' event, which only fires in OTHER
  // tabs (never the tab that wrote the value) — the same "not delivered
  // to sender" semantics as BroadcastChannel, so callers don't need to
  // special-case either transport.
  usingFallback = true;
  window.addEventListener("storage", (event) => {
    if (event.key !== FALLBACK_STORAGE_KEY || !event.newValue) return;
    try {
      dispatch(JSON.parse(event.newValue));
    } catch (err) {
      console.error("[comms.js] Failed to parse fallback message:", err);
    }
  });
  console.warn(
    "[comms.js] BroadcastChannel not supported in this browser — " +
      "falling back to localStorage events. Functionality is the same, " +
      "but slightly higher latency."
  );
}

/**
 * Broadcast an event to the other page(s).
 * @param {string} type - event name, e.g. "ticket-called"
 * @param {object} [payload] - JSON-serializable data for the event
 */
export function send(type, payload = {}) {
  const message = { type, payload, ts: Date.now() };

  if (channel) {
    channel.postMessage(message);
    return;
  }

  if (usingFallback) {
    try {
      localStorage.setItem(FALLBACK_STORAGE_KEY, JSON.stringify(message));
    } catch (err) {
      console.error("[comms.js] Fallback send failed:", err);
    }
  }
}

/**
 * Subscribe to a specific event type.
 * @param {string} type - event name to listen for
 * @param {(payload: object, message: object) => void} callback
 * @returns {() => void} unsubscribe function
 */
export function onMessage(type, callback) {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type).add(callback);
  return () => listeners.get(type)?.delete(callback);
}

/**
 * Call this once from display.js on page load. Makes this page announce
 * its presence on an interval, and reply immediately if a Control Panel
 * asks "are you there?" via a 'ping' event.
 */
export function startHeartbeat() {
  send("display-heartbeat", {});
  setInterval(() => send("display-heartbeat", {}), HEARTBEAT_INTERVAL_MS);
  onMessage("ping", () => send("display-heartbeat", {}));
}

/**
 * Call this once from control-panel.js. Reports connection status
 * whenever it changes (not on every check) so the UI doesn't re-render
 * needlessly.
 * @param {(connected: boolean) => void} callback
 * @returns {() => void} stop function
 */
export function onHeartbeat(callback) {
  let lastSeen = 0;
  let lastReportedStatus = null;

  onMessage("display-heartbeat", () => {
    lastSeen = Date.now();
  });

  function checkStatus() {
    const connected = Date.now() - lastSeen < HEARTBEAT_TIMEOUT_MS;
    if (connected !== lastReportedStatus) {
      lastReportedStatus = connected;
      callback(connected);
    }
  }

  // Ask any already-open Display page to identify itself right away,
  // instead of waiting up to HEARTBEAT_INTERVAL_MS for its next pulse.
  send("ping", {});

  const intervalId = setInterval(checkStatus, 1000);
  checkStatus();

  return () => clearInterval(intervalId);
}

initTransport();

// Expose on window for manual testing in the browser console before
// Chunk 4/5 build real UI on top of this. Safe to leave in — costs
// nothing in production and helps anyone debugging later.
if (typeof window !== "undefined") {
  window.__queueComms = { send, onMessage, startHeartbeat, onHeartbeat };
}

console.log(
  `[comms.js] ready (transport: ${usingFallback ? "localStorage fallback" : "BroadcastChannel"})`
);
